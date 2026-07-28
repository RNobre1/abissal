require 'spec_helper'
require 'scraper/ai_reco/temperature'

module AdamStats::Scraper::AiReco
  # Porta Ruby de lib/calibracao/temperature.ts — os dois caminhos (batch
  # noturno em Ruby, on-demand em TS) precisam da MESMA correção, senão a
  # mesma fixture recebe probabilidade diferente conforme quem calculou
  # (classe de bug das lições B16/B25).
  RSpec.describe Temperature do
    describe '.apply' do
      it 'T = 1 é identidade' do
        [0.05, 0.3, 0.5, 0.72, 0.95].each do |p|
          expect(described_class.apply(p, 1.0)).to be_within(1e-9).of(p)
        end
      end

      it 'T > 1 achata em direção a 0.5' do
        expect(described_class.apply(0.9, 2.0)).to be < 0.9
        expect(described_class.apply(0.9, 2.0)).to be > 0.5
        expect(described_class.apply(0.1, 2.0)).to be > 0.1
      end

      it 'T < 1 estica pra longe de 0.5' do
        expect(described_class.apply(0.9, 0.5)).to be > 0.9
        expect(described_class.apply(0.1, 0.5)).to be < 0.1
      end

      it '0.5 é ponto fixo pra qualquer T' do
        [0.5, 1.0, 1.7, 2.5].each do |t|
          expect(described_class.apply(0.5, t)).to be_within(1e-9).of(0.5)
        end
      end

      it 'nunca devolve 0 nem 1 (probabilidade degenerada, B43)' do
        expect(described_class.apply(1.0, 2.0)).to be < 1.0
        expect(described_class.apply(0.0, 2.0)).to be > 0.0
      end

      it 'degrada gracioso com entrada inválida' do
        expect(described_class.apply(nil, 2.0)).to be_nil
        expect(described_class.apply(0.7, nil)).to be_within(1e-9).of(0.7)
        expect(described_class.apply(0.7, 0)).to be_within(1e-9).of(0.7)
      end

      # Valores conferidos contra a implementação TS — os dois lados têm que
      # produzir o mesmo número pra mesma entrada.
      it 'bate com a implementação TS nos valores de produção' do
        expect(described_class.apply(0.60, 2.15)).to be_within(1e-6).of(0.5470079)
        expect(described_class.apply(0.55, 2.60)).to be_within(1e-6).of(0.5192857)
      end
    end

    describe '.apply_vector' do
      it 'T = 1 é identidade' do
        out = described_class.apply_vector([0.5, 0.25, 0.25], 1.0)
        expect(out[0]).to be_within(1e-9).of(0.5)
        expect(out[1]).to be_within(1e-9).of(0.25)
      end

      it 'sempre soma 1' do
        [0.5, 1.0, 1.7, 2.5].each do |t|
          expect(described_class.apply_vector([0.6, 0.25, 0.15], t).sum).to be_within(1e-9).of(1.0)
        end
      end

      it 'T > 1 aproxima da uniforme' do
        out = described_class.apply_vector([0.8, 0.15, 0.05], 3.0)
        expect(out[0]).to be < 0.8
        expect(out[2]).to be > 0.05
      end

      it 'preserva a ordenação das classes' do
        out = described_class.apply_vector([0.6, 0.25, 0.15], 2.2)
        expect(out[0]).to be > out[1]
        expect(out[1]).to be > out[2]
      end

      it 'com 2 classes coincide com a versão binária' do
        bin = described_class.apply(0.7, 1.8)
        vec = described_class.apply_vector([0.7, 0.3], 1.8)
        expect(vec[0]).to be_within(1e-6).of(bin)
      end

      it 'é robusto a vetor degenerado' do
        out = described_class.apply_vector([1.0, 0.0, 0.0], 2.0)
        expect(out.sum).to be_within(1e-9).of(1.0)
        expect(out[0]).to be < 1.0
      end

      it 'normaliza vetor que não soma 1' do
        out = described_class.apply_vector([0.6, 0.6, 0.6], 1.0)
        out.each { |v| expect(v).to be_within(1e-9).of(1.0 / 3) }
      end
    end

    describe '.usable?' do
      it 'rejeita nil, não-numérico, <= 0 e exatamente 1 (identidade)' do
        expect(described_class.usable?(nil)).to be false
        expect(described_class.usable?(0)).to be false
        expect(described_class.usable?(-1)).to be false
        expect(described_class.usable?(1.0)).to be false
        expect(described_class.usable?(1.7)).to be true
      end
    end
  end
end
