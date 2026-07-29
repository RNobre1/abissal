# frozen_string_literal: true

require_relative '../../../lib/scraper/simulation/runner'

# Regressão da degradação de julho/2026 (auditoria 2026-07-29).
#
# Times sem jogos na temporada NOVA vêm do choistats com o bloco `avgs` inteiro
# zerado — `num_matches: 0` implica 100% de `avgGoalsFor: 0`, `cornersFor: 0`,
# `cardsFor: 0`. O guard `usable_avgs?` testava apenas `nil`, e 0.0 não é nil:
# a simulação passava e projetava ZERO escanteios/cartões/gols.
#
# Em 30/07 isso era 38% dos jogos (virada da temporada europeia), a média
# projetada de escanteios caiu de 9.4 para 5.6, e a calibração semanal
# perseguiu a queda — k de 1.05 (junho) para 1.5672 (26/07), inflando em ~57%
# justamente os jogos com dados bons.
#
# Conserto: bloco zerado ⇒ derivar as médias de `recent_matches` (os últimos 10
# jogos reais, que atravessam a virada de temporada — 84% dos times afetados
# têm essa série completa).
RSpec.describe AdamStats::Scraper::Simulation::Runner, 'início de temporada' do
  # Uma partida FT com stats completas, do ponto de vista do mandante.
  def match(goals_for:, goals_ag:, corners:, cards:, sot:)
    {
      'status' => 'FT',
      'homeGoalsFt' => goals_for, 'awayGoalsFt' => goals_ag,
      'homeCorners' => corners, 'awayCorners' => 4,
      'homeYellows' => cards, 'awayYellows' => 2,
      'homeShotsOnTarget' => sot, 'awayShotsOnTarget' => 3,
      'homeFouls' => 12, 'awayFouls' => 11,
      'homeOffsides' => 2, 'awayOffsides' => 1,
      'homeTackles' => 15, 'awayTackles' => 14,
      'homeBookingPoints' => cards * 10, 'awayBookingPoints' => 20
    }
  end

  def series(n = 10)
    Array.new(n) { |i| match(goals_for: 1 + (i % 3), goals_ag: i % 2, corners: 5 + (i % 3), cards: 1 + (i % 2), sot: 4 + (i % 2)) }
  end

  # Bloco `avgs` como o choistats devolve pra time sem jogos na temporada.
  def zeroed_block
    {
      'num_matches' => 0, 'numMatches' => 0,
      'avgGoalsFor' => 0, 'avgGoalsAg' => 0,
      'cornersFor' => 0, 'cardsFor' => 0, 'shotsOnTargetFor' => 0,
      'bookingPointsFor' => 0, 'firstHalfGoalsFor' => 0
    }
  end

  def healthy_block
    {
      'num_matches' => 19, 'numMatches' => 19,
      'avgGoalsFor' => 1.4, 'avgGoalsAg' => 1.1,
      'cornersFor' => 5.2, 'cardsFor' => 1.8, 'shotsOnTargetFor' => 4.4,
      'bookingPointsFor' => 18.0, 'firstHalfGoalsFor' => 0.6
    }
  end

  def detail(home_block:, away_block:, with_recent: true)
    {
      'league' => 'Premier League',
      'avgs' => {
        'home_home' => home_block, 'away_away' => away_block,
        'home_overall' => home_block, 'away_overall' => away_block
      },
      'recent_matches' => with_recent ? { 'home' => series, 'away' => series } : { 'home' => [], 'away' => [] }
    }
  end

  describe 'bloco avgs zerado (time sem jogos na temporada nova)' do
    it 'NÃO projeta zero escanteios quando há série recente' do
      sim = described_class.simulate(detail(home_block: zeroed_block, away_block: zeroed_block), n: 200)

      expect(sim[:status]).not_to eq('unsimulable')
      home_corners = sim.dig(:sim_stats, :home, :corners, :p50) || sim.dig(:sim_stats, 'home', 'corners', 'p50')
      expect(home_corners).to be > 0
    end

    it 'projeta gols a partir da série, não zero' do
      sim = described_class.simulate(detail(home_block: zeroed_block, away_block: zeroed_block), n: 200)
      goals = sim.dig(:sim_stats, :home, :goals, :p50) || sim.dig(:sim_stats, 'home', 'goals', 'p50')
      expect(goals).to be > 0
    end

    it 'degrada pra unsimulable quando NEM avgs NEM série existem' do
      sim = described_class.simulate(
        detail(home_block: zeroed_block, away_block: zeroed_block, with_recent: false), n: 200
      )
      expect(sim[:status]).to eq('unsimulable')
    end

    it 'funciona com só um dos lados zerado' do
      sim = described_class.simulate(detail(home_block: zeroed_block, away_block: healthy_block), n: 200)
      expect(sim[:status]).not_to eq('unsimulable')
      corners = sim.dig(:sim_stats, :home, :corners, :p50) || sim.dig(:sim_stats, 'home', 'corners', 'p50')
      expect(corners).to be > 0
    end
  end

  describe 'bloco avgs saudável' do
    it 'continua usando os avgs da temporada, não a série' do
      sim = described_class.simulate(detail(home_block: healthy_block, away_block: healthy_block), n: 200)
      expect(sim[:status]).not_to eq('unsimulable')
      corners = sim.dig(:sim_stats, :home, :corners, :p50) || sim.dig(:sim_stats, 'home', 'corners', 'p50')
      # avgs diz 5.2/jogo; a série diria ~6. O resultado tem que seguir os avgs.
      expect(corners).to be_between(3, 8)
    end
  end
end
