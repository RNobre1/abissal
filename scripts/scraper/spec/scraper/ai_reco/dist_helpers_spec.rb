require 'spec_helper'
require 'scraper/ai_reco/dist_helpers'

module AdamStats::Scraper::AiReco
  RSpec.describe DistHelpers do
    describe '.poisson_prob_over' do
      it 'P(X > 2.5 | mean=3.0) ≈ 0.5768 (scipy reference)' do
        expect(DistHelpers.poisson_prob_over(3.0, 2.5)).to be_within(0.001).of(0.5768)
      end

      it 'P(X > 9.5 | mean=8.2) ≈ 0.3085 (scipy reference)' do
        expect(DistHelpers.poisson_prob_over(8.2, 9.5)).to be_within(0.005).of(0.3085)
      end

      it 'P(X > 4.5 | mean=5.2) ≈ 0.5939 (scipy reference)' do
        expect(DistHelpers.poisson_prob_over(5.2, 4.5)).to be_within(0.005).of(0.5939)
      end

      it 'P(X > 9.5 | mean=10.5) ≈ 0.6029 (scipy reference)' do
        expect(DistHelpers.poisson_prob_over(10.5, 9.5)).to be_within(0.005).of(0.6029)
      end

      it 'P(X > 0 | mean=5) ≈ 1 - e^-5 ≈ 0.9933' do
        expect(DistHelpers.poisson_prob_over(5.0, 0.0)).to be_within(0.0001).of(1.0 - Math.exp(-5))
      end

      it 'resultado muito próximo de 0 para threshold muito alto' do
        expect(DistHelpers.poisson_prob_over(5.0, 100.0)).to be < 0.00001
      end

      it 'clamp output em [0, 1]' do
        expect(DistHelpers.poisson_prob_over(100.0, 0.5)).to be <= 1.0
        expect(DistHelpers.poisson_prob_over(0.001, 50.0)).to be >= 0.0
      end

      it 'retorna 0 para input não-numérico' do
        expect(DistHelpers.poisson_prob_over(nil, 5.0)).to eq(0.0)
        expect(DistHelpers.poisson_prob_over(5.0, nil)).to eq(0.0)
      end
    end

    describe '.poisson_prob_under' do
      it 'poisson_prob_under + poisson_prob_over = 1 para thresholds .5' do
        mean = 8.5
        threshold = 9.5
        p_over = DistHelpers.poisson_prob_over(mean, threshold)
        p_under = DistHelpers.poisson_prob_under(mean, threshold)
        expect(p_over + p_under).to be_within(1e-6).of(1.0)
      end

      it 'P(X <= 4.5 | mean=3.5) ≈ 0.7254 (scipy reference)' do
        expect(DistHelpers.poisson_prob_under(3.5, 4.5)).to be_within(0.005).of(0.7254)
      end
    end
  end
end
