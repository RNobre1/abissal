module AdamStats
  module Scraper
    module Simulation
      # PlayerAllocation — projects a probable XI from historical participation
      # and distributes a simulated team event (goal/card/SOT) among the XI
      # proportionally to the player's historical rate × expected minutes
      # (spec §6.6). THIS IS A PROJECTION — never the official XI.
      #
      # Pure / deterministic given a seeded `Random`.
      module PlayerAllocation
        XI_SIZE = 11
        # League minutes-per-game proxy: full match. Used only to scale the
        # `minutes` contribution into the titularity RANKING score.
        LEAGUE_MPG = 90.0
        # Hard cap on a player's EXPECTED minutes for the upcoming match.
        # Intentionally a SEPARATE constant from LEAGUE_MPG even though both are
        # 90.0 today: they govern unrelated knobs (ranking-score normalizer vs.
        # per-match minutes cap). Do not "dedupe" them — collapsing into one
        # would couple two independent tuning dimensions.
        FULL_MATCH_MINUTES = 90.0

        module_function

        # players — array of player hashes (string or symbol keys).
        # Returns { players: [top-N excl. injured], confidence: :low/:med/:high }.
        def probable_xi(players)
          roster = Array(players).select { |p| p.is_a?(Hash) && !truthy(get(p, 'injured')) }
          ranked = roster.sort_by { |p| -titularity_score(p) }

          xi = ranked.first(XI_SIZE)
          { players: xi, confidence: confidence_for(ranked) }
        end

        # Distribute one team event among the XI ∝ (rate × expected_minutes).
        # metric: :goals | :cards | :sot. Returns the chosen player's name, or
        # nil when no player has any rate for that metric.
        def allocate_event(rng, xi, metric:)
          weighted = Array(xi).map do |p|
            [get(p, 'name').to_s, event_weight(p, metric)]
          end.reject { |_n, w| w <= 0 }
          return nil if weighted.empty?

          total = weighted.sum { |_n, w| w }
          r = rng.rand * total
          acc = 0.0
          weighted.each do |name, w|
            acc += w
            return name if r <= acc
          end
          weighted.last.first
        end

        # score = started + minutes / league_mpg  (spec §6.6a)
        def titularity_score(p)
          started = numf(get(p, 'started'))
          minutes = numf(get(p, 'minutes'))
          started + (minutes / LEAGUE_MPG)
        end
        private_class_method :titularity_score

        def event_weight(p, metric)
          minutes = numf(get(p, 'minutes'))
          return 0.0 if minutes <= 0

          numerator =
            case metric
            when :goals then numf(get(p, 'goals'))
            when :cards then numf(get(p, 'yellows')) + numf(get(p, 'reds'))
            when :sot then numf(get(p, 'shots_on_target'))
            else 0.0
            end
          rate = numerator / minutes
          rate * expected_minutes(p)
        end
        private_class_method :event_weight

        # Expected minutes for the match: cap historical avg minutes/game at a
        # full match. A regular starter ⇒ ≈ 90; rotational ⇒ less.
        def expected_minutes(p)
          minutes = numf(get(p, 'minutes'))
          # Approximate appearances from `started` (subs add little volume).
          apps = [numf(get(p, 'started')), 1.0].max
          per_game = minutes / apps
          [per_game, FULL_MATCH_MINUTES].min
        end
        private_class_method :expected_minutes

        # Confidence from the ranking margin between the 11th and 12th player.
        def confidence_for(ranked)
          return :low if ranked.size <= XI_SIZE

          s11 = titularity_score(ranked[XI_SIZE - 1])
          s12 = titularity_score(ranked[XI_SIZE])
          margin = s11 - s12
          if margin >= 8.0 then :high
          elsif margin >= 3.0 then :med
          else :low
          end
        end
        private_class_method :confidence_for

        def get(hash, key)
          hash[key] || hash[key.to_sym] || hash[key.to_s]
        end
        private_class_method :get

        def numf(v)
          Float(v)
        rescue ArgumentError, TypeError
          0.0
        end
        private_class_method :numf

        def truthy(v)
          v == true || v == 'true' || v == 't'
        end
        private_class_method :truthy
      end
    end
  end
end
