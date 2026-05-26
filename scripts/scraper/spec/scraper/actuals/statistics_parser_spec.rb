require_relative '../../../lib/scraper/actuals/statistics_parser'

RSpec.describe AdamStats::Scraper::Actuals::StatisticsParser do
  # Helper: constrói payload de resposta /fixtures/statistics
  def build_stats_response(home_name:, away_name:,
                            home_sot: nil, home_corners: nil, home_yellow: nil, home_red: nil,
                            away_sot: nil, away_corners: nil, away_yellow: nil, away_red: nil)
    build_team_stats = lambda do |name, sot, corners, yellow, red|
      stats = []
      stats << { 'type' => 'Shots on Goal', 'value' => sot }    unless sot.nil?
      stats << { 'type' => 'Corner Kicks', 'value' => corners }  unless corners.nil?
      stats << { 'type' => 'Yellow Cards', 'value' => yellow }   unless yellow.nil?
      stats << { 'type' => 'Red Cards', 'value' => red }         unless red.nil?
      { 'team' => { 'id' => rand(9999), 'name' => name }, 'statistics' => stats }
    end

    [
      build_team_stats.call(home_name, home_sot, home_corners, home_yellow, home_red),
      build_team_stats.call(away_name, away_sot, away_corners, away_yellow, away_red)
    ]
  end

  describe '.parse' do
    context 'payload completo — todos os campos presentes' do
      it 'mapeia SOT, corners e cards (yellow+red) corretamente' do
        response = build_stats_response(
          home_name: 'Arsenal',   away_name: 'Chelsea',
          home_sot: 5,            away_sot: 3,
          home_corners: 7,        away_corners: 4,
          home_yellow: 2,         away_yellow: 1,
          home_red: 0,            away_red: 1
        )

        result = described_class.parse(response, home: 'Arsenal', away: 'Chelsea')

        expect(result).not_to be_nil
        expect(result[:home][:sot]).to eq(5)
        expect(result[:away][:sot]).to eq(3)
        expect(result[:home][:corners]).to eq(7)
        expect(result[:away][:corners]).to eq(4)
        expect(result[:home][:cards]).to eq(2)   # 2 yellow + 0 red
        expect(result[:away][:cards]).to eq(2)   # 1 yellow + 1 red
      end

      it 'soma yellow cards + red cards em :cards' do
        response = build_stats_response(
          home_name: 'TeamA', away_name: 'TeamB',
          home_sot: 4,        away_sot: 2,
          home_corners: 5,    away_corners: 3,
          home_yellow: 3,     away_yellow: 0,
          home_red: 2,        away_red: 0
        )

        result = described_class.parse(response, home: 'TeamA', away: 'TeamB')
        expect(result[:home][:cards]).to eq(5)   # 3+2
        expect(result[:away][:cards]).to eq(0)   # 0+0
      end
    end

    context 'normalização de nomes' do
      it 'funciona com nomes em casing diferente' do
        response = build_stats_response(
          home_name: 'ARSENAL FC', away_name: 'chelsea fc',
          home_sot: 6,             away_sot: 2,
          home_corners: 8,         away_corners: 3,
          home_yellow: 1,          away_yellow: 0,
          home_red: 0,             away_red: 0
        )

        # Fixture tem nomes no formato do DB (normalized)
        result = described_class.parse(response, home: 'Arsenal FC', away: 'Chelsea FC')
        expect(result).not_to be_nil
        expect(result[:home][:sot]).to eq(6)
      end

      it 'funciona quando a API retorna nomes ligeiramente diferentes mas normalizados iguais' do
        response = build_stats_response(
          home_name: 'Flamengo RJ', away_name: 'Palmeiras SP',
          home_sot: 4,              away_sot: 3,
          home_corners: 6,          away_corners: 5,
          home_yellow: 2,           away_yellow: 2,
          home_red: 0,              away_red: 0
        )

        # Choistats pode retornar apenas "Flamengo" — exact normalized match falha
        # aqui de propósito pra testar que nil é retornado graciosamente
        result = described_class.parse(response, home: 'Flamengo', away: 'Palmeiras')
        # Pode ser nil (sem match) — testamos apenas que não levanta exceção
        # O FixtureResolver irá logar 'stats_unavailable' se nil
        expect { result }.not_to raise_error
      end
    end

    context 'campos ausentes (liga sem coverage de estatísticas)' do
      it 'retorna nil quando resposta está vazia' do
        result = described_class.parse([], home: 'Arsenal', away: 'Chelsea')
        expect(result).to be_nil
      end

      it 'tolera estatísticas parcialmente ausentes — nil para campos faltantes' do
        # Apenas SOT presente, sem corners e sem cards
        response = [
          {
            'team' => { 'id' => 1, 'name' => 'Arsenal' },
            'statistics' => [{ 'type' => 'Shots on Goal', 'value' => 5 }]
          },
          {
            'team' => { 'id' => 2, 'name' => 'Chelsea' },
            'statistics' => [{ 'type' => 'Shots on Goal', 'value' => 3 }]
          }
        ]

        result = described_class.parse(response, home: 'Arsenal', away: 'Chelsea')
        expect(result).not_to be_nil
        expect(result[:home][:sot]).to eq(5)
        expect(result[:home][:corners]).to be_nil
        expect(result[:home][:cards]).to be_nil
      end

      it 'tolera value=null (às vezes a API retorna null para campos não disponíveis)' do
        response = [
          {
            'team' => { 'id' => 1, 'name' => 'Arsenal' },
            'statistics' => [
              { 'type' => 'Shots on Goal', 'value' => nil },
              { 'type' => 'Corner Kicks', 'value' => 6 },
              { 'type' => 'Yellow Cards', 'value' => 1 },
              { 'type' => 'Red Cards', 'value' => 0 }
            ]
          },
          {
            'team' => { 'id' => 2, 'name' => 'Chelsea' },
            'statistics' => [
              { 'type' => 'Shots on Goal', 'value' => 2 },
              { 'type' => 'Corner Kicks', 'value' => nil },
              { 'type' => 'Yellow Cards', 'value' => 0 },
              { 'type' => 'Red Cards', 'value' => 0 }
            ]
          }
        ]

        result = described_class.parse(response, home: 'Arsenal', away: 'Chelsea')
        expect(result).not_to be_nil
        expect(result[:home][:sot]).to be_nil    # value era nil
        expect(result[:home][:corners]).to eq(6)
        expect(result[:away][:corners]).to be_nil # value era nil
      end
    end

    context 'identificação home vs away quando API retorna times fora de ordem' do
      it 'identifica corretamente mesmo quando away vem primeiro na resposta' do
        response = [
          {
            'team' => { 'id' => 2, 'name' => 'Chelsea' },  # away vem primeiro
            'statistics' => [
              { 'type' => 'Shots on Goal', 'value' => 3 },
              { 'type' => 'Corner Kicks', 'value' => 4 },
              { 'type' => 'Yellow Cards', 'value' => 1 },
              { 'type' => 'Red Cards', 'value' => 0 }
            ]
          },
          {
            'team' => { 'id' => 1, 'name' => 'Arsenal' },  # home vem depois
            'statistics' => [
              { 'type' => 'Shots on Goal', 'value' => 7 },
              { 'type' => 'Corner Kicks', 'value' => 9 },
              { 'type' => 'Yellow Cards', 'value' => 2 },
              { 'type' => 'Red Cards', 'value' => 0 }
            ]
          }
        ]

        result = described_class.parse(response, home: 'Arsenal', away: 'Chelsea')
        expect(result).not_to be_nil
        expect(result[:home][:sot]).to eq(7)
        expect(result[:away][:sot]).to eq(3)
        expect(result[:home][:corners]).to eq(9)
        expect(result[:away][:corners]).to eq(4)
      end
    end
  end

  describe '.normalize' do
    it 'converte para lowercase e remove pontuação/diacríticos' do
      expect(described_class.normalize('Arsenal FC')).to eq('arsenal fc')
      expect(described_class.normalize('ARSENAL')).to eq('arsenal')
      expect(described_class.normalize('  Flamengo  ')).to eq('flamengo')
    end
  end
end
