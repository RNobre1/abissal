require 'digest'
require_relative 'rates'
require_relative 'score_model'
require_relative 'secondary_stats'
require_relative 'player_allocation'
require_relative 'monte_carlo'

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
        MODEL_VERSION = 'sim-v1-poisson-dc-nb-mc10k'.freeze
        DEFAULT_N = 10_000
        # Baseline-day fallback threshold (POC: < 6 teams ⇒ noisy day slice).
        MIN_TEAMS_FOR_DAY_BASELINE = 6
        # Per-league Dixon-Coles ρ (default; overridable per league).
        DEFAULT_RHO = -0.10
        RHO_BY_LEAGUE = {}.freeze

        # Neutral persisted fallback baseline (spec §6.4 / POC N=6 fallback).
        NEUTRAL_BASELINE = {
          'avg_goals_for' => 1.35,
          'avg_goals_ag' => 1.35,
          'avg_goals_home' => 1.50,
          'avg_goals_away' => 1.15
        }.freeze

        module_function

        def simulate(detail_json, n: DEFAULT_N)
          d = detail_json
          return unsimulable unless d.is_a?(Hash)

          avgs = fetch(d, 'avgs')
          return unsimulable unless usable_avgs?(avgs)

          league_avgs = league_baseline(avgs)
          lambdas = Rates.lambdas(d, league_avgs)
          return unsimulable if lambdas.nil?

          rho = rho_for(d)
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
            player_events: mc[:player_events]
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

          !val(hh, 'avgGoalsFor').nil? && !val(aa, 'avgGoalsFor').nil?
        end
        private_class_method :usable_avgs?

        # Day-slice league baseline. The current single-fixture invocation only
        # ever sees the two teams in this fixture (< MIN_TEAMS_FOR_DAY_BASELINE
        # distinct samples), so we always degrade to the neutral persisted
        # baseline (spec §6.4 / POC §2). The multi-fixture aggregation branch
        # (and the `mean` helper it used) was dead — no caller passes a wider
        # day slice today — so it was removed (YAGNI). `avgs` is still accepted
        # so a future day-slice caller can reintroduce aggregation here without
        # changing the call site.
        def league_baseline(_avgs)
          NEUTRAL_BASELINE
        end
        private_class_method :league_baseline

        def rho_for(d)
          league = (fetch(d, 'league') || '').to_s.downcase
          RHO_BY_LEAGUE.fetch(league, DEFAULT_RHO)
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

          sec = {}
          corners_home = corner_cfg(hh, home_rm, 'homeCorners', per_half)
          corners_away = corner_cfg(aa, away_rm, 'awayCorners', per_half)
          sec[:corners] = { home: corners_home, away: corners_away } if corners_home && corners_away

          cards_home = card_cfg(hh, home_rm, 'homeBookingPoints')
          cards_away = card_cfg(aa, away_rm, 'awayBookingPoints')
          sec[:cards] = { home: cards_home, away: cards_away } if cards_home && cards_away

          sot_home = simple_cfg(hh, 'shotsOnTargetFor', home_rm, 'homeShotsOnTarget')
          sot_away = simple_cfg(aa, 'shotsOnTargetFor', away_rm, 'awayShotsOnTarget')
          sec[:sot] = { home: sot_home, away: sot_away } if sot_home && sot_away

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

        def card_cfg(block, recent, field)
          mean = val(block, 'cardsFor') || val(block, 'bookingPointsFor')
          return nil if mean.nil?

          { mean: mean, dispersion: SecondaryStats.dispersion_from(recent.map { |m| m[field] }) }
        end
        private_class_method :card_cfg

        def simple_cfg(block, mean_key, recent, field)
          mean = val(block, mean_key)
          return nil if mean.nil?

          { mean: mean, dispersion: SecondaryStats.dispersion_from(recent.map { |m| m[field] }) }
        end
        private_class_method :simple_cfg

        def build_players(d)
          ps = fetch(d, 'player_stats')
          return { home: empty_side, away: empty_side } unless ps.is_a?(Hash)

          {
            home: side_players(fetch(ps, 'home')),
            away: side_players(fetch(ps, 'away'))
          }
        end
        private_class_method :build_players

        def side_players(side)
          return empty_side unless side.is_a?(Hash)

          list = Array(fetch(side, 'top_players'))
          return empty_side if list.empty?

          xi = PlayerAllocation.probable_xi(list)
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
