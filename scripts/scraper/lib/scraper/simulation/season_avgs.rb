# frozen_string_literal: true

module AdamStats
  module Scraper
    module Simulation
      # SeasonAvgs — normaliza o bloco `avgs` do choistats quando ele vem ZERADO.
      #
      # PROBLEMA (auditoria 2026-07-29): time sem jogos na temporada nova volta do
      # choistats com o bloco inteiro em zero — `num_matches: 0` implica 100% de
      # `avgGoalsFor: 0`, `cornersFor: 0`, `cardsFor: 0`. Isso NÃO significa "esse
      # time faz zero escanteios"; significa "ainda não há médias de temporada".
      #
      # A simulação tratava o 0 como projeção real e devolvia p50 = 0. Com a
      # virada da temporada europeia isso chegou a 38% dos jogos (30/07/2026):
      # a média projetada de escanteios caiu de 9.4 para 5.6, e a calibração
      # semanal perseguiu a queda — k de 1.05 (junho) para 1.5672 (26/07),
      # inflando em ~57% justamente os jogos que TINHAM dados bons.
      #
      # SOLUÇÃO: reconstruir o bloco a partir de `recent_matches` — os últimos
      # ~10 jogos reais do time, que atravessam a virada de temporada. 84% dos
      # times afetados têm essa série completa (medido em prod). Quem não tem
      # cai em `unsimulable` pelo guard normal do runner — degradação honesta,
      # nunca número inventado.
      #
      # Puro: recebe e devolve Hash, sem I/O.
      module SeasonAvgs
        module_function

        # Campos de `avgs` que a simulação consome, e de onde tirá-los na série.
        # `:own`/`:opp` = perspectiva do time (mandante lê home*, visitante away*).
        DERIVED = {
          'avgGoalsFor' => { own: 'GoalsFt' },
          'avgGoalsAg' => { opp: 'GoalsFt' },
          'cornersFor' => { own: 'Corners' },
          'cornersAg' => { opp: 'Corners' },
          'cardsFor' => { own: 'Yellows' },
          'shotsOnTargetFor' => { own: 'ShotsOnTarget' },
          'bookingPointsFor' => { own: 'BookingPoints' },
          'firstHalfGoalsFor' => { own: 'GoalsHt' },
          'cornersFor1h' => { own: 'Corners1h' },
          'cornersFor2h' => { own: 'Corners2h' }
        }.freeze

        # Um bloco está degenerado quando não tem jogos na temporada. `num_matches`
        # zero/ausente é o sinal canônico; sem ele, `avgGoalsFor` não-positivo
        # serve de proxy (nenhum time real tem média de gols exatamente zero numa
        # temporada com jogos).
        def degenerate?(block)
          return true unless block.is_a?(Hash)

          nm = num(block['num_matches']) || num(block['numMatches'])
          return true if nm && nm <= 0

          g = num(block['avgGoalsFor'])
          nm.nil? && (g.nil? || g <= 0)
        end

        # Reconstrói `avgs` derivando de `recent_matches` os blocos degenerados.
        # Blocos saudáveis passam intactos — os avgs de temporada continuam sendo
        # a fonte preferida (amostra maior e já normalizada por mando).
        #
        # @param avgs   hash `avgs` do detail_json (pode ser nil)
        # @param recent hash `recent_matches` com 'home'/'away' (pode ser nil)
        # @return hash `avgs` normalizado, ou o original quando nada a fazer
        def fill(avgs, recent)
          return avgs unless avgs.is_a?(Hash)

          home_series = series(recent, 'home')
          away_series = series(recent, 'away')

          out = avgs.dup
          [
            ['home_home', home_series, :home],
            ['home_overall', home_series, :home],
            ['away_away', away_series, :away],
            ['away_overall', away_series, :away]
          ].each do |key, matches, side|
            block = avgs[key]
            next unless degenerate?(block)

            derived = derive(matches, side)
            out[key] = block.is_a?(Hash) ? block.merge(derived) : derived unless derived.empty?
          end
          out
        end

        def series(recent, side)
          return [] unless recent.is_a?(Hash)

          Array(recent[side] || recent[side.to_sym]).select do |m|
            m.is_a?(Hash) && (m['status'] == 'FT' || m[:status] == 'FT')
          end
        end
        private_class_method :series

        # Média de cada campo derivável. Só emite a chave quando há ≥2 valores
        # (mesmo piso do `series_mean_cfg` do runner) e a média é positiva —
        # do contrário o runner segue sem o campo e degrada honestamente.
        def derive(matches, side)
          return {} if matches.size < 2

          out = {}
          DERIVED.each do |avg_key, spec|
            perspective, suffix = spec.first
            prefix = if perspective == :own
                       side == :home ? 'home' : 'away'
                     else
                       side == :home ? 'away' : 'home'
                     end
            vals = matches.filter_map { |m| num(m["#{prefix}#{suffix}"]) }
            next if vals.size < 2

            mean = vals.sum.to_f / vals.size
            next unless mean.positive?

            out[avg_key] = mean
          end
          out['num_matches'] = matches.size unless out.empty?
          out
        end
        private_class_method :derive

        def num(v)
          return nil if v.nil?

          f = Float(v)
          f.finite? ? f : nil
        rescue ArgumentError, TypeError
          nil
        end
        private_class_method :num
      end
    end
  end
end
