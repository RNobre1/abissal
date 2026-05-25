module AdamStats
  module Scraper
    module AiReco
      # Tabela de preços dos modelos OpenRouter usados (consultada 2026-05-24).
      # Atualizar quando OpenRouter mudar (raro). Modelo ausente → custo = 0
      # (degradação aceitável: tracking continua, só cost_usd vira 0).
      #
      # Espelha lib/ai-reco/pricing.ts — qualquer mudança deve ser sincronizada.
      module Pricing
        MODEL_PRICING_USD_PER_1M_TOKENS = {
          'deepseek/deepseek-r1'        => { in: 0.55, out: 2.19 },
          'deepseek/deepseek-v3.2'      => { in: 0.27, out: 1.10 },
          'anthropic/claude-sonnet-4.5' => { in: 3.00, out: 15.00 }
        }.freeze

        module_function

        # @param model [String] ex: 'deepseek/deepseek-r1'
        # @param prompt_tokens [Integer]
        # @param completion_tokens [Integer]
        # @return [Float] custo em USD (0 se modelo desconhecido)
        def compute_cost_usd(model, prompt_tokens, completion_tokens)
          p = MODEL_PRICING_USD_PER_1M_TOKENS[model]
          return 0 unless p

          (prompt_tokens.to_f * p[:in] + completion_tokens.to_f * p[:out]) / 1_000_000.0
        end
      end
    end
  end
end
