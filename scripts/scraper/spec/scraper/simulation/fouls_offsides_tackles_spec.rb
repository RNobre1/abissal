require 'spec_helper'
require_relative '../../../lib/scraper/simulation/runner'

module AdamStats
  module Scraper
    module Simulation
      RSpec.describe 'F12 — fouls/offsides/tackles' do
        it 'MODEL_VERSION refletindo bump v8' do
          expect(Runner::MODEL_VERSION).to eq('sim-v1-poisson-dc-nb-mc10k-v8')
        end

        let(:detail) do
          {
            'avgs' => {
              'home_home' => { 'avgGoalsFor' => 1.5, 'avgGoalsAg' => 1.0, 'num_matches' => 20, 'cornersFor' => 5, 'cardsFor' => 2, 'shotsOnTargetFor' => 4 },
              'away_away' => { 'avgGoalsFor' => 1.2, 'avgGoalsAg' => 1.1, 'num_matches' => 20, 'cornersFor' => 4, 'cardsFor' => 2, 'shotsOnTargetFor' => 3 }
            },
            'recent_matches' => {
              'home' => 5.times.map { { 'homeFouls' => 12, 'homeOffsides' => 1, 'homeTackles' => 10, 'awayFouls' => 11, 'awayOffsides' => 1, 'awayTackles' => 9 } },
              'away' => 5.times.map { { 'homeFouls' => 12, 'homeOffsides' => 1, 'homeTackles' => 10, 'awayFouls' => 13, 'awayOffsides' => 2, 'awayTackles' => 11 } }
            },
            'player_stats' => { 'home' => { 'top_players' => [] }, 'away' => { 'top_players' => [] } }
          }
        end

        it 'sim_stats expõe fouls/offsides/tackles em home e away' do
          res = Runner.simulate(detail, n: 1000)
          %i[fouls offsides tackles].each do |metric|
            expect(res[:sim_stats][:home][metric]).to be_a(Hash), "missing home.#{metric}"
            expect(res[:sim_stats][:home][metric][:p50]).to be_a(Numeric).and(be >= 0)
            expect(res[:sim_stats][:away][metric][:p50]).to be_a(Numeric).and(be >= 0)
          end
        end

        it 'fouls p50 fica perto da média da serie (smoke check)' do
          res = Runner.simulate(detail, n: 5000)
          # home fouls médios na serie: 12. p50 esperado ~12 ± dispersão.
          expect(res[:sim_stats][:home][:fouls][:p50]).to be_between(8, 18)
        end

        it 'recent_matches vazio ⇒ não emite a categoria (degradação graciosa)' do
          d2 = detail.merge('recent_matches' => { 'home' => [], 'away' => [] })
          res = Runner.simulate(d2, n: 200)
          # Quando não há serie pra calcular mean, a categoria sai
          # ausente do sim_stats (não é zerada).
          expect(res[:sim_stats][:home][:fouls]).to be_nil
          expect(res[:sim_stats][:away][:offsides]).to be_nil
        end
      end
    end
  end
end
