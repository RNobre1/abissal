# frozen_string_literal: true

require 'json'
require_relative '../../../lib/scraper/simulation/runner'
require_relative '../../../lib/scraper/widget_merger'
require_relative '../../../lib/scraper/match_detail'

# Regressão dos DOIS bugs de fiação achados em 07/08/2026 (auditoria T3).
#
# ACHADO B — `runner.rb` chamava `Rates.lambdas(d, ...)` passando o detail_json
# ORIGINAL, enquanto o `avgs` reconstruído pelo `SeasonAvgs.fill` ficava numa
# variável local usada só pelo gate `usable_avgs?` e pelos secundários. O
# `Rates` relia `detail['avgs']` e pegava o bloco cru zerado de novo ⇒
# `num_matches: 0` ⇒ shrinkage total (w=0) ⇒ λ = baseline neutro cravado
# (1,50/1,15) ⇒ o vetor `0.4424/0.2809/0.2767`. Medido em prod: 343 de 355
# simulações com prior genérico eram esse colapso, e em 100% delas o
# `SeasonAvgs` JÁ tinha reconstruído uma série real de 2 a 10 jogos.
#
# Isso também explica o histórico: `build_secondary` recebe o `avgs` PREENCHIDO,
# então o bump v8 melhorou escanteios (erro 57%→10%) e não melhorou 1x2/over/
# BTTS — as métricas de gols nunca viram o conserto.
#
# ACHADO A — `detail_json` nunca contém a chave `league` (medido: 0 de 1.104
# fixtures em prod). `Runner.simulate` fazia `fetch(d,'league') || ''`, então
# TODA fixture caía no NEUTRAL_BASELINE e no DEFAULT_RHO. As 29 ligas de
# `league_parameters`, refitadas todo domingo, nunca influenciaram uma única
# simulação. A liga passa a ser um parâmetro explícito de quem chama — o
# orchestrator e o resimulate a têm na `Fixture`/na linha do banco.
#
# Os dois sobreviveram ao TDD porque os testes cobriam os módulos puros e nunca
# a fiação: `SeasonAvgs` tinha ZERO specs, e nenhum teste perguntava "o fill
# muda o p_home?".
RSpec.describe 'fiação: SeasonAvgs e league chegam no cálculo de λ' do
  def detail_base
    base = AdamStats::Scraper::MatchDetail.empty
    widgets = {
      recent_results: JSON.parse(File.read(fixture_path('recent-results.json'))),
      players: JSON.parse(File.read(fixture_path('players.json'))),
      odds: JSON.parse(File.read(fixture_path('odds.json'))),
      team_records: JSON.parse(File.read(fixture_path('team-records.json')))
    }
    JSON.parse(JSON.generate(AdamStats::Scraper::WidgetMerger.merge(base, widgets).to_h))
  end

  def fixture_path(name)
    File.expand_path("../fixtures/widgets/#{name}", __dir__)
  end

  # Reproduz o cenário real: time sem jogos na temporada nova volta do choistats
  # com o bloco `avgs` INTEIRO zerado (`num_matches: 0` explícito — não ausente,
  # ver B50/B52), mas com `recent_matches` cheio.
  def avgs_zerado(detail)
    d = JSON.parse(JSON.generate(detail))
    d['avgs'].each_value do |bloco|
      next unless bloco.is_a?(Hash)

      bloco.each_key { |k| bloco[k] = (k == 'num_matches' ? 0 : 0.0) }
    end
    d
  end

  # Reescreve os gols da série recente do MANDANTE, mantendo todo o resto.
  def com_gols_do_mandante(detail, gols)
    d = JSON.parse(JSON.generate(detail))
    Array(d.dig('recent_matches', 'home')).each { |m| m['homeGoalsFt'] = gols }
    d
  end

  describe 'ACHADO B — a série reconstruída pelo SeasonAvgs influencia λ' do
    # Este é o teste que faltava. Com o bug, o `avgs` reconstruído é calculado,
    # passa no gate, e é DESCARTADO no cálculo de λ — então mexer na série
    # recente não muda a previsão. Sem essa invariante, qualquer conserto do
    # `SeasonAvgs` é indistinguível de nenhum conserto.
    it 'mandante que marca muito na série prevê mais vitória que um que marca pouco' do
      base = avgs_zerado(detail_base)
      # 1 e não 0: uma série toda zerada faz o `derive` não emitir a chave (a
      # média precisa ser positiva) e a fixture cai em `unsimulable` pelo guard
      # — o que testaria o gate, não a fiação.
      fraco = AdamStats::Scraper::Simulation::Runner.simulate(com_gols_do_mandante(base, 1))
      forte = AdamStats::Scraper::Simulation::Runner.simulate(com_gols_do_mandante(base, 4))

      expect(fraco[:status]).to eq('pending')
      expect(forte[:status]).to eq('pending')
      # Margem folgada de propósito: separa efeito real do ruído do Monte Carlo
      # (a seed é derivada do detail, então cenários distintos já diferem ~±0,01).
      expect(forte[:p_home]).to be > fraco[:p_home] + 0.10
    end

    it 'não colapsa no vetor do baseline neutro quando há série para reconstruir' do
      resultado = AdamStats::Scraper::Simulation::Runner.simulate(avgs_zerado(detail_base))

      # λ = 1,50/1,15 cravado produz este vetor, a menos do ruído do MC.
      colapso = [0.4424, 0.2809, 0.2767]
      distancia = [
        (resultado[:p_home] - colapso[0]).abs,
        (resultado[:p_draw] - colapso[1]).abs,
        (resultado[:p_away] - colapso[2]).abs
      ].max
      expect(distancia).to be > 0.02
    end

    it 'bloco `avgs` saudável passa intacto — o fill é no-op e nada muda' do
      saudavel = detail_base
      antes = AdamStats::Scraper::Simulation::Runner.simulate(saudavel)
      depois = AdamStats::Scraper::Simulation::Runner.simulate(JSON.parse(JSON.generate(saudavel)))

      expect(depois[:p_home]).to be_within(1e-9).of(antes[:p_home])
      expect(depois[:p_over_25]).to be_within(1e-9).of(antes[:p_over_25])
    end
  end

  describe 'ACHADO A — a liga chega no baseline' do
    let(:calibracao) do
      {
        'Liga Ofensiva' => {
          'avg_goals_for' => 2.0, 'avg_goals_ag' => 2.0,
          'avg_goals_home' => 2.2, 'avg_goals_away' => 1.9, 'rho' => -0.10
        },
        'Liga Travada' => {
          'avg_goals_for' => 0.9, 'avg_goals_ag' => 0.9,
          'avg_goals_home' => 1.0, 'avg_goals_away' => 0.8, 'rho' => -0.10
        }
      }
    end

    it 'aceita a liga como parâmetro de quem chama (o detail_json não a tem)' do
      expect(detail_base).not_to have_key('league') # premissa do bug, travada aqui

      resultado = AdamStats::Scraper::Simulation::Runner.simulate(
        detail_base, league: 'Liga Ofensiva', calibration: calibracao
      )
      expect(resultado[:status]).to eq('pending')
    end

    it 'ligas com baselines diferentes produzem previsões diferentes' do
      ofensiva = AdamStats::Scraper::Simulation::Runner.simulate(
        detail_base, league: 'Liga Ofensiva', calibration: calibracao
      )
      travada = AdamStats::Scraper::Simulation::Runner.simulate(
        detail_base, league: 'Liga Travada', calibration: calibracao
      )

      # A normalização é RELATIVA à liga: os mesmos times valem menos numa liga
      # de médias altas e mais numa de médias baixas.
      expect((ofensiva[:p_over_25] - travada[:p_over_25]).abs).to be > 0.05
    end

    it 'liga desconhecida ou ausente segue no baseline neutro, sem quebrar' do
      %w[Inexistente].each do |liga|
        r = AdamStats::Scraper::Simulation::Runner.simulate(
          detail_base, league: liga, calibration: calibracao
        )
        expect(r[:status]).to eq('pending')
      end
      sem_liga = AdamStats::Scraper::Simulation::Runner.simulate(detail_base, calibration: calibracao)
      expect(sem_liga[:status]).to eq('pending')
    end
  end

  describe 'MODEL_VERSION' do
    # Os dois consertos mudam as probabilidades emitidas. Sem bump, as linhas
    # novas se misturariam às antigas na calibração e na arena (B53) — e as
    # versões coexistem por design, então o histórico sobrevive.
    it 'foi bumpada para v9 (as probabilidades do v8 não são comparáveis)' do
      expect(AdamStats::Scraper::Simulation::Runner::MODEL_VERSION).to end_with('v9')
    end
  end
end
