module AdamStats
  module Scraper
    module AiReco
      # Prompts versionados pro AI Recommender. Cada mudança no system/user
      # BUMPA PROMPT_VERSION (semver-like). A coluna prompt_version em
      # ai_recommendations + llm_request_logs permite A/B retroativo.
      #
      # Espelha lib/ai-reco/prompts.ts — qualquer mudança deve ser sincronizada
      # (texto idêntico ao centavo, exceto formatação Ruby de strings).
      #
      # Spec §6.
      module PromptBuilder
        PROMPT_VERSION = 'prompt-v1.0'.freeze

        SYSTEM = <<~TEXT.freeze
          Você é um analista de apostas pré-jogo. Tarefa: escolher UMA recomendação entre os candidatos abaixo (já calculados deterministicamente) e justificar em 3-5 parágrafos. Você NÃO pode aumentar units além do Kelly sugerido — só reduzir se houver red flag qualitativo.

          CAP ABSOLUTO: 2.0u. Para ligas não-calibradas (flag league_calibrated=false), CAP: 0.5u.

          Não invente fatos que não estão no contexto. Se não há contexto pra justificar a aposta com convicção, retorne verdict="skip".

          Responda SOMENTE com um JSON válido do schema:
          {
            "verdict": "bet" | "skip",
            "market": "1x2" | "over25" | "btts" | null,
            "side": "home" | "draw" | "away" | "over" | "under" | "sim" | "nao" | null,
            "prob_estimated": number 0-1,
            "units_final": number 0-2.0,
            "kelly_pre": number,
            "reduction_reason": string | null,
            "confidence": "alto" | "medio" | "baixo",
            "summary_line": string max 60 chars,
            "reasoning": string 200-800 chars (3-5 parágrafos),
            "red_flags": string[] max 5 items
          }
        TEXT

        module_function

        # @param league [String, nil]
        # @param league_calibrated [Boolean]
        # @param home_team [String]
        # @param away_team [String]
        # @param kickoff_utc [String, nil] ISO8601 UTC
        # @param referee [String, nil]
        # @param candidates [Array<Hash>] cada um: market, side, prob_calibrated, edge_pct, kelly_units, odd
        # @param context [Hash] :top_scorelines, :sim_stats_home, :sim_stats_away, :recent_home, :recent_away, :h2h
        # @return [Hash] { system: String, user: String }
        def build(league:, league_calibrated:, home_team:, away_team:,
                  kickoff_utc:, referee:, candidates:, context:)
          cal_label = league_calibrated ? 'calibrada' : 'NÃO-calibrada — confiança baixa'
          referee_label = referee || '—'

          user = +"# Fixture\n"
          user << "Liga: #{league || '(sem liga)'} (#{cal_label})\n"
          user << "#{home_team} vs #{away_team}\n"
          user << "Kickoff (UTC): #{kickoff_utc || '—'}\n"
          user << "Árbitro: #{referee_label}\n\n"

          user << "# Candidatos (ordenados por edge desc; somente com edge >= 20% foram filtrados a montante)\n"
          user << "#{format_candidates(candidates)}\n\n"

          user << "# Contexto\n"
          user << "## Sim Monte Carlo\n"
          user << "Top placares: #{format_scorelines(context[:top_scorelines] || [])}\n"
          user << "Stats projetadas mandante: #{format_stats(context[:sim_stats_home] || {})}\n"
          user << "Stats projetadas visitante: #{format_stats(context[:sim_stats_away] || {})}\n\n"

          user << "## Forma recente (últimos 5)\n"
          user << "#{home_team}: #{context[:recent_home] || '—'}\n"
          user << "#{away_team}: #{context[:recent_away] || '—'}\n\n"

          user << "## H2H últimos 3\n"
          user << "#{context[:h2h] || '—'}\n\n"

          user << "# Tarefa\n"
          user << 'Escolha o melhor candidato (ou verdict="skip" se NENHUM convence). ' \
                  'Seja específico nos red_flags — não invente nada fora do contexto acima.'

          { system: SYSTEM, user: user }
        end

        def format_candidates(candidates)
          return '(nenhum candidato com edge positivo)' if candidates.nil? || candidates.empty?

          candidates.each_with_index.map do |c, i|
            prob = (c[:prob_calibrated].to_f * 100).round(1)
            odd = c[:odd].to_f.round(2)
            edge = c[:edge_pct].to_f.round(1)
            kelly = c[:kelly_units].to_f.round(2)
            "#{i + 1}. #{c[:market]}/#{c[:side]}: prob=#{format('%.1f', prob)}% · " \
              "odd=#{format('%.2f', odd)} · edge=#{format('%.1f', edge)}% · " \
              "kelly=#{format('%.2f', kelly)}u"
          end.join("\n")
        end

        def format_stats(stats)
          return '' if stats.nil? || stats.empty?

          stats.map { |k, v| "#{k}=#{v.is_a?(Numeric) ? format('%.2f', v) : v}" }.join(', ')
        end

        def format_scorelines(arr)
          return '' if arr.nil? || arr.empty?

          arr.map { |s| "#{s[:score] || s['score']} (#{((s[:prob] || s['prob']).to_f * 100).round}%)" }.join(', ')
        end
      end
    end
  end
end
