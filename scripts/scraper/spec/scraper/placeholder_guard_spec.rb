# frozen_string_literal: true

require 'date'
require 'scraper/fixture'
require 'scraper/placeholder_guard'

RSpec.describe AdamStats::Scraper::PlaceholderGuard do
  # 2026-08-06 cai em BST (UTC+1); 2026-12-10 cai em GMT (UTC+0).
  def fixture(home: 'Arsenal', away: 'Chelsea', date: Date.new(2026, 8, 6), ko: '20:00')
    AdamStats::Scraper::Fixture.new(
      match_date: date, ko_time: ko,
      home_team: home, away_team: away, league: 'Premier League',
      source_url: '/fixture/123/premier-league-arsenal-vs-chelsea', country: 'England'
    )
  end

  describe '.reason' do
    it 'libera uma fixture com times e horário reais' do
      expect(described_class.reason(fixture)).to be_nil
    end

    context 'time placeholder' do
      it 'barra quando o mandante é TBC' do
        expect(described_class.reason(fixture(home: 'TBC'))).to eq(:team_placeholder)
      end

      it 'barra quando o visitante é TBC com caixa e espaços diferentes' do
        expect(described_class.reason(fixture(away: '  tbc '))).to eq(:team_placeholder)
      end

      it 'barra os chaveamentos "Winner ..." da Copa do Mundo' do
        expect(described_class.reason(fixture(home: 'Winner Quarter-final 1'))).to eq(:team_placeholder)
      end

      it 'NÃO barra time real que apenas contém as letras (Energie Cottbus)' do
        expect(described_class.reason(fixture(home: 'Energie Cottbus', away: 'Hartberg'))).to be_nil
      end

      it 'tem precedência sobre o horário — o motivo reportado é o time' do
        expect(described_class.reason(fixture(home: 'TBC', ko: '01:00'))).to eq(:team_placeholder)
      end
    end

    context 'horário placeholder' do
      it 'barra quando o kickoff cai na meia-noite UTC exata do dia (BST, ko 01:00)' do
        expect(described_class.reason(fixture(date: Date.new(2026, 8, 6), ko: '01:00')))
          .to eq(:kickoff_placeholder)
      end

      it 'barra quando o kickoff cai na meia-noite UTC exata do dia (GMT, ko 00:00)' do
        expect(described_class.reason(fixture(date: Date.new(2026, 12, 10), ko: '00:00')))
          .to eq(:kickoff_placeholder)
      end

      it 'barra quando não há horário nenhum (o fallback inventaria meio-dia)' do
        expect(described_class.reason(fixture(ko: nil))).to eq(:kickoff_missing)
        expect(described_class.reason(fixture(ko: '   '))).to eq(:kickoff_missing)
      end

      it 'NÃO barra jogo noturno legítimo das Américas (22:00 UK = 21:00 UTC)' do
        expect(described_class.reason(fixture(date: Date.new(2026, 8, 6), ko: '22:00'))).to be_nil
      end

      it 'NÃO barra 01:00 UTC — só a meia-noite exata é o marcador da fonte' do
        expect(described_class.reason(fixture(date: Date.new(2026, 8, 6), ko: '02:00'))).to be_nil
      end
    end
  end

  # Medido em 07/08 contra as 1.104 fixtures vivas: das 68 barradas por horário,
  # 59 (87%) produziam simulação legítima e só 1 era prior genérico. O horário
  # não entra no cálculo de λ — a simulação lê `avgs`, não o relógio. Ele quebra
  # a captura de closing odds (janela [KO+5min, KO+4h]) e a reconciliação, e é
  # ali que precisa ser conhecido. Já o time placeholder descartava 14 fixtures
  # das quais ZERO simulavam bem: barrar é gratuito.
  #
  # Por isso `reason` (diagnóstico completo) e `blocking?` (o que impede a
  # simulação) são perguntas diferentes.
  describe '.blocking?' do
    it 'bloqueia time placeholder — nada de útil se perde' do
      expect(described_class.blocking?(fixture(home: 'TBC'))).to be(true)
      expect(described_class.blocking?(fixture(away: 'Winner Semi-final 2'))).to be(true)
    end

    it 'NÃO bloqueia horário placeholder — custaria 87% de simulação boa' do
      fx = fixture(date: Date.new(2026, 8, 6), ko: '01:00')
      expect(described_class.reason(fx)).to eq(:kickoff_placeholder)
      expect(described_class.blocking?(fx)).to be(false)
    end

    it 'NÃO bloqueia horário ausente — pelo mesmo motivo' do
      fx = fixture(ko: nil)
      expect(described_class.reason(fx)).to eq(:kickoff_missing)
      expect(described_class.blocking?(fx)).to be(false)
    end

    it 'não bloqueia fixture íntegra' do
      expect(described_class.blocking?(fixture)).to be(false)
    end

    it 'bloqueia o time mesmo quando o horário também é placeholder' do
      expect(described_class.blocking?(fixture(home: 'TBC', ko: '01:00'))).to be(true)
    end
  end
end
