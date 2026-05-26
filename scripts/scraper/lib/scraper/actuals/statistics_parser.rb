module AdamStats
  module Scraper
    module Actuals
      # Parseia a resposta de GET /fixtures/statistics da API-Football.
      #
      # Response shape esperado:
      #   [
      #     { "team" => { "name" => "Arsenal" },
      #       "statistics" => [
      #         { "type" => "Shots on Goal", "value" => 5 },
      #         { "type" => "Corner Kicks",  "value" => 7 },
      #         { "type" => "Yellow Cards",  "value" => 2 },
      #         { "type" => "Red Cards",     "value" => 0 }, ...
      #       ]
      #     },
      #     { ... away ... }
      #   ]
      #
      # Retorna hash { home: {sot:, corners:, cards:}, away: {sot:, corners:, cards:} }
      # ou nil se a resposta estiver vazia / times não identificados.
      #
      # Campos com value=nil na resposta → nil no resultado (liga sem coverage).
      # Cards = yellow_cards + red_cards.
      #
      # Identificação home/away: exact match após normalização (downcase+strip).
      # Se um time não bater, retorna nil — o reconciler marcará stats_unavailable.
      class StatisticsParser
        # Normaliza string para comparação: lowercase + strip.
        # Sem remoção de diacríticos (muda encoding) — os nomes geralmente
        # são ASCII nos dados da API-Football.
        def self.normalize(str)
          str.to_s.downcase.strip
        end

        # Parseia response do /fixtures/statistics.
        # home: nome do time mandante (vem de fixture_simulations.home_team)
        # away: nome do time visitante (vem de fixture_simulations.away_team)
        def self.parse(response, home:, away:)
          return nil if response.nil? || response.empty?

          home_norm = normalize(home)
          away_norm = normalize(away)

          home_entry = nil
          away_entry = nil

          response.each do |entry|
            team_name = normalize(entry.dig('team', 'name'))
            if team_name == home_norm
              home_entry = entry
            elsif team_name == away_norm
              away_entry = entry
            end
          end

          # Se nenhum dos times bateu, retorna nil (caller loga stats_unavailable)
          return nil if home_entry.nil? && away_entry.nil?

          {
            home: parse_team_stats(home_entry),
            away: parse_team_stats(away_entry)
          }
        end

        def self.parse_team_stats(entry)
          return { sot: nil, corners: nil, cards: nil } if entry.nil?

          stats = entry.fetch('statistics', [])
          stat_map = stats.each_with_object({}) do |s, h|
            h[s['type']] = s['value']
          end

          yellow = stat_map['Yellow Cards']
          red    = stat_map['Red Cards']
          cards  = if yellow.nil? && red.nil?
                     nil
                   else
                     (yellow.to_i) + (red.to_i)
                   end

          {
            sot:     stat_map['Shots on Goal'],
            corners: stat_map['Corner Kicks'],
            cards:   cards
          }
        end
        private_class_method :parse_team_stats
      end
    end
  end
end
