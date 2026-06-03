module AdamStats
  module Scraper
    # Configuração GLOBAL do app lida do Postgres (tabela `app_settings`).
    # Espelha o lado TS (`lib/settings/ai-toggle.ts`). Default graceful = LIGADO:
    # em qualquer ausência/erro (tabela inexistente, sem linha, falha de query)
    # NÃO derruba o pipeline — assume IA ligada. Só `false` explícito desliga.
    module GlobalConfig
      module_function

      AI_ENABLED_SQL = "SELECT value FROM app_settings WHERE key = 'ai_enabled'".freeze

      # Kill switch global de IA. Quando false, o recomendador IA-2 (e todo uso
      # de LLM) é pulado. `conn` é uma PG::Connection já aberta.
      def ai_enabled?(conn, logger: ->(m) { warn m })
        res = conn.exec(AI_ENABLED_SQL)
        return true if res.ntuples.zero?

        # jsonb boolean vem como texto 'true'/'false'.
        res.getvalue(0, 0).to_s.strip.downcase != 'false'
      rescue StandardError => e
        logger.call("[global-config] ai_enabled? falhou (assumindo LIGADO): #{e.class}: #{e.message}")
        true
      end
    end
  end
end
