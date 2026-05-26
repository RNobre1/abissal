module AdamStats
  module Scraper
    module Actuals
      # Mapeamento: chave composta "league_name|country" (ambos lowercase+strip)
      # → api_football_league_id (Integer).
      #
      # Investigado via API em 2026-05-26 (ver ADR-009).
      # `league` e `country` devem vir de fixture_simulations.league e
      # fixture_simulations.country, normalizados (downcase + strip).
      #
      # Ligas sem entrada aqui retornam nil → reconciler marca
      # actual_data_source = 'unresolvable-unsupported_league'.
      LEAGUE_IDS = {
        # Brasil
        'serie a|brazil'           => 71,   # Brasileirão Série A
        'serie b|brazil'           => 72,   # Brasileirão Série B

        # CONMEBOL
        'libertadores|world'       => 13,   # CONMEBOL Libertadores
        'copa libertadores|world'  => 13,
        'conmebol libertadores|world' => 13,
        'sudamericana|world'       => 11,   # CONMEBOL Sudamericana
        'copa sudamericana|world'  => 11,
        'conmebol sudamericana|world' => 11,

        # Europa — Big 5
        'premier league|england'   => 39,
        'championship|england'     => 40,
        'la liga|spain'            => 140,
        'serie a|italy'            => 135,
        'bundesliga|germany'       => 78,
        'ligue 1|france'           => 61,
        'primeira liga|portugal'   => 94,
        'liga nos|portugal'        => 94,   # alias antigo do adamchoi

        # Europa — UEFA
        'uefa champions league|world' => 2,
        'champions league|world'   => 2,
        'uefa europa league|world' => 3,
        'europa league|world'      => 3,

        # América do Norte
        'major league soccer|usa'  => 253,
        'mls|usa'                  => 253,

        # Outros
        'eredivisie|netherlands'   => 88,
      }.freeze

      # Retorna o api_football_league_id para uma combinação de liga + país.
      # Normalização: downcase + strip. Retorna nil se não mapeado.
      def self.league_id_for(league:, country:)
        key = "#{league.to_s.downcase.strip}|#{country.to_s.downcase.strip}"
        LEAGUE_IDS[key]
      end
    end
  end
end
