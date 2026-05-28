module AdamStats
  module Scraper
    # Extrai os resultados FT de um widget `recent_results` do choistats.
    #
    # IMPORTANTE: o objeto `fixture` (header) só carrega gols + reds
    # (`homeGoalsFt/awayGoalsFt/homeReds/awayReds`). Os stats secundários
    # (corners/SOT/cards/yellows) NÃO ficam ali — ficam no entry de
    # `recentHomeResults`/`recentAwayResults` cujo `id == fixture_id`: o jogo
    # recém-disputado aparece como o resultado mais recente de cada time, com
    # stats completos. Verificado empiricamente 2026-05-28 (ver
    # docs/external-apis/choistats/choistats-api.md). Corrige a premissa errada
    # da investigação Wave G/W-R (2026-05-25).
    module FtActuals
      module_function

      ENTRY_ARRAYS = %w[
        recentHomeResults recentHomeAllResults
        recentAwayResults recentAwayAllResults
      ].freeze

      # @return [Hash, nil] nil se o jogo não está FT ou sem gols. Caso FT:
      #   { home_goals:, away_goals:, has_secondary:,
      #     home_corners:, away_corners:, home_sot:, away_sot:,
      #     home_cards:, away_cards: }  (chaves secundárias ausentes se indisponíveis)
      def from_widget(widget, fixture_id)
        fixture = widget&.dig('fixture') || {}
        return nil unless fixture['status'] == 'FT'

        hg = fixture['homeGoalsFt']
        ag = fixture['awayGoalsFt']
        return nil if hg.nil? || ag.nil?

        out = { home_goals: hg.to_i, away_goals: ag.to_i, has_secondary: false }
        merge_secondary!(out, find_entry(widget, fixture_id))
        out
      end

      def find_entry(widget, fixture_id)
        return nil unless widget

        fid = fixture_id.to_i
        ENTRY_ARRAYS.each do |key|
          arr = widget[key]
          next unless arr.is_a?(Array)

          entry = arr.find { |e| e.is_a?(Hash) && e['id'].to_i == fid }
          return entry if entry
        end
        nil
      end

      # Preenche corners/SOT/cards no out se o entry trouxer os campos.
      # cards = yellows + reds (cada cartão = 1; yellowReds já contam nos yellows).
      def merge_secondary!(out, entry)
        return unless entry

        if num?(entry['homeCorners']) && num?(entry['awayCorners'])
          out[:home_corners] = entry['homeCorners'].to_i
          out[:away_corners] = entry['awayCorners'].to_i
        end

        if num?(entry['homeShotsOnTarget']) && num?(entry['awayShotsOnTarget'])
          out[:home_sot] = entry['homeShotsOnTarget'].to_i
          out[:away_sot] = entry['awayShotsOnTarget'].to_i
        end

        if num?(entry['homeYellows']) && num?(entry['awayYellows'])
          out[:home_cards] = entry['homeYellows'].to_i + entry['homeReds'].to_i
          out[:away_cards] = entry['awayYellows'].to_i + entry['awayReds'].to_i
        end

        out[:has_secondary] = out.key?(:home_corners) || out.key?(:home_sot) || out.key?(:home_cards)
      end

      def num?(v)
        v.is_a?(Numeric) || (v.is_a?(String) && v.match?(/\A-?\d+\z/))
      end
    end
  end
end
