# frozen_string_literal: true

require_relative '../../../lib/scraper/simulation/season_avgs'

# O `SeasonAvgs` decide se a simulação projeta o time real ou o baseline da liga
# — e até 07/08/2026 tinha **zero specs**. Não é coincidência que dois bugs
# tenham nascido em volta dele: o de 29/07 (bloco zerado virava projeção ZERO) e
# o de fiação de 07/08 (o resultado do fill nunca chegava no cálculo de λ).
#
# ⚠️ Estes specs cobrem o módulo PURO. Eles não provam — e não podem provar —
# que o resultado do fill é usado. Essa garantia é do
# `fiacao_season_avgs_e_liga_spec.rb`, e a distinção é a lição: teste de unidade
# verde num módulo desconectado é exatamente o que deixou o v8 parecer aplicado
# por mais de uma semana sem nunca ter tocado 1x2/over/BTTS.
RSpec.describe AdamStats::Scraper::Simulation::SeasonAvgs do
  def partida(gols_casa:, gols_fora:, status: 'FT', **extras)
    { 'status' => status, 'homeGoalsFt' => gols_casa, 'awayGoalsFt' => gols_fora }.merge(extras)
  end

  def serie(n, gols_casa:, gols_fora:, **extras)
    Array.new(n) { partida(gols_casa: gols_casa, gols_fora: gols_fora, **extras) }
  end

  describe '.degenerate?' do
    it 'reconhece o bloco de time sem jogos na temporada (num_matches zero)' do
      expect(described_class.degenerate?('num_matches' => 0, 'avgGoalsFor' => 0.0)).to be(true)
    end

    it 'aceita camelCase — o choistats manda numMatches' do
      expect(described_class.degenerate?('numMatches' => 0)).to be(true)
    end

    # B50/B52: `0` é um valor, ausência é outra coisa. Sem num_matches, a média
    # de gols serve de proxy — nenhum time real tem média exatamente zero numa
    # temporada com jogos.
    it 'sem num_matches, usa avgGoalsFor não-positivo como proxy' do
      expect(described_class.degenerate?('avgGoalsFor' => 0.0)).to be(true)
      expect(described_class.degenerate?('avgGoalsFor' => 1.4)).to be(false)
    end

    it 'bloco saudável não é degenerado' do
      expect(described_class.degenerate?('num_matches' => 17, 'avgGoalsFor' => 1.2)).to be(false)
    end

    it 'num_matches positivo manda, mesmo com média zerada' do
      expect(described_class.degenerate?('num_matches' => 5, 'avgGoalsFor' => 0.0)).to be(false)
    end

    it 'trata não-Hash como degenerado em vez de explodir' do
      expect(described_class.degenerate?(nil)).to be(true)
      expect(described_class.degenerate?('lixo')).to be(true)
    end
  end

  describe '.fill' do
    let(:zerado) { { 'num_matches' => 0, 'avgGoalsFor' => 0.0, 'avgGoalsAg' => 0.0 } }

    it 'reconstrói o bloco degenerado a partir da série recente' do
      avgs = { 'home_home' => zerado.dup, 'away_away' => zerado.dup }
      recent = {
        'home' => serie(4, gols_casa: 2, gols_fora: 1),
        'away' => serie(4, gols_casa: 1, gols_fora: 3)
      }

      out = described_class.fill(avgs, recent)

      # mandante: marca 2 (homeGoalsFt) e sofre 1 (awayGoalsFt)
      expect(out['home_home']['avgGoalsFor']).to be_within(1e-9).of(2.0)
      expect(out['home_home']['avgGoalsAg']).to be_within(1e-9).of(1.0)
      # visitante: na série dele, marca 3 (awayGoalsFt) e sofre 1
      expect(out['away_away']['avgGoalsFor']).to be_within(1e-9).of(3.0)
      expect(out['away_away']['avgGoalsAg']).to be_within(1e-9).of(1.0)
    end

    # Sem isto o shrinkage do `Rates` recebe n=0, calcula w=0 e devolve 100% do
    # baseline da liga — que foi exatamente o colapso de 07/08. O `num_matches`
    # reconstruído é o que dá PESO ao dado reconstruído.
    it 'carimba num_matches com o tamanho da série — senão o peso vira zero' do
      out = described_class.fill(
        { 'home_home' => zerado.dup },
        { 'home' => serie(7, gols_casa: 2, gols_fora: 1) }
      )
      expect(out['home_home']['num_matches']).to eq(7)
    end

    it 'não toca em bloco saudável — os avgs de temporada seguem preferidos' do
      saudavel = { 'num_matches' => 20, 'avgGoalsFor' => 1.4, 'avgGoalsAg' => 1.1 }
      out = described_class.fill(
        { 'home_home' => saudavel },
        { 'home' => serie(5, gols_casa: 9, gols_fora: 0) }
      )
      expect(out['home_home']).to eq(saudavel)
    end

    it 'ignora partidas que não terminaram — só FT entra na média' do
      recent = {
        'home' => serie(3, gols_casa: 2, gols_fora: 1) +
                  serie(3, gols_casa: 9, gols_fora: 9, status: 'NS')
      }
      out = described_class.fill({ 'home_home' => zerado.dup }, recent)
      expect(out['home_home']['avgGoalsFor']).to be_within(1e-9).of(2.0)
      expect(out['home_home']['num_matches']).to eq(3)
    end

    # Piso de 2: uma partida só não é média, é anedota. Abaixo disso o bloco
    # segue degenerado e o guard do Runner devolve `unsimulable` — degradação
    # honesta, nunca número inventado.
    it 'não reconstrói com menos de 2 partidas' do
      out = described_class.fill(
        { 'home_home' => zerado.dup },
        { 'home' => serie(1, gols_casa: 3, gols_fora: 0) }
      )
      expect(out['home_home']).to eq(zerado)
    end

    it 'série ausente ou vazia deixa o bloco como estava' do
      expect(described_class.fill({ 'home_home' => zerado.dup }, nil)['home_home']).to eq(zerado)
      expect(described_class.fill({ 'home_home' => zerado.dup }, {})['home_home']).to eq(zerado)
    end

    it 'reconstrói os secundários que a simulação consome' do
      recent = {
        'home' => serie(4, gols_casa: 2, gols_fora: 1,
                        'homeCorners' => 6, 'awayCorners' => 3, 'homeYellows' => 2,
                        'homeShotsOnTarget' => 5)
      }
      out = described_class.fill({ 'home_home' => zerado.dup }, recent)

      expect(out['home_home']['cornersFor']).to be_within(1e-9).of(6.0)
      expect(out['home_home']['cornersAg']).to be_within(1e-9).of(3.0)
      expect(out['home_home']['cardsFor']).to be_within(1e-9).of(2.0)
      expect(out['home_home']['shotsOnTargetFor']).to be_within(1e-9).of(5.0)
    end

    it 'omite a métrica ausente na série em vez de inventar zero (B50)' do
      out = described_class.fill(
        { 'home_home' => zerado.dup },
        { 'home' => serie(4, gols_casa: 2, gols_fora: 1) } # sem corners
      )
      expect(out['home_home']).not_to have_key('cornersFor')
    end

    it 'devolve o argumento intacto quando avgs não é Hash' do
      expect(described_class.fill(nil, { 'home' => serie(3, gols_casa: 1, gols_fora: 1) })).to be_nil
    end

    it 'não muta o hash recebido' do
      avgs = { 'home_home' => zerado.dup }
      copia = Marshal.load(Marshal.dump(avgs))
      described_class.fill(avgs, { 'home' => serie(4, gols_casa: 2, gols_fora: 1) })
      expect(avgs).to eq(copia)
    end
  end
end
