require 'faraday'
require 'json'

module AdamStats
  module Scraper
    module AiReco
      # Cliente Faraday do OpenRouter para o IA-2 Recomendador.
      # Espelha lib/ai-reco/recommender.ts (parseDecision + enforceCaps + runRecommender).
      #
      # Defensivo: JSON parse nunca lanca (Licao B7 do CLAUDE.md / copilot-prod-incident).
      # Schema minimo: aceita decisao apenas se tiver 'verdict'.
      #
      # Retorno padronizado:
      #   { ok: Bool, decision: Hash|nil, raw_content: String|nil,
      #     usage: { prompt_tokens:, completion_tokens:, total_tokens: },
      #     latency_ms:, model_returned:, error: String|nil }
      class OpenrouterClient
        DEFAULT_URL = 'https://openrouter.ai/api/v1/chat/completions'.freeze
        DEFAULT_MAX_TOKENS = 4000

        def initialize(api_key:, url: DEFAULT_URL, conn: nil)
          @api_key = api_key
          @url = url
          @conn = conn || Faraday.new
        end

        def call(prompt, model:, league_calibrated:, max_tokens: DEFAULT_MAX_TOKENS)
          t0 = Time.now
          payload = {
            model: model,
            messages: [
              { role: 'system', content: prompt[:system] },
              { role: 'user',   content: prompt[:user] }
            ],
            max_tokens: max_tokens,
            temperature: 0.4
          }

          resp = @conn.post(@url) do |req|
            req.headers['Authorization'] = "Bearer #{@api_key}"
            req.headers['Content-Type'] = 'application/json'
            req.body = payload.to_json
          end
          latency_ms = ((Time.now - t0) * 1000).to_i

          unless resp.success?
            body_snippet = (resp.body || '').to_s[0..500]
            return { ok: false, error: "OpenRouter HTTP #{resp.status}: #{body_snippet}",
                     latency_ms: latency_ms }
          end

          body = begin
            JSON.parse(resp.body)
          rescue StandardError
            nil
          end
          return { ok: false, error: 'response body parse failed (not JSON)', latency_ms: latency_ms } unless body

          raw_content = body.dig('choices', 0, 'message', 'content') || ''
          usage = usage_hash(body['usage'] || {})
          model_returned = body['model']

          decision = parse_decision(raw_content)
          unless decision
            return { ok: false, error: 'failed to parse decision JSON (schema mismatch or invalid JSON)',
                     raw_content: raw_content, usage: usage, latency_ms: latency_ms,
                     model_returned: model_returned }
          end

          decision = enforce_caps(decision, league_calibrated)

          {
            ok: true, decision: decision, raw_content: raw_content,
            usage: usage, latency_ms: latency_ms, model_returned: model_returned
          }
        rescue StandardError => e
          { ok: false, error: "OpenrouterClient threw: #{e.class}: #{e.message}",
            latency_ms: ((Time.now - t0) * 1000).to_i }
        end

        # Parseia JSON robusto: aceita string crua, ```json fence, ou JSON
        # dentro de texto. Retorna nil em qualquer falha (nunca lanca).
        # Simbolos como chaves.
        def parse_decision(content)
          return nil if content.nil?

          str = content.to_s.strip
          return nil if str.empty?

          if (fence = str.match(/```(?:json)?\s*([\s\S]*?)\s*```/))
            str = fence[1].strip
          end

          candidate = try_parse(str)
          return candidate if candidate

          if (block = str.match(/\{[\s\S]*\}/))
            return try_parse(block[0])
          end

          nil
        end

        # Garante que units_final respeita o cap absoluto:
        #   - liga calibrada     -> 1.0u (R2 walk-forward: 2.0→1.0, 2026-05-25 noite)
        #   - liga NAO calibrada -> 0.1u (R3 walk-forward: 0.5→0.1, 2026-05-25 noite)
        # verdict=skip passa through.
        def enforce_caps(decision, league_calibrated)
          return decision unless decision[:verdict] == 'bet'

          cap = league_calibrated ? 1.0 : 0.1
          units = decision[:units_final]
          units_f = units.is_a?(Numeric) && (!units.respond_to?(:finite?) || units.finite?) ? units.to_f : 0.0
          capped = [[units_f, 0.0].max, cap].min
          decision.merge(units_final: capped.round(2))
        end

        private

        def usage_hash(u)
          {
            prompt_tokens:     (u['prompt_tokens']     || 0).to_i,
            completion_tokens: (u['completion_tokens'] || 0).to_i,
            total_tokens:      (u['total_tokens']      || 0).to_i
          }
        end

        def try_parse(str)
          parsed = JSON.parse(str)
          return nil unless parsed.is_a?(Hash) && parsed.key?('verdict')

          symbolize(parsed)
        rescue StandardError
          nil
        end

        def symbolize(h)
          h.each_with_object({}) do |(k, v), acc|
            acc[k.is_a?(String) ? k.to_sym : k] = v
          end
        end
      end
    end
  end
end
