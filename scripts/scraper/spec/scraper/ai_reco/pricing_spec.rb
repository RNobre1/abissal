require 'spec_helper'
require 'scraper/ai_reco/pricing'

module AdamStats::Scraper::AiReco
  RSpec.describe Pricing do
    describe '.compute_cost_usd' do
      it 'calcula custo correto pra deepseek-r1' do
        # R1: in=$0.55/M, out=$2.19/M
        # 10k input + 2k output = 10000*0.55/1e6 + 2000*2.19/1e6
        #                       = 0.0055 + 0.00438 = 0.00988
        cost = Pricing.compute_cost_usd('deepseek/deepseek-r1', 10_000, 2_000)
        expect(cost).to be_within(1e-6).of(0.00988)
      end

      it 'retorna 0 pra modelo desconhecido' do
        expect(Pricing.compute_cost_usd('foo/bar', 1000, 1000)).to eq(0)
      end

      it 'trata 0 tokens' do
        expect(Pricing.compute_cost_usd('deepseek/deepseek-r1', 0, 0)).to eq(0)
      end

      it 'expõe tabela de preços (MODEL_PRICING_USD_PER_1M_TOKENS)' do
        expect(Pricing::MODEL_PRICING_USD_PER_1M_TOKENS['deepseek/deepseek-r1'])
          .to eq(in: 0.55, out: 2.19)
      end
    end
  end
end
