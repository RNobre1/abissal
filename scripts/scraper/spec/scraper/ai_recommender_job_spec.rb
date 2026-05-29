require 'spec_helper'
require 'json'
require 'scraper/ai_recommender_job'

module AdamStats::Scraper
  RSpec.describe AiRecommenderJob do
    let(:logged) { [] }
    let(:logger) { ->(m) { logged << m } }

    # Healthcheck spy: registra a sequência de pings (start/success/failure).
    def healthcheck_spy
      hc = double('Healthcheck')
      pinged = []
      allow(hc).to receive(:ping_start)   { |u| pinged << [:start, u] }
      allow(hc).to receive(:ping_success) { |u| pinged << [:success, u] }
      allow(hc).to receive(:ping_failure) { |u| pinged << [:failure, u] }
      [hc, pinged]
    end

    def runner_double(stats)
      r = double('AiRecommenderRunner')
      allow(r).to receive(:run).and_return(stats)
      r
    end

    describe '#run — invocação do runner' do
      it 'chama o runner exatamente uma vez' do
        runner = runner_double(inserted_recos: 5, errors: 0)
        hc, = healthcheck_spy
        described_class.new(logger: logger, runner: runner, healthcheck: hc,
                            hc_url: '', eligible_counter: -> { 0 }).run
        expect(runner).to have_received(:run).once
      end

      it 'retorna FINAL com os campos esperados' do
        runner = runner_double(inserted_recos: 7, errors: 1)
        hc, = healthcheck_spy
        result = described_class.new(logger: logger, runner: runner, healthcheck: hc,
                                     hc_url: '', eligible_counter: -> { 0 }).run
        expect(result[:recommendations_created]).to eq(7)
        expect(result[:errors]).to eq(1)
        expect(result[:ai_reco_silent_death]).to be(false)
        expect(result).to have_key(:ai_reco_at)
      end

      it 'loga uma linha FINAL JSON' do
        runner = runner_double(inserted_recos: 3, errors: 0)
        hc, = healthcheck_spy
        described_class.new(logger: logger, runner: runner, healthcheck: hc,
                            hc_url: '', eligible_counter: -> { 0 }).run
        final = logged.find { |m| m.start_with?('[ai-reco-job] FINAL:') }
        expect(final).not_to be_nil
        payload = JSON.parse(final.sub('[ai-reco-job] FINAL: ', ''))
        expect(payload['recommendations_created']).to eq(3)
      end
    end

    describe '#run — ciclo de healthcheck' do
      it 'pinga start no início e success no fim (happy path)' do
        runner = runner_double(inserted_recos: 4, errors: 0)
        hc, pinged = healthcheck_spy
        described_class.new(logger: logger, runner: runner, healthcheck: hc,
                            hc_url: 'https://hc-ping.com/ai-reco', eligible_counter: -> { 0 }).run
        expect(pinged).to eq([[:start, 'https://hc-ping.com/ai-reco'],
                              [:success, 'https://hc-ping.com/ai-reco']])
      end

      it 'NÃO tenta HTTP quando HEALTHCHECKS_AI_RECO_URL vazio (degradação graciosa)' do
        runner = runner_double(inserted_recos: 0, errors: 0)
        hc, pinged = healthcheck_spy
        described_class.new(logger: logger, runner: runner, healthcheck: hc,
                            hc_url: '', eligible_counter: -> { 50 }).run
        expect(pinged).to be_empty
        # mas ainda loga o silent-death pra observabilidade
        expect(logged.any? { |m| m.include?('SILENT DEATH') }).to be(true)
      end
    end

    describe '#run — silent-death detector' do
      it 'pinga /fail + loga SILENT DEATH quando created=0 e pending>10' do
        runner = runner_double(inserted_recos: 0, errors: 0)
        hc, pinged = healthcheck_spy
        result = described_class.new(logger: logger, runner: runner, healthcheck: hc,
                                     hc_url: 'https://hc/x', eligible_counter: -> { 42 }).run
        expect(pinged).to eq([[:start, 'https://hc/x'], [:failure, 'https://hc/x']])
        expect(logged.any? { |m| m.include?('SILENT DEATH') }).to be(true)
        expect(result[:ai_reco_silent_death]).to be(true)
        expect(result[:fixtures_pending_for_reco]).to eq(42)
      end

      it 'NÃO dispara quando created>0 (mesmo com muitos pending)' do
        runner = runner_double(inserted_recos: 1, errors: 0)
        hc, pinged = healthcheck_spy
        described_class.new(logger: logger, runner: runner, healthcheck: hc,
                            hc_url: 'https://hc/x', eligible_counter: -> { 99 }).run
        expect(pinged).to eq([[:start, 'https://hc/x'], [:success, 'https://hc/x']])
        expect(logged.none? { |m| m.include?('SILENT DEATH') }).to be(true)
      end

      it 'NÃO dispara falso positivo quando created=0 mas pending<=10' do
        runner = runner_double(inserted_recos: 0, errors: 0)
        hc, pinged = healthcheck_spy
        result = described_class.new(logger: logger, runner: runner, healthcheck: hc,
                                     hc_url: 'https://hc/x', eligible_counter: -> { 3 }).run
        expect(pinged).to eq([[:start, 'https://hc/x'], [:success, 'https://hc/x']])
        expect(logged.none? { |m| m.include?('SILENT DEATH') }).to be(true)
        expect(result[:ai_reco_silent_death]).to be(false)
      end
    end

    describe '#run — isolamento de falha global' do
      it 'runner que levanta exceção não derruba o job (vira silent-death se pending>10)' do
        runner = double('AiRecommenderRunner')
        allow(runner).to receive(:run).and_raise(StandardError, 'boom global')
        hc, pinged = healthcheck_spy
        result = nil
        expect do
          result = described_class.new(logger: logger, runner: runner, healthcheck: hc,
                                       hc_url: 'https://hc/x', eligible_counter: -> { 30 }).run
        end.not_to raise_error
        expect(logged.any? { |m| m.include?('runner failed') }).to be(true)
        expect(pinged.last).to eq([:failure, 'https://hc/x'])
        expect(result[:ai_reco_silent_death]).to be(true)
      end
    end
  end
end
