require 'spec_helper'
require 'scraper/global_config'

module AdamStats::Scraper
  RSpec.describe GlobalConfig do
    def pg_result(ntuples:, value: nil)
      res = double('PG::Result')
      allow(res).to receive(:ntuples).and_return(ntuples)
      allow(res).to receive(:getvalue).with(0, 0).and_return(value)
      res
    end

    describe '.ai_enabled?' do
      it 'true quando a flag é true' do
        conn = double('conn', exec: pg_result(ntuples: 1, value: 'true'))
        expect(described_class.ai_enabled?(conn)).to be(true)
      end

      it 'false quando a flag é explicitamente false' do
        conn = double('conn', exec: pg_result(ntuples: 1, value: 'false'))
        expect(described_class.ai_enabled?(conn)).to be(false)
      end

      it 'default LIGADO quando não há linha (flag ausente)' do
        conn = double('conn', exec: pg_result(ntuples: 0))
        expect(described_class.ai_enabled?(conn)).to be(true)
      end

      it 'default LIGADO (graceful) quando a query levanta (ex.: tabela ausente)' do
        conn = double('conn')
        allow(conn).to receive(:exec).and_raise(StandardError.new('relation "app_settings" does not exist'))
        logs = []
        result = described_class.ai_enabled?(conn, logger: ->(m) { logs << m })
        expect(result).to be(true)
        expect(logs.join).to include('assumindo LIGADO')
      end

      it 'consulta a chave ai_enabled em app_settings' do
        conn = double('conn')
        expect(conn).to receive(:exec).with(/app_settings.*ai_enabled/m).and_return(pg_result(ntuples: 1, value: 'true'))
        described_class.ai_enabled?(conn)
      end
    end
  end
end
