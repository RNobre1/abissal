require 'json'
require_relative 'score_model'
require_relative 'secondary_stats'
require_relative 'player_allocation'

module AdamStats
  module Scraper
    module Simulation
      # MonteCarlo — runs N iterations of (scoreline draw + secondary-stat draws
      # + per-player event allocation) and aggregates ONLY scalars (spec §6.4).
      # Never persists the raw iterations. Reproducible: same seed ⇒ identical
      # output (a single seeded Random drives everything).
      module MonteCarlo
        DEFAULT_N = 10_000

        module_function

        def run(seed:, lambda_home:, lambda_away:, rho:, secondary:,
                per_half_available:, market_anchor:, players:, n: DEFAULT_N)
          rng = Random.new(seed)
          matrix = ScoreModel.matrix(lambda_home, lambda_away, rho)
          cdf = build_cdf(matrix)
          # Clear per-call memo caches for f_plus/f_minus/f_either (thread-local).
          # Each fixture gets fresh memoisation; old entries from a prior fixture
          # on the same thread are harmless but waste memory.
          Thread.current[:mc_f_plus_memo]   = {}
          Thread.current[:mc_f_minus_memo]  = {}
          Thread.current[:mc_f_either_memo] = {}
          # Pre-compute duplo-green scalars from the matrix (analytic, no MC needed).
          dg = compute_duplo_green(matrix)

          home_wins = draws = away_wins = 0
          btts = over25 = 0
          scoreline_counts = Hash.new(0)
          sec_samples = init_sec_samples(secondary, per_half_available)
          # Per-iteration goal draws (from the SAME score model that feeds
          # p_home/p_draw/p_away) — aggregated into the goals secondary metric.
          goal_samples = { home: [], away: [] }
          player_acc = init_player_acc(players)

          n.times do
            hg, ag = sample_scoreline(rng, cdf, matrix.length)
            scoreline_counts["#{hg}-#{ag}"] += 1
            goal_samples[:home] << hg
            goal_samples[:away] << ag
            if hg > ag then home_wins += 1
            elsif hg < ag then away_wins += 1
            else draws += 1
            end
            btts += 1 if hg.positive? && ag.positive?
            over25 += 1 if (hg + ag) > 2.5

            sample_secondary(rng, secondary, per_half_available, sec_samples)
            allocate_players(rng, players, hg, ag, player_acc)
          end

          nf = n.to_f
          both2c = compute_both_2corners_both_halves(sec_samples, per_half_available, n)
          {
            p_home: round4(home_wins / nf),
            p_draw: round4(draws / nf),
            p_away: round4(away_wins / nf),
            p_btts: round4(btts / nf),
            p_over_25: round4(over25 / nf),
            top_scorelines: top_scorelines(scoreline_counts, nf),
            sim_stats: aggregate_sec(sec_samples, goal_samples, per_half_available),
            per_half_available: per_half_available,
            market_anchor: market_anchor,
            player_events: aggregate_players(player_acc, players, nf),
            p_duplo_green: dg[:p_duplo_green],
            p_duplo_green_home: dg[:p_duplo_green_home],
            p_duplo_green_away: dg[:p_duplo_green_away],
            p_both_2corners_both_halves: both2c
          }
        end

        # ── scoreline sampling ────────────────────────────────────────────
        def build_cdf(matrix)
          cum = []
          acc = 0.0
          matrix.each_with_index do |row, i|
            row.each_with_index do |p, j|
              acc += p
              cum << [acc, i, j]
            end
          end
          cum
        end
        private_class_method :build_cdf

        def sample_scoreline(rng, cdf, _dim)
          r = rng.rand
          cdf.each { |c, i, j| return [i, j] if r <= c }
          _, i, j = cdf.last
          [i, j]
        end
        private_class_method :sample_scoreline

        def top_scorelines(counts, nf)
          counts.sort_by { |_s, c| -c }.first(6).map do |score, c|
            { score: score, prob: round4(c / nf) }
          end
        end
        private_class_method :top_scorelines

        # ── secondary stats ───────────────────────────────────────────────
        def init_sec_samples(secondary, per_half)
          out = {}
          (secondary || {}).each do |metric, sides|
            out[metric] = {}
            sides.each_key do |side|
              out[metric][side] = { total: [] }
              if per_half && half_split?(sides[side])
                out[metric][side][:h1] = []
                out[metric][side][:h2] = []
              end
            end
          end
          out
        end
        private_class_method :init_sec_samples

        def half_split?(cfg)
          cfg.is_a?(Hash) && cfg[:mean_1h] && cfg[:mean_2h]
        end
        private_class_method :half_split?

        def sample_secondary(rng, secondary, per_half, acc)
          (secondary || {}).each do |metric, sides|
            sides.each do |side, cfg|
              acc[metric][side][:total] << SecondaryStats.sample(rng, cfg[:mean], cfg[:dispersion])
              next unless per_half && half_split?(cfg)

              acc[metric][side][:h1] << SecondaryStats.sample(rng, cfg[:mean_1h], cfg[:dispersion])
              acc[metric][side][:h2] << SecondaryStats.sample(rng, cfg[:mean_2h], cfg[:dispersion])
            end
          end
        end
        private_class_method :sample_secondary

        # Emits the CONSUMER contract: side → metric → {p10,p50,p90[,_1h/_2h]}.
        # `goals` is derived from the per-iteration score-model draws (the SAME
        # draws that feed p_home/p_draw/p_away) — full-match only, since the
        # score model has no honest half split (no fabricated 1h/2h, spec §6.5).
        def aggregate_sec(samples, goal_samples, per_half)
          out = { home: {}, away: {} }
          samples.each do |metric, sides|
            sides.each do |side, buckets|
              entry = pctiles(buckets[:total])
              if per_half && buckets[:h1]
                entry[:p10_1h], entry[:p50_1h], entry[:p90_1h] = pct_triplet(buckets[:h1])
                entry[:p10_2h], entry[:p50_2h], entry[:p90_2h] = pct_triplet(buckets[:h2])
              end
              (out[side] ||= {})[metric] = entry
            end
          end
          %i[home away].each do |side|
            out[side] ||= {}
            out[side][:goals] = pctiles(goal_samples[side])
          end
          out
        end
        private_class_method :aggregate_sec

        def pctiles(arr)
          p10, p50, p90 = pct_triplet(arr)
          { p10: p10, p50: p50, p90: p90 }
        end
        private_class_method :pctiles

        def pct_triplet(arr)
          return [0, 0, 0] if arr.nil? || arr.empty?

          s = arr.sort
          [percentile(s, 0.10), percentile(s, 0.50), percentile(s, 0.90)]
        end
        private_class_method :pct_triplet

        def percentile(sorted, q)
          idx = (q * (sorted.length - 1)).round
          sorted[idx]
        end
        private_class_method :percentile

        # ── player events ─────────────────────────────────────────────────
        # Tolerant, CONSISTENT player-name keying. The real in-memory producer
        # (WidgetMerger#flatten_player) builds players with SYMBOL keys, while
        # the spec/JSON shape uses STRING keys. This MUST yield the IDENTICAL
        # string as PlayerAllocation.allocate_event's name
        # (PlayerAllocation.get(p,'name').to_s ⇒ p['name'] || p[:name])
        # so the accumulator built by init_player_acc, the keys
        # allocate_players accumulates under, and the keys aggregate_players
        # reads all AGREE for a given player. This helper mirrors
        # PlayerAllocation.get(p,'name').to_s precedence EXACTLY (string-first,
        # symbol fallback), so it is provably identical for ALL inputs —
        # including the (today unreachable) dual-key hash where both 'name' and
        # :name are present.
        def player_name(p)
          (p['name'] || p[:name]).to_s
        end
        private_class_method :player_name

        def init_player_acc(players)
          acc = {}
          each_player(players) do |_side, p|
            name = player_name(p)
            next if name.empty?

            acc[name] = { goals: 0, scored_iter: 0, cards: 0, sot: 0 }
          end
          acc
        end
        private_class_method :init_player_acc

        def allocate_players(rng, players, hg, ag, acc)
          %i[home away].each do |side|
            cfg = side_cfg(players, side)
            next unless cfg

            xi = cfg[:xi] || cfg['xi']
            goals = side == :home ? hg : ag
            scored_this_iter = {}
            goals.times do
              name = PlayerAllocation.allocate_event(rng, xi, metric: :goals)
              next unless name && acc[name]

              acc[name][:goals] += 1
              scored_this_iter[name] = true
            end
            scored_this_iter.each_key { |name| acc[name][:scored_iter] += 1 }

            # One card draw per iteration per side (low base rate; presence-based).
            cn = PlayerAllocation.allocate_event(rng, xi, metric: :cards)
            acc[cn][:cards] += 1 if cn && acc[cn]
            sn = PlayerAllocation.allocate_event(rng, xi, metric: :sot)
            acc[sn][:sot] += 1 if sn && acc[sn]
          end
        end
        private_class_method :allocate_players

        def aggregate_players(acc, players, nf)
          titular = {}
          conf = {}
          each_side(players) do |_side, cfg|
            (cfg[:xi] || cfg['xi'] || []).each do |p|
              name = player_name(p)
              next if name.empty?

              titular[name] = true
              conf[name] = cfg[:confidence] || cfg['confidence'] || :low
            end
          end

          acc.map do |name, c|
            {
              name: name,
              p_goal: round4(c[:scored_iter] / nf),
              expected_goals: round4(c[:goals] / nf),
              p_card: round4(c[:cards] / nf),
              p_sot: round4(c[:sot] / nf),
              provavel_titular: titular.fetch(name, false),
              confidence: conf.fetch(name, :low)
            }
          end
        end
        private_class_method :aggregate_players

        def side_cfg(players, side)
          return nil unless players.is_a?(Hash)

          players[side] || players[side.to_s]
        end
        private_class_method :side_cfg

        def each_side(players)
          %i[home away].each do |side|
            cfg = side_cfg(players, side)
            yield(side, cfg) if cfg
          end
        end
        private_class_method :each_side

        def each_player(players)
          each_side(players) do |side, cfg|
            (cfg[:xi] || cfg['xi'] || []).each { |p| yield(side, p) }
          end
        end
        private_class_method :each_player

        def round4(v)
          (v.to_f).round(4)
        end
        private_class_method :round4

        # ── pre-match analytic scalars ─────────────────────────────────────────

        # compute_duplo_green — analytic pass over the score-model matrix.
        # Returns { p_duplo_green:, p_duplo_green_home:, p_duplo_green_away: }.
        #
        # For each cell (h, a) in the matrix:
        #   home_not_winning = h <= a  → contributes to p_duplo_green_home via f_plus(h,a,0)
        #   away_not_winning = h >= a  → contributes to p_duplo_green_away via f_minus(h,a,0)
        #   match-level (either): h<a → f_plus; h>a → f_minus; h==a → f_either
        def compute_duplo_green(matrix)
          sum_home = 0.0
          sum_away = 0.0
          sum_either = 0.0

          matrix.each_with_index do |row, h|
            row.each_with_index do |prob, a|
              next if prob <= 0.0

              sum_home   += prob * f_plus(h, a, 0)  if h <= a
              sum_away   += prob * f_minus(h, a, 0) if h >= a
              sum_either += prob * if h < a
                                     f_plus(h, a, 0)
                                   elsif h > a
                                     f_minus(h, a, 0)
                                   else
                                     f_either(h, a, 0)
                                   end
            end
          end

          {
            p_duplo_green:      round4(sum_either),
            p_duplo_green_home: round4(sum_home),
            p_duplo_green_away: round4(sum_away)
          }
        end
        private_class_method :compute_duplo_green

        # f_plus(rh, ra, diff) — P(home lead ever reaches ≥ +2 in a uniform
        # interleaving of rh home goals + ra away goals starting from `diff`).
        # Memoised per call frame via a thread-local cache to avoid re-computing
        # the same sub-problems across matrix cells.
        def f_plus(rh, ra, diff)
          return 1.0 if diff >= 2
          return 0.0 if rh + ra == 0

          f_plus_memo[[rh, ra, diff]] ||= begin
            p = rh.to_f / (rh + ra)
            p * f_plus(rh - 1, ra, diff + 1) + (1 - p) * f_plus(rh, ra - 1, diff - 1)
          end
        end
        private_class_method :f_plus

        def f_minus(rh, ra, diff)
          return 1.0 if diff <= -2
          return 0.0 if rh + ra == 0

          f_minus_memo[[rh, ra, diff]] ||= begin
            p = rh.to_f / (rh + ra)
            p * f_minus(rh - 1, ra, diff + 1) + (1 - p) * f_minus(rh, ra - 1, diff - 1)
          end
        end
        private_class_method :f_minus

        def f_either(rh, ra, diff)
          return 1.0 if diff >= 2 || diff <= -2
          return 0.0 if rh + ra == 0

          f_either_memo[[rh, ra, diff]] ||= begin
            p = rh.to_f / (rh + ra)
            p * f_either(rh - 1, ra, diff + 1) + (1 - p) * f_either(rh, ra - 1, diff - 1)
          end
        end
        private_class_method :f_either

        # Thread-local memo caches for f_plus/f_minus/f_either.
        # Fresh for each MonteCarlo.run call (cleared at compute_duplo_green entry
        # via the initializer pattern: if the key doesn't exist, it's created fresh).
        # Using thread_variable_get/set so parallel Worker threads don't share state.
        def f_plus_memo
          Thread.current[:mc_f_plus_memo] ||= {}
        end
        private_class_method :f_plus_memo

        def f_minus_memo
          Thread.current[:mc_f_minus_memo] ||= {}
        end
        private_class_method :f_minus_memo

        def f_either_memo
          Thread.current[:mc_f_either_memo] ||= {}
        end
        private_class_method :f_either_memo

        # compute_both_2corners_both_halves — counts iterations where both teams
        # had ≥ 2 corners in each half.
        #
        # Returns nil (honest degradation) when:
        #   - per_half_available is false
        #   - the corners metric is absent from sec_samples
        #   - any of the four per-half arrays (h1/h2 for home and away) is missing/empty
        def compute_both_2corners_both_halves(sec_samples, per_half_available, n)
          return nil unless per_half_available

          # Tolerate symbol or string keys (symbol = normal path; string = JSON round-trip).
          corners = sec_samples[:corners] || sec_samples['corners']
          return nil unless corners

          home = corners[:home] || corners['home']
          away = corners[:away] || corners['away']
          return nil unless home && away

          h1h = home[:h1] || home['h1']
          h2h = home[:h2] || home['h2']
          a1h = away[:h1] || away['h1']
          a2h = away[:h2] || away['h2']

          return nil if h1h.nil? || h2h.nil? || a1h.nil? || a2h.nil?
          return nil if h1h.empty? || h2h.empty? || a1h.empty? || a2h.empty?

          count = (0...n).count { |i| h1h[i] >= 2 && h2h[i] >= 2 && a1h[i] >= 2 && a2h[i] >= 2 }
          round4(count.to_f / n)
        end
        private_class_method :compute_both_2corners_both_halves
      end
    end
  end
end
