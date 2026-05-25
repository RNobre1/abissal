require 'spec_helper'
require 'scraper/ai_reco/prompt_builder'

module AdamStats::Scraper::AiReco
  RSpec.describe PromptBuilder do
    let(:base_input) do
      {
        league: 'Premier League',
        league_calibrated: true,
        home_team: 'Liverpool',
        away_team: 'Tottenham',
        kickoff_utc: '2026-05-25T15:00:00Z',
        referee: 'Anthony Taylor',
        candidates: [
          { market: 'btts', side: 'sim', prob_calibrated: 0.64,
            edge_pct: 12.0, kelly_units: 1.8, odd: 1.75 }
        ],
        context: {
          top_scorelines: [{ score: '2-1', prob: 0.12 }, { score: '1-1', prob: 0.10 }],
          sim_stats_home: { 'goals' => 2.1, 'corners' => 7.2, 'sot' => 5.4 },
          sim_stats_away: { 'goals' => 1.3, 'corners' => 4.8, 'sot' => 3.2 },
          recent_home: 'W W D L W (3-1, 2-0, 1-1, 0-2, 1-0)',
          recent_away: 'L W L W L (0-1, 2-1, 0-3, 1-0, 0-2)',
          h2h: 'Liv 2-1 Tot (2025-11); Tot 0-0 Liv (2025-05); Liv 4-1 Tot (2024-12)'
        }
      }
    end

    it 'PROMPT_VERSION é semver-like (prompt-vN.M)' do
      expect(PromptBuilder::PROMPT_VERSION).to match(/^prompt-v\d+\.\d+$/)
    end

    it 'retorna { system:, user: } strings não-triviais' do
      out = PromptBuilder.build(**base_input)
      expect(out[:system]).to be_a(String)
      expect(out[:user]).to be_a(String)
      expect(out[:system].length).to be > 100
      expect(out[:user].length).to be > 100
    end

    it 'inclui cap 2.0u no system prompt (liga calibrada)' do
      out = PromptBuilder.build(**base_input)
      expect(out[:system]).to match(/2\.0u/)
    end

    it 'inclui cap 0.5u no system prompt (liga não-calibrada)' do
      out = PromptBuilder.build(**base_input)
      expect(out[:system]).to match(/0\.5u/)
    end

    it 'user prompt inclui candidato (mercado, edge, time)' do
      out = PromptBuilder.build(**base_input)
      expect(out[:user]).to include('btts')
      expect(out[:user]).to match(/12\.0|12%/)
      expect(out[:user]).to include('Liverpool')
      expect(out[:user]).to include('Tottenham')
    end

    it 'rotula liga não-calibrada explicitamente no user prompt' do
      out = PromptBuilder.build(**base_input.merge(league_calibrated: false))
      expect(out[:user]).to match(/N[ÃA]O-calibrada|confian[çc]a baixa/i)
    end

    it 'inclui referee quando fornecido' do
      out = PromptBuilder.build(**base_input)
      expect(out[:user]).to include('Anthony Taylor')
    end

    it "usa '—' quando referee é nil" do
      out = PromptBuilder.build(**base_input.merge(referee: nil))
      expect(out[:user]).to match(/[Áa]rbitro:\s*—/)
    end

    it "inclui instrução 'não invente' (system ou user)" do
      out = PromptBuilder.build(**base_input)
      combined = "#{out[:system]} #{out[:user]}"
      expect(combined).to match(/n[ãa]o invent/i)
    end

    it 'descreve o schema JSON esperado (verdict, market, units_final)' do
      out = PromptBuilder.build(**base_input)
      expect(out[:system]).to match(/verdict.*bet.*skip/im)
      expect(out[:system]).to include('market')
      expect(out[:system]).to include('units_final')
    end
  end
end
