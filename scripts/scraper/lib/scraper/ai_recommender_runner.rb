require 'json'
require 'set'
require_relative 'db'
require_relative 'ai_reco/edge_calculator'
require_relative 'ai_reco/pricing'
require_relative 'ai_reco/prompt_builder'

module AdamStats
  module Scraper
    # Roda no fim do scrape diario (apos reconcilers).
    # Filtra fixtures futuras com sim ativa + odds, calcula edge, chama IA
    # se houver candidato >= 20%, persiste em ai_recommendations + llm_request_logs.
    #
    # Spec §4.3 + Wave 2 do plan IA-2 Recomendador (2026-05-24).
    class AiRecommenderRunner
      # Threshold mínimo de edge_pct (após blending) pra um candidato virar
      # bet potencial. Histórico:
      #   v1 (2026-05-25 manhã): 5.0
      #   v2 (2026-05-25 tarde): 20.0 — backtest de 30d mostrou
      #     `D20 (edge≥20%) ROI +14.4%` vs `A (edge≥5%) ROI +8.1%`.
      #     Combinado com blending α=0.5 (cenário H), ROI projetado +18.66%.
      #     Ref: docs/superpowers/specs/2026-05-25-backtest-ai-reco-relatorio.md
      EDGE_THRESHOLD = 20.0
      # Acima desse edge_pct, em liga NAO calibrada, recusamos a bet:
      # simulador sem league_parameters produz ruido amplificado
      # (ex: Kolding IF edge 114%, 2026-05-25). Espelha SANITY_EDGE_THRESHOLD
      # em lib/ai-reco/recommender.ts.
      #
      # Histórico:
      #   v1 (2026-05-25): 30. Hipótese inicial.
      #   v2 (2026-05-25): 50. Backtest histórico (720 bets, 30d) provou que
      #     `B (edge>30)` produziu ROI +2.95% vs `A (sem guard)` +8.10% —
      #     delta -44.6u PL mostra que o range 30-50% contém winners.
      #     Pre-filter pré-IA permanece (poupa tokens em edges > 50%).
      SANITY_EDGE_THRESHOLD = 50.0
      RECO_VERSION = 'reco-v1'.freeze
      DEFAULT_MODEL = 'deepseek/deepseek-r1'.freeze
      DEFAULT_BANKROLL = 1000.0
      # Blending sim × mercado (v1 universal — 2026-05-25).
      # 0.5 = mistura 50/50 prob_calibrated_sim + prob_market_devigged.
      # Reduz edges absurdos em ligas não-calibradas (Kolding IF 114% → ~57%).
      # Override via ENV AI_RECO_BLEND_ALPHA (0..1). Override por liga é TODO v2
      # (fit em fixture_simulations resolvidas — quando houver dataset por liga).
      DEFAULT_BLEND_ALPHA = 0.5

      # Cron query priorizada (B19 — 2026-05-25):
      # 1. Fixtures de ligas CALIBRADAS primeiro (tem isotonic_lookup +
      #    league_parameters próprios — IA tem dados pra decidir).
      # 2. Dentro do subset, kickoff_utc mais cedo.
      # 3. Ligas não-calibradas depois, também por kickoff_utc.
      # LIMIT 50 mantém budget de tokens controlado.
      FIXTURES_QUERY = <<~SQL.freeze
        SELECT s.id, s.fixture_id, s.home_team, s.away_team, s.league, s.kickoff_utc,
               s.model_version,
               s.p_home, s.p_draw, s.p_away, s.p_over_25, s.p_btts,
               s.top_scorelines, s.sim_stats,
               f.detail_json
        FROM fixture_simulations s
        LEFT JOIN fixtures f
          ON f.source_url = '/fixture/' || s.fixture_id::text
        WHERE s.kickoff_utc > now()
          AND s.kickoff_utc < now() + INTERVAL '48 hours'
          AND s.status = 'pending'
          AND s.fixture_id IS NOT NULL
        ORDER BY
          EXISTS (
            SELECT 1 FROM league_parameters lp
            WHERE lp.league = s.league AND lp.effective_until IS NULL
          ) DESC,
          s.kickoff_utc ASC
        LIMIT 50
      SQL

      LEAGUES_CAL_QUERY = <<~SQL.freeze
        SELECT DISTINCT league
        FROM league_parameters
        WHERE effective_until IS NULL
      SQL

      LLM_LOG_INSERT_SQL = <<~SQL.freeze
        INSERT INTO llm_request_logs
          (route, fixture_id, model, latency_ms,
           prompt_tokens, completion_tokens, total_tokens,
           cost_usd, prompt_version, prompt_snapshot, response_raw, error)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)
        RETURNING id
      SQL

      RECO_INSERT_SQL = <<~SQL.freeze
        INSERT INTO ai_recommendations
          (fixture_id, home_team, away_team, league, kickoff_utc,
           reco_version, prompt_version, llm_model, llm_log_id,
           edge_table_snapshot, league_calibrated,
           verdict, market, side,
           prob_estimated, prob_calibrated, edge_pct, odd_captured,
           kelly_pre, units_final, reduction_reason, confidence,
           summary_line, reasoning_full, red_flags, cost_usd)
        VALUES ($1,$2,$3,$4,$5,
                $6,$7,$8,$9,
                $10::jsonb,$11,
                $12,$13,$14,
                $15,$16,$17,$18,
                $19,$20,$21,$22,
                $23,$24,$25::jsonb,$26)
        RETURNING id
      SQL

      def initialize(conn: nil, logger: ->(m) { warn m }, client: nil,
                     dry_run: false, bankroll: nil, model: nil, blend_alpha: nil)
        @conn = conn
        @logger = logger
        @client = client
        @dry_run = dry_run
        # ENV vars vindas de GH Actions `${{ vars.X }}` chegam como string vazia
        # quando a var não está definida (não nil). Ruby `"" || x` retorna `""`
        # (truthy), o que furava o fallback. Normalizar pra nil antes do `||`.
        env_bankroll = ENV['AI_RECO_BANKROLL'].to_s.strip
        env_model = ENV['AI_RECO_MODEL'].to_s.strip
        env_alpha = ENV['AI_RECO_BLEND_ALPHA'].to_s.strip
        @bankroll = bankroll || (env_bankroll.empty? ? DEFAULT_BANKROLL : env_bankroll.to_f)
        @model = model || (env_model.empty? ? DEFAULT_MODEL : env_model)
        @blend_alpha = blend_alpha || (env_alpha.empty? ? DEFAULT_BLEND_ALPHA : env_alpha.to_f)
      end

      def run
        with_connection do |conn|
          fixtures = conn.query(FIXTURES_QUERY).to_a
          @logger.call("[ai-reco] processando #{fixtures.length} fixtures upcoming")

          calibrated_leagues = load_calibrated_leagues(conn)

          fixtures.each do |row|
            begin
              process_fixture(conn, row, calibrated_leagues)
            rescue StandardError => e
              @logger.call("[ai-reco] fixture #{row['fixture_id']} falhou: #{e.class}: #{e.message}")
            end
          end
        end
      end

      private

      def with_connection
        if @conn
          yield @conn
        else
          AdamStats::Scraper::DB.with_connection { |c| yield c }
        end
      end

      def load_calibrated_leagues(conn)
        rows = conn.query(LEAGUES_CAL_QUERY).to_a
        rows.map { |r| r['league'] }.compact.to_set
      rescue StandardError
        Set.new
      end

      def client
        @client ||= begin
          require_relative 'ai_reco/openrouter_client'
          AiReco::OpenrouterClient.new(api_key: ENV['OPENROUTER_API_KEY'])
        end
      end

      def process_fixture(conn, row, calibrated_leagues)
        sim = extract_sim(row)
        odds = extract_odds(row)
        unless sim && odds
          @logger.call("[ai-reco] fixture #{row['fixture_id']}: sem sim ou odds — pulando")
          return
        end

        league_calibrated = calibrated_leagues.include?(row['league'])

        candidates = AiReco::EdgeCalculator.build(sim, odds, @bankroll, blend_alpha: @blend_alpha)
        bet_candidates = candidates.select { |c| c[:edge_pct] >= EDGE_THRESHOLD }

        if bet_candidates.empty?
          return persist_skip(conn, row, candidates, league_calibrated)
        end

        # Pre-filter (B19 — 2026-05-25): edge irreal em liga sem isotonic_lookup
        # quase certamente é ruído amplificado. Bloqueia antes de gastar tokens.
        top_edge = bet_candidates.first[:edge_pct]
        if !league_calibrated && top_edge.to_f > SANITY_EDGE_THRESHOLD
          return persist_skip(conn, row, candidates, league_calibrated,
                              reduction_reason: 'edge_suspect_pre_filtered',
                              summary_line: "Edge #{top_edge.round(1)}% em liga não-calibrada — provável ruído do simulador",
                              reasoning: "Top candidate (#{bet_candidates.first[:market]}/#{bet_candidates.first[:side]}) com edge #{top_edge.round(1)}% > #{SANITY_EDGE_THRESHOLD}% em liga sem league_parameters calibrados. Pre-filtro bloqueou pra economizar tokens.")
        end

        if @dry_run
          @logger.call("[ai-reco] dry-run skipping IA call for fixture #{row['fixture_id']}")
          return
        end

        run_ia_for(conn, row, candidates, bet_candidates, league_calibrated)
      end

      # Sanity guard pos-IA: equivalente Ruby ao applySanityGuard de
      # lib/ai-reco/recommender.ts. Recebe a decisao final da IA + o
      # candidato escolhido (com edge_pct calculado pela edge_calculator)
      # e forca skip se edge>SANITY_EDGE_THRESHOLD em liga nao-calibrada.
      #
      # Em Ruby, o pre-filter (acima) ja bloqueia 99% dos casos pois o
      # top candidate tem edge >= chosen.edge. Mantemos esta funcao como
      # segunda camada defensiva (caso bypass futuro / chosen != top).
      def apply_sanity_guard(decision, chosen_candidate, league_calibrated)
        return decision unless decision.is_a?(Hash)
        return decision unless decision[:verdict].to_s == 'bet'
        return decision if league_calibrated
        return decision unless chosen_candidate.is_a?(Hash)

        edge = chosen_candidate[:edge_pct].to_f
        return decision unless edge > SANITY_EDGE_THRESHOLD

        decision.merge(
          verdict: 'skip',
          units_final: 0,
          reduction_reason: 'edge_suspect_high_in_uncalibrated_league'
        )
      end

      def run_ia_for(conn, row, all_candidates, bet_candidates, league_calibrated)
        prompt = AiReco::PromptBuilder.build(
          league: row['league'],
          league_calibrated: league_calibrated,
          home_team: row['home_team'],
          away_team: row['away_team'],
          kickoff_utc: row['kickoff_utc'],
          referee: extract_referee(row),
          candidates: bet_candidates,
          context: build_context(row)
        )

        result = client.call(prompt, model: @model, league_calibrated: league_calibrated)

        cost = AiReco::Pricing.compute_cost_usd(
          result[:model_returned] || @model,
          result.dig(:usage, :prompt_tokens) || 0,
          result.dig(:usage, :completion_tokens) || 0
        )

        log_id = insert_llm_log(conn, row, result, prompt, cost)
        insert_reco(conn, row, all_candidates, league_calibrated, result, log_id, cost)
      end

      def extract_sim(row)
        sim = {
          p_home:    to_float_or_nil(row['p_home']),
          p_draw:    to_float_or_nil(row['p_draw']),
          p_away:    to_float_or_nil(row['p_away']),
          p_over_25: to_float_or_nil(row['p_over_25']),
          p_btts:    to_float_or_nil(row['p_btts'])
        }
        return nil unless sim[:p_home] && sim[:p_draw] && sim[:p_away]

        sim
      rescue StandardError
        nil
      end

      def extract_odds(row)
        detail = parse_json(row['detail_json'])
        return nil unless detail.is_a?(Hash)

        odds_root = detail['odds_summary'] || detail['odds'] || {}
        return nil unless odds_root.is_a?(Hash)

        # Shape REAL do choistats (verificado empiricamente 2026-05-24):
        #   odds_summary:
        #     "Result":    { "<home_team_name>", "Draw", "<away_team_name>" }
        #     "BTTS":      { "Yes", "No" }
        #     "Match Goals Overs/Unders": { "Over 2.5", "Under 2.5", ... }
        #   Cada valor: { "bookmaker": "X", "decimal_odds": Float }
        #
        # NOTA: 1X2 (Result) usa nome do time como key — precisa do row['home_team'] e
        # row['away_team'] pra resolver.
        result_market = odds_root['Result'] || {}
        btts_market   = odds_root['BTTS'] || {}
        mg_market     = odds_root['Match Goals Overs/Unders'] || {}

        result = {
          home:     dig_decimal(result_market, row['home_team']),
          draw:     dig_decimal(result_market, 'Draw'),
          away:     dig_decimal(result_market, row['away_team']),
          over25:   dig_decimal(mg_market, 'Over 2.5'),
          under25:  dig_decimal(mg_market, 'Under 2.5'),
          btts_sim: dig_decimal(btts_market, 'Yes'),
          btts_nao: dig_decimal(btts_market, 'No')
        }
        return nil if result.values.compact.empty?

        result
      rescue StandardError
        nil
      end

      # Field is `decimal_odds` (not `average`). Tolerant: returns nil
      # for missing key, missing node, or non-numeric value.
      def dig_decimal(market_node, key)
        return nil unless market_node.is_a?(Hash) && key

        node = market_node[key]
        return nil unless node.is_a?(Hash)

        v = node['decimal_odds']
        v.respond_to?(:to_f) ? v.to_f : nil
      end

      def extract_referee(row)
        detail = parse_json(row['detail_json'])
        return nil unless detail.is_a?(Hash)

        detail.dig('referee', 'name') || detail.dig('referee_record', 'name')
      rescue StandardError
        nil
      end

      def build_context(row)
        detail = parse_json(row['detail_json']) || {}
        sim_stats = parse_json(row['sim_stats']) || {}
        top_scorelines = parse_json(row['top_scorelines']) || []

        {
          top_scorelines: top_scorelines.is_a?(Array) ? top_scorelines.first(5) : [],
          sim_stats_home: stats_summary(sim_stats['home']),
          sim_stats_away: stats_summary(sim_stats['away']),
          recent_home: summarize_recent(detail.dig('recent_matches', 'home')),
          recent_away: summarize_recent(detail.dig('recent_matches', 'away')),
          h2h: summarize_h2h(detail['h2h'])
        }
      end

      def stats_summary(team_stats)
        return {} unless team_stats.is_a?(Hash)

        %w[goals corners sot cards].each_with_object({}) do |key, acc|
          node = team_stats[key]
          val = if node.is_a?(Hash)
                  node['p50'] || node['mean']
                else
                  node
                end
          acc[key] = val.to_f.round(2) if val.is_a?(Numeric)
        end
      end

      def summarize_recent(arr)
        return '-' unless arr.is_a?(Array) && !arr.empty?

        arr.first(5).map do |m|
          result = m['result'] || m.dig('outcome', 'result') || '?'
          hg = m['home_goals'] || '?'
          ag = m['away_goals'] || '?'
          "#{result} (#{hg}-#{ag})"
        end.join(', ')
      end

      def summarize_h2h(h2h)
        return '-' unless h2h.is_a?(Array) && !h2h.empty?

        h2h.first(3).map do |m|
          "#{m['home_team'] || '?'} #{m['home_goals'] || '?'}-#{m['away_goals'] || '?'} #{m['away_team'] || '?'}"
        end.join('; ')
      end

      def persist_skip(conn, row, candidates, league_calibrated,
                       reduction_reason: nil,
                       summary_line: 'Nenhum candidato com edge >= 20%',
                       reasoning: 'Nenhum mercado com valor; skip.')
        if @dry_run
          @logger.call("[ai-reco] dry-run skip persist for fixture #{row['fixture_id']}")
          return
        end

        conn.exec_params(
          RECO_INSERT_SQL,
          [
            row['fixture_id'].to_i, row['home_team'], row['away_team'], row['league'], row['kickoff_utc'],
            RECO_VERSION, AiReco::PromptBuilder::PROMPT_VERSION, '(no-llm-call)', nil,
            JSON.generate(candidates), league_calibrated,
            'skip', nil, nil,
            nil, nil, nil, nil,
            nil, nil, reduction_reason, 'baixo',
            summary_line, reasoning, '[]', 0.0
          ]
        )
        @logger.call("[ai-reco] skip persisted fixture #{row['fixture_id']}#{reduction_reason ? " (#{reduction_reason})" : ''}")
      end

      def insert_llm_log(conn, row, result, prompt, cost)
        snapshot = JSON.generate(system: prompt[:system], user: prompt[:user])
        usage = result[:usage] || {}
        res = conn.exec_params(
          LLM_LOG_INSERT_SQL,
          [
            'ai-reco', row['fixture_id'].to_i, @model, result[:latency_ms],
            usage[:prompt_tokens], usage[:completion_tokens], usage[:total_tokens],
            cost, AiReco::PromptBuilder::PROMPT_VERSION,
            snapshot, result[:raw_content], result[:ok] ? nil : result[:error]
          ]
        )
        first = res.respond_to?(:first) ? res.first : nil
        return nil unless first.is_a?(Hash)

        (first['id'] || first[:id])&.to_i
      rescue StandardError
        nil
      end

      def insert_reco(conn, row, all_candidates, league_calibrated, result, log_id, cost)
        d = result[:decision] || { verdict: 'skip', confidence: 'baixo', reasoning: result[:error] }
        chosen = if d[:verdict] == 'bet'
                   all_candidates.find { |c| c[:market] == d[:market] && c[:side] == d[:side] }
                 end

        # Sanity guard pos-IA: segunda camada defensiva (pre-filter ja
        # bloqueia o top, mas chosen != top em casos raros).
        d = apply_sanity_guard(d, chosen, league_calibrated)

        conn.exec_params(
          RECO_INSERT_SQL,
          [
            row['fixture_id'].to_i, row['home_team'], row['away_team'], row['league'], row['kickoff_utc'],
            RECO_VERSION, AiReco::PromptBuilder::PROMPT_VERSION, @model, log_id,
            JSON.generate(all_candidates), league_calibrated,
            d[:verdict], d[:market], d[:side],
            d[:prob_estimated], chosen&.dig(:prob_calibrated), chosen&.dig(:edge_pct), chosen&.dig(:odd),
            d[:kelly_pre] || chosen&.dig(:kelly_units), d[:units_final] || 0,
            d[:reduction_reason], d[:confidence],
            d[:summary_line], d[:reasoning], JSON.generate(d[:red_flags] || []), cost
          ]
        )
        @logger.call("[ai-reco] persisted #{d[:verdict]} for fixture #{row['fixture_id']} (cost $#{format('%.5f', cost)})")
      end

      def parse_json(s)
        return nil if s.nil?
        return s if s.is_a?(Hash) || s.is_a?(Array)

        JSON.parse(s.to_s)
      rescue StandardError
        nil
      end

      def to_float_or_nil(v)
        return nil if v.nil?

        f = Float(v)
        f.finite? ? f : nil
      rescue StandardError
        nil
      end
    end
  end
end
