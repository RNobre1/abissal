require 'digest'
require_relative 'season_avgs'
require_relative 'rates'
require_relative 'score_model'
require_relative 'secondary_stats'
require_relative 'player_allocation'
require_relative 'monte_carlo'
require_relative 'league_calibration'

module AdamStats
  module Scraper
    module Simulation
      # Runner — orchestrates the simulation modules from an enriched
      # detail_json and returns a ready-to-persist SCALAR hash. Degrades
      # honestly and NEVER raises (spec §6.5):
      #   - possession absent ⇒ not emitted (never simulated)
      #   - no HT split ⇒ per_half_available: false
      #   - insufficient/garbage detail ⇒ { status: 'unsimulable' }, no raise.
      module Runner
        # v8 (2026-07-29): SeasonAvgs — bloco `avgs` zerado (time sem jogos na
        # temporada nova) passa a derivar de `recent_matches` em vez de projetar
        # ZERO. Bump obrigatório: as sims v7 gravadas com projeção degenerada não
        # podem se misturar às novas na calibração.
        MODEL_VERSION = 'sim-v1-poisson-dc-nb-mc10k-v8'.freeze
        DEFAULT_N = 10_000
        # Baseline-day fallback threshold (POC: < 6 teams ⇒ noisy day slice).
        MIN_TEAMS_FOR_DAY_BASELINE = 6
        # Per-league Dixon-Coles ρ (default; overridable per league).
        DEFAULT_RHO = -0.10
        RHO_BY_LEAGUE = {}.freeze

        # F6 — Referee coupling on cards.
        # Baseline-PER-SIDE booking points: empirical median from prod sample
        # (avg_total ≈ 45-50 ⇒ ≈ 22.5 per side). F4 will override per-league
        # via model_calibration.
        LEAGUE_AVG_BOOKING_POINTS_PER_SIDE = 22.5
        # Blend weight: 60% team baseline / 40% referee (conservative — ref
        # samples are 12-50 fixtures, signal-but-noisy).
        REFEREE_WEIGHT = 0.4
        # Clamp the raw multiplier so an outlier sample (tiny n, weird league)
        # can never push card λ outside [0.5×, 2.0×] pre-blend.
        REFEREE_MULT_MIN = 0.5
        REFEREE_MULT_MAX = 2.0

        # Neutral persisted fallback baseline (spec §6.4 / POC N=6 fallback).
        NEUTRAL_BASELINE = {
          'avg_goals_for' => 1.35,
          'avg_goals_ag' => 1.35,
          'avg_goals_home' => 1.50,
          'avg_goals_away' => 1.15
        }.freeze

        module_function

        def simulate(detail_json, n: DEFAULT_N, calibration: {}, use_xg_proxy: false)
          d = detail_json
          return unsimulable unless d.is_a?(Hash)

          # Time sem jogos na temporada nova volta do choistats com o bloco
          # `avgs` inteiro zerado. Antes de qualquer guard, reconstrói esses
          # blocos a partir de `recent_matches` (ver SeasonAvgs). Sem isso a sim
          # projetava ZERO — 38% dos jogos em 30/07/2026, com a virada europeia.
          avgs = SeasonAvgs.fill(fetch(d, 'avgs'), fetch(d, 'recent_matches'))
          return unsimulable unless usable_avgs?(avgs)

          league = (fetch(d, 'league') || '').to_s
          league_avgs = league_baseline(league, calibration)
          lambdas = Rates.lambdas(d, league_avgs, use_xg_proxy: use_xg_proxy)
          return unsimulable if lambdas.nil?

          rho = rho_for(league, calibration)
          per_half = per_half_available?(avgs)
          secondary = build_secondary(avgs, d, per_half)
          players = build_players(d)
          seed = derive_seed(d)

          mc = MonteCarlo.run(
            seed: seed,
            n: n,
            lambda_home: lambdas[:home],
            lambda_away: lambdas[:away],
            rho: rho,
            secondary: secondary,
            per_half_available: per_half,
            market_anchor: market_anchor(d),
            players: players
          )

          {
            status: 'pending',
            model_version: MODEL_VERSION,
            p_home: mc[:p_home],
            p_draw: mc[:p_draw],
            p_away: mc[:p_away],
            p_btts: mc[:p_btts],
            p_over_25: mc[:p_over_25],
            top_scorelines: mc[:top_scorelines],
            sim_stats: mc[:sim_stats],
            per_half_available: mc[:per_half_available],
            market_anchor: mc[:market_anchor],
            player_events: mc[:player_events],
            p_duplo_green: mc[:p_duplo_green],
            p_duplo_green_home: mc[:p_duplo_green_home],
            p_duplo_green_away: mc[:p_duplo_green_away],
            p_both_2corners_both_halves: mc[:p_both_2corners_both_halves]
          }
        rescue StandardError
          # Honest degradation — one bad fixture must never raise (Lição #11).
          unsimulable
        end

        def unsimulable
          { status: 'unsimulable', model_version: MODEL_VERSION }
        end
        private_class_method :unsimulable

        def usable_avgs?(avgs)
          return false unless avgs.is_a?(Hash)

          hh = fetch(avgs, 'home_home')
          aa = fetch(avgs, 'away_away')
          return false unless hh.is_a?(Hash) && aa.is_a?(Hash)

          # POSITIVO, não apenas não-nil: `avgGoalsFor: 0` é o que o choistats
          # devolve pra time sem jogos na temporada, e 0.0 passava neste guard
          # (0 não é nil), fazendo a sim projetar zero em tudo. Quando há série
          # recente o SeasonAvgs já preencheu antes daqui; se chegou zerado até
          # este ponto, não há dado nenhum e a fixture é honestamente
          # insimulável. Auditoria 2026-07-29.
          h = val(hh, 'avgGoalsFor')
          a = val(aa, 'avgGoalsFor')
          !h.nil? && h.positive? && !a.nil? && a.positive?
        end
        private_class_method :usable_avgs?

        # F4a — League baseline agora vem da tabela `league_parameters`
        # (via LeagueCalibration); fallback transparente p/ NEUTRAL_BASELINE
        # quando a liga ou param ausente.
        #
        # Histórico: pré-F4a era um day-slice degradado (sempre NEUTRAL_BASELINE
        # porque single-fixture nunca atingia MIN_TEAMS_FOR_DAY_BASELINE).
        # F4b carrega ρ + avg_goals_* por liga; aqui só fazemos lookup.
        def league_baseline(league, calibration)
          LeagueCalibration.baseline_for(league, calibration)
        end
        private_class_method :league_baseline

        # F4a — ρ Dixon-Coles agora vem da tabela `league_parameters`
        # (via LeagueCalibration); fallback transparente p/ DEFAULT_RHO.
        # Histórico: pré-F4a era `RHO_BY_LEAGUE.fetch(league.downcase, ...)`
        # com RHO_BY_LEAGUE = {} (sempre caía no default).
        def rho_for(league, calibration)
          LeagueCalibration.rho_for(league, calibration)
        end
        private_class_method :rho_for

        # Per-half split exists ONLY for corners & goals (spec §6.2).
        def per_half_available?(avgs)
          hh = fetch(avgs, 'home_home')
          return false unless hh.is_a?(Hash)

          !val(hh, 'cornersFor1h').nil? && !val(hh, 'firstHalfGoalsFor').nil?
        end
        private_class_method :per_half_available?

        def build_secondary(avgs, d, per_half)
          hh = fetch(avgs, 'home_home') || {}
          aa = fetch(avgs, 'away_away') || {}
          rm = fetch(d, 'recent_matches') || {}
          home_rm = Array(fetch(rm, 'home'))
          away_rm = Array(fetch(rm, 'away'))
          ref = fetch(d, 'referee_record')

          sec = {}
          corners_home = corner_cfg(hh, home_rm, 'homeCorners', per_half)
          corners_away = corner_cfg(aa, away_rm, 'awayCorners', per_half)
          sec[:corners] = { home: corners_home, away: corners_away } if corners_home && corners_away

          # F6: cards take a per-side referee adjustment when available.
          cards_home = card_cfg(hh, home_rm, 'homeBookingPoints', ref, 'avg_home_booking_points')
          cards_away = card_cfg(aa, away_rm, 'awayBookingPoints', ref, 'avg_away_booking_points')
          sec[:cards] = { home: cards_home, away: cards_away } if cards_home && cards_away

          sot_home = simple_cfg(hh, 'shotsOnTargetFor', home_rm, 'homeShotsOnTarget')
          sot_away = simple_cfg(aa, 'shotsOnTargetFor', away_rm, 'awayShotsOnTarget')
          sec[:sot] = { home: sot_home, away: sot_away } if sot_home && sot_away

          # F12 — categorias sem season-avg em `avgs.*`: deriva mean+dispersão
          # da própria série recent_matches. Cada lado lê o field correspondente
          # (home → homeXxx, away → awayXxx). Quando QUALQUER lado não tem ≥2
          # valores válidos, a categoria é OMITIDA do sim_stats (degradação
          # graciosa — nunca zera).
          fouls_home = series_mean_cfg(home_rm, 'homeFouls')
          fouls_away = series_mean_cfg(away_rm, 'awayFouls')
          sec[:fouls] = { home: fouls_home, away: fouls_away } if fouls_home && fouls_away

          offsides_home = series_mean_cfg(home_rm, 'homeOffsides')
          offsides_away = series_mean_cfg(away_rm, 'awayOffsides')
          sec[:offsides] = { home: offsides_home, away: offsides_away } if offsides_home && offsides_away

          tackles_home = series_mean_cfg(home_rm, 'homeTackles')
          tackles_away = series_mean_cfg(away_rm, 'awayTackles')
          sec[:tackles] = { home: tackles_home, away: tackles_away } if tackles_home && tackles_away

          sec
        end
        private_class_method :build_secondary

        def corner_cfg(block, recent, field, per_half)
          mean = val(block, 'cornersFor')
          return nil if mean.nil?

          cfg = {
            mean: mean,
            dispersion: SecondaryStats.dispersion_from(recent.map { |m| m[field] })
          }
          if per_half
            c1 = val(block, 'cornersFor1h')
            c2 = val(block, 'cornersFor2h')
            if c1 && c2
              cfg[:mean_1h] = c1
              cfg[:mean_2h] = c2
            end
          end
          cfg
        end
        private_class_method :corner_cfg

        def card_cfg(block, recent, field, ref_record = nil, ref_side_key = nil)
          mean = val(block, 'cardsFor') || val(block, 'bookingPointsFor')
          return nil if mean.nil?

          adjusted = apply_referee_adjustment(mean, ref_record, ref_side_key)

          { mean: adjusted, dispersion: SecondaryStats.dispersion_from(recent.map { |m| m[field] }) }
        end
        private_class_method :card_cfg

        # F6 — Relative, clamped, blended referee adjustment on the team
        # card-mean. Degrades gracefully (returns `mean` unchanged) when the
        # referee record is missing or doesn't have the side-specific field
        # populated. Never raises.
        #
        #   mult     = clamp(side_bp / BASELINE, MULT_MIN, MULT_MAX)
        #   mean_adj = mean * (1 + (mult - 1) * REFEREE_WEIGHT)
        def apply_referee_adjustment(mean, ref_record, ref_side_key)
          return mean unless ref_record.is_a?(Hash)
          return mean if ref_side_key.nil?

          side_bp = val(ref_record, ref_side_key)
          return mean if side_bp.nil? || side_bp <= 0

          raw_mult = side_bp / LEAGUE_AVG_BOOKING_POINTS_PER_SIDE
          mult = [[raw_mult, REFEREE_MULT_MIN].max, REFEREE_MULT_MAX].min
          mean * (1 + ((mult - 1) * REFEREE_WEIGHT))
        end
        private_class_method :apply_referee_adjustment

        def simple_cfg(block, mean_key, recent, field)
          mean = val(block, mean_key)
          return nil if mean.nil?

          { mean: mean, dispersion: SecondaryStats.dispersion_from(recent.map { |m| m[field] }) }
        end
        private_class_method :simple_cfg

        # F12 — para categorias sem season-avg em `avgs.*` (fouls, offsides,
        # tackles): deriva o mean da própria série `recent_matches` e a
        # dispersão NB do mesmo conjunto. Retorna nil quando a série não tem
        # ≥2 valores válidos OU quando o mean ≤ 0 — nesses casos a categoria
        # é OMITIDA do sim_stats em vez de zerada (degradação honesta).
        def series_mean_cfg(recent, field)
          vals = Array(recent).map { |m| m && m[field] }.compact.map { |v| Float(v) rescue nil }.compact
          return nil if vals.size < 2

          mean = vals.sum.to_f / vals.size
          return nil if mean <= 0

          { mean: mean, dispersion: SecondaryStats.dispersion_from(vals) }
        end
        private_class_method :series_mean_cfg

        def build_players(d)
          ps = fetch(d, 'player_stats')
          return { home: empty_side, away: empty_side } unless ps.is_a?(Hash)

          odds_by_player = extract_anytime_scorer_odds(d)
          {
            home: side_players(fetch(ps, 'home'), odds_by_player),
            away: side_players(fetch(ps, 'away'), odds_by_player)
          }
        end
        private_class_method :build_players

        # F10 — lê outcome_odds_by_player.ANYTIME_SCORER mantendo só odds
        # numéricas > 1.0. Devolve { player_name => odd }.
        def extract_anytime_scorer_odds(d)
          pe = fetch(d, 'player_extra')
          return {} unless pe.is_a?(Hash)

          odds = fetch(pe, 'outcome_odds_by_player')
          return {} unless odds.is_a?(Hash)

          out = {}
          odds.each do |name, markets|
            next unless name.is_a?(String) && markets.is_a?(Hash)

            raw = markets['ANYTIME_SCORER'] || markets[:ANYTIME_SCORER]
            odd = numeric_or_nil(raw)
            out[name] = odd if odd && odd > 1.0
          end
          out
        end
        private_class_method :extract_anytime_scorer_odds

        def numeric_or_nil(v)
          return nil if v.nil?

          f = Float(v)
          return nil if f.nan? || f.infinite?

          f
        rescue ArgumentError, TypeError
          nil
        end
        private_class_method :numeric_or_nil

        def side_players(side, odds_by_player = {})
          return empty_side unless side.is_a?(Hash)

          list = Array(fetch(side, 'top_players'))
          return empty_side if list.empty?

          # F10 — anexa anytime_scorer_odd ao hash do player quando temos
          # sinal de mercado pelo nome. Não muta o hash original.
          enriched = list.map do |p|
            next p unless p.is_a?(Hash)

            name = p['name'] || p[:name]
            odd = odds_by_player[name]
            odd ? p.merge('anytime_scorer_odd' => odd) : p
          end

          xi = PlayerAllocation.probable_xi(enriched)
          { xi: xi[:players], confidence: xi[:confidence] }
        end
        private_class_method :side_players

        def empty_side
          { xi: [], confidence: :low }
        end
        private_class_method :empty_side

        def market_anchor(d)
          dev = fetch(d, 'odds_devigged')
          return {} unless dev.is_a?(Hash)

          # Keep only the headline 1X2-ish market to stay scalar-small.
          %w[Result Match\ Result 1X2].each do |k|
            return { k => dev[k] } if dev[k].is_a?(Hash)
          end
          {}
        end
        private_class_method :market_anchor

        # Deterministic seed derived from the fixture identity ⇒ stable across
        # re-runs of the same fixture (reproducible) but distinct per fixture.
        #
        # Seed material is restricted to identity that is INVARIANT in
        # detail_json across re-scrapes: home|away|league. kickoff_utc is
        # deliberately EXCLUDED — it may be absent or differently formatted
        # ('2026-05-18T20:00:00Z' vs '2026-05-18 20:00:00 UTC') between scrape
        # runs, which would silently change the whole simulation day-to-day and
        # muddy T4 calibration. Determinism (not uniqueness) is the contract;
        # distinct fixtures already diverge via their `avgs` Monte Carlo inputs.
        def derive_seed(d)
          key = [
            fetch(d, 'home_team'), fetch(d, 'away_team'),
            fetch(d, 'league')
          ].map(&:to_s).join('|')
          Digest::SHA256.hexdigest(key)[0, 12].to_i(16)
        end
        private_class_method :derive_seed

        def fetch(h, k)
          return nil unless h.is_a?(Hash)

          h[k] || h[k.to_sym] || h[k.to_s]
        end
        private_class_method :fetch

        def val(h, k)
          v = fetch(h, k)
          return nil if v.nil?

          Float(v)
        rescue ArgumentError, TypeError
          nil
        end
        private_class_method :val
      end
    end
  end
end
