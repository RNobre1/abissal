require 'spec_helper'
require 'json'
require 'faraday'
require 'scraper/ai_reco/openrouter_client'

module AdamStats::Scraper::AiReco
  RSpec.describe OpenrouterClient do
    let(:valid_decision) do
      {
        verdict: 'bet', market: 'btts', side: 'sim',
        prob_estimated: 0.64, units_final: 1.5, kelly_pre: 1.8,
        reduction_reason: 'lineup', confidence: 'medio',
        summary_line: 'BTTS 1.5u 64%', reasoning: 'a' * 200,
        red_flags: []
      }
    end
    let(:body_ok) do
      {
        choices: [{ message: { content: valid_decision.to_json } }],
        usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 },
        model: 'deepseek/deepseek-r1'
      }.to_json
    end

    def stub_faraday(status:, body:)
      conn = double('Faraday::Connection')
      resp = double('Faraday::Response',
                    status: status,
                    success?: (200..299).cover?(status),
                    body: body)
      allow(conn).to receive(:post).and_yield(double('req').tap do |r|
        allow(r).to receive(:headers).and_return({})
        allow(r).to receive(:body=)
      end).and_return(resp)
      conn
    end

    describe '#call (happy path)' do
      it 'retorna ok=true + decision parseada quando OpenRouter responde 200' do
        client = described_class.new(api_key: 'test', conn: stub_faraday(status: 200, body: body_ok))
        result = client.call({ system: 's', user: 'u' }, model: 'deepseek/deepseek-r1', league_calibrated: true)
        expect(result[:ok]).to be true
        expect(result[:decision][:verdict]).to eq('bet')
        expect(result[:usage][:total_tokens]).to eq(1200)
        expect(result[:model_returned]).to eq('deepseek/deepseek-r1')
      end
    end

    describe '#call enforce_caps' do
      it 'aplica cap 2.0u em liga calibrada quando IA devolve units > 2.0' do
        over = valid_decision.merge(units_final: 3.0)
        body = { choices: [{ message: { content: over.to_json } }],
                 usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 } }.to_json
        client = described_class.new(api_key: 't', conn: stub_faraday(status: 200, body: body))
        result = client.call({ system: 's', user: 'u' }, model: 'deepseek/deepseek-r1', league_calibrated: true)
        expect(result[:decision][:units_final]).to eq(2.0)
      end

      it 'aplica cap 0.5u em liga nao-calibrada' do
        body = { choices: [{ message: { content: valid_decision.merge(units_final: 1.5).to_json } }],
                 usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 } }.to_json
        client = described_class.new(api_key: 't', conn: stub_faraday(status: 200, body: body))
        result = client.call({ system: 's', user: 'u' }, model: 'deepseek/deepseek-r1', league_calibrated: false)
        expect(result[:decision][:units_final]).to eq(0.5)
      end
    end

    describe '#call error paths' do
      it 'retorna ok=false quando HTTP nao-200' do
        client = described_class.new(api_key: 't', conn: stub_faraday(status: 500, body: 'internal error'))
        result = client.call({ system: 's', user: 'u' }, model: 'deepseek/deepseek-r1', league_calibrated: true)
        expect(result[:ok]).to be false
        expect(result[:error]).to match(/500/)
      end

      it 'retorna ok=false (sem raise) quando o conteudo nao e JSON parseavel' do
        body = { choices: [{ message: { content: 'isso nao e json' } }],
                 usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } }.to_json
        client = described_class.new(api_key: 't', conn: stub_faraday(status: 200, body: body))
        result = client.call({ system: 's', user: 'u' }, model: 'deepseek/deepseek-r1', league_calibrated: true)
        expect(result[:ok]).to be false
        expect(result[:error]).to match(/parse|decision/i)
      end

      it 'aceita JSON em ```json fence``` (parse defensivo)' do
        wrapped = "```json\n#{valid_decision.to_json}\n```"
        body = { choices: [{ message: { content: wrapped } }],
                 usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 } }.to_json
        client = described_class.new(api_key: 't', conn: stub_faraday(status: 200, body: body))
        result = client.call({ system: 's', user: 'u' }, model: 'deepseek/deepseek-r1', league_calibrated: true)
        expect(result[:ok]).to be true
        expect(result[:decision][:verdict]).to eq('bet')
      end

      it 'aceita JSON envolto em texto (extrai bloco { ... })' do
        noisy = "minha analise:\n#{valid_decision.to_json}\nfim."
        body = { choices: [{ message: { content: noisy } }],
                 usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 } }.to_json
        client = described_class.new(api_key: 't', conn: stub_faraday(status: 200, body: body))
        result = client.call({ system: 's', user: 'u' }, model: 'deepseek/deepseek-r1', league_calibrated: true)
        expect(result[:ok]).to be true
        expect(result[:decision][:verdict]).to eq('bet')
      end
    end
  end
end
