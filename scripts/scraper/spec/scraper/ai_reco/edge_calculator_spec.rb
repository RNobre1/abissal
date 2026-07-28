require 'spec_helper'
require 'scraper/ai_reco/edge_calculator'

module AdamStats::Scraper::AiReco
  RSpec.describe EdgeCalculator do
    let(:base_sim) do
      { p_home: 0.50, p_draw: 0.25, p_away: 0.25, p_over_25: 0.60, p_btts: 0.55 }
    end
    let(:base_odds) do
      { home: 2.10, draw: 3.50, away: 3.80, over25: 1.85, under25: 2.00,
        btts_sim: 1.80, btts_nao: 2.10 }
    end

    it 'gera 7 candidatos quando todas odds presentes' do
      out = EdgeCalculator.build(base_sim, base_odds, 1000)
      expect(out.length).to eq(7)
      keys = out.map { |c| "#{c[:market]}-#{c[:side]}" }
      expect(keys).to include('1x2-home', '1x2-draw', '1x2-away',
                              'over25-over', 'over25-under',
                              'btts-sim', 'btts-nao')
    end

    it 'calcula edge: prob*odd - 1 (em %)' do
      out = EdgeCalculator.build(base_sim, base_odds, 1000)
      home = out.find { |c| c[:market] == '1x2' && c[:side] == 'home' }
      # 0.50 * 2.10 - 1 = 0.05 → 5%
      expect(home[:edge_pct]).to be_within(0.1).of(5.0)
    end

    # Probabilidade degenerada (28/07). O Monte Carlo de 10k rodadas pode
    # devolver 1.0 quando NENHUMA simulação cruzou a linha — e o primeiro
    # batch pós-religamento produziu exatamente isso: CSKA Sofia x Qarabağ,
    # corners-over 10.5 com prob_estimated = prob_calibrated = 1.0.
    #
    # p = 1.0 afirma "impossível perder", o que nenhum modelo de futebol
    # sustenta: a incerteza de MODELO é ordens de grandeza maior que a de
    # amostragem do MC. Pior, quebra as métricas logarítmicas — se o jogo sai
    # do outro lado, log-loss = infinito e contamina a calibração inteira.
    describe 'clamp de probabilidade degenerada' do
      it 'nunca devolve prob_estimated igual a 1.0' do
        sim = base_sim.merge(p_over_25: 1.0)
        out = EdgeCalculator.build(sim, base_odds, 1000)
        over = out.find { |c| c[:market] == 'over25' && c[:side] == 'over' }
        expect(over[:prob_estimated]).to be < 1.0
        expect(over[:prob_estimated]).to be >= EdgeCalculator::PROB_CEILING - 1e-9
      end

      it 'nunca devolve prob_estimated igual a 0.0' do
        sim = base_sim.merge(p_over_25: 0.0)
        out = EdgeCalculator.build(sim, base_odds, 1000)
        under = out.find { |c| c[:market] == 'over25' && c[:side] == 'under' }
        # under = 1 - 0.0 = 1.0 → tem que ser clampado no teto
        expect(under[:prob_estimated]).to be < 1.0
        over = out.find { |c| c[:market] == 'over25' && c[:side] == 'over' }
        expect(over[:prob_estimated]).to be > 0.0
      end

      it 'clampa também a prob CALIBRADA (é ela que vai pro banco e pra UI)' do
        sim = base_sim.merge(p_over_25: 1.0)
        out = EdgeCalculator.build(sim, base_odds, 1000, isotonic_lookup: ->(_m, p) { p })
        over = out.find { |c| c[:market] == 'over25' && c[:side] == 'over' }
        expect(over[:prob_calibrated]).to be < 1.0
      end

      it 'o edge derivado do clamp é menor que o edge da prob degenerada' do
        sim = base_sim.merge(p_over_25: 1.0)
        out = EdgeCalculator.build(sim, base_odds, 1000)
        over = out.find { |c| c[:market] == 'over25' && c[:side] == 'over' }
        # sem clamp seria (1.0 * 1.85 - 1) * 100 = 85.0
        expect(over[:edge_pct]).to be < 85.0
      end

      it 'não mexe em probabilidades normais' do
        out = EdgeCalculator.build(base_sim, base_odds, 1000)
        home = out.find { |c| c[:market] == '1x2' && c[:side] == 'home' }
        expect(home[:prob_estimated]).to be_within(1e-9).of(0.50)
        expect(home[:edge_pct]).to be_within(0.1).of(5.0)
      end
    end

    it 'ordena por edge desc' do
      out = EdgeCalculator.build(base_sim, base_odds, 1000)
      out.each_cons(2) { |a, b| expect(a[:edge_pct]).to be >= b[:edge_pct] }
    end

    it 'kelly_units zero pra edge negativo' do
      neg = base_sim.merge(p_home: 0.30)
      out = EdgeCalculator.build(neg, base_odds, 1000)
      home = out.find { |c| c[:market] == '1x2' && c[:side] == 'home' }
      expect(home[:edge_pct]).to be < 0
      expect(home[:kelly_units]).to eq(0)
    end

    it 'kelly fracionado ⅛ (1 unit = 1% bankroll) — R2 walk-forward: ¼→⅛' do
      out = EdgeCalculator.build(base_sim, base_odds, 1000)
      home = out.find { |c| c[:market] == '1x2' && c[:side] == 'home' }
      # f_full = (0.50*1.10 - 0.50)/1.10 = 0.05/1.10 ≈ 0.04545
      # f_eighth = 0.04545 * 0.125 ≈ 0.005682
      # bankroll/100 = 10 → units = 0.005682 * 10 ≈ 0.05682
      expect(home[:kelly_units]).to be_within(0.005).of(0.05682)
    end

    it 'ignora mercado sem odd' do
      partial = base_odds.reject { |k, _| %i[over25 under25 btts_sim btts_nao].include?(k) }
      out = EdgeCalculator.build(base_sim, partial, 1000)
      expect(out.all? { |c| c[:market] == '1x2' }).to be true
    end

    it 'aplica isotonic_lookup quando fornecido' do
      lookup = { '1x2-home' => ->(p) { p + 0.05 } }
      out = EdgeCalculator.build(base_sim, base_odds, 1000, isotonic_lookup: lookup)
      home = out.find { |c| c[:market] == '1x2' && c[:side] == 'home' }
      expect(home[:prob_calibrated]).to be_within(0.001).of(0.55)
      # 0.55 * 2.10 - 1 = 0.155 → 15.5%
      expect(home[:edge_pct]).to be_within(0.1).of(15.5)
    end

    # Fix 2/3 — curvas INDEPENDENTES por lado (over25-under / btts-nao têm
    # calibração assimétrica vs over/sim; não pode ser 1 − cal_over).
    describe 'calibração independente por lado (Fix 2/3)' do
      it 'over25-under usa a curva PRÓPRIA quando fornecida (não 1 − cal_over)' do
        lookup = { 'over25' => ->(p) { p + 0.10 }, 'over25-under' => ->(p) { p - 0.10 } }
        out = EdgeCalculator.build(base_sim, base_odds, 1000, isotonic_lookup: lookup)
        under = out.find { |c| c[:market] == 'over25' && c[:side] == 'under' }
        # raw under = 1 - 0.60 = 0.40 → curva própria: 0.40 - 0.10 = 0.30
        # (se fosse 1 − cal_over daria 1 - 0.70 = 0.30 por coincidência; uso
        #  curva própria com offset distinto abaixo pra desambiguar)
        expect(under[:prob_calibrated]).to be_within(0.001).of(0.30)
      end

      it 'over25-under com curva própria diverge de 1 − cal_over' do
        lookup = { 'over25' => ->(p) { p + 0.10 }, 'over25-under' => ->(p) { p + 0.07 } }
        out = EdgeCalculator.build(base_sim, base_odds, 1000, isotonic_lookup: lookup)
        under = out.find { |c| c[:market] == 'over25' && c[:side] == 'under' }
        # raw under 0.40 + 0.07 = 0.47 (curva própria). 1 − cal_over seria 0.30.
        expect(under[:prob_calibrated]).to be_within(0.001).of(0.47)
      end

      it 'over25-under SEM curva própria cai em 1 − cal_over (fallback, não quebra)' do
        lookup = { 'over25' => ->(p) { p + 0.10 } }
        out = EdgeCalculator.build(base_sim, base_odds, 1000, isotonic_lookup: lookup)
        over = out.find { |c| c[:market] == 'over25' && c[:side] == 'over' }
        under = out.find { |c| c[:market] == 'over25' && c[:side] == 'under' }
        expect(over[:prob_calibrated]).to be_within(0.001).of(0.70)
        expect(under[:prob_calibrated]).to be_within(0.001).of(0.30) # 1 - 0.70
      end

      it 'btts sim e nao usam curvas próprias quando fornecidas' do
        lookup = { 'btts' => ->(p) { p + 0.05 }, 'btts-nao' => ->(p) { p - 0.05 } }
        out = EdgeCalculator.build(base_sim, base_odds, 1000, isotonic_lookup: lookup)
        sim = out.find { |c| c[:market] == 'btts' && c[:side] == 'sim' }
        nao = out.find { |c| c[:market] == 'btts' && c[:side] == 'nao' }
        expect(sim[:prob_calibrated]).to be_within(0.001).of(0.60) # 0.55 + 0.05
        expect(nao[:prob_calibrated]).to be_within(0.001).of(0.40) # 0.45 - 0.05
      end

      it 'btts SEM curva mantém prob crua (fallback, não quebra)' do
        out = EdgeCalculator.build(base_sim, base_odds, 1000)
        sim = out.find { |c| c[:market] == 'btts' && c[:side] == 'sim' }
        nao = out.find { |c| c[:market] == 'btts' && c[:side] == 'nao' }
        expect(sim[:prob_calibrated]).to be_within(0.001).of(0.55)
        expect(nao[:prob_calibrated]).to be_within(0.001).of(0.45)
      end
    end

    # -----------------------------------------------------------------------
    # Blending sim × mercado (v1 universal, α=0.5 default in plumbing)
    # -----------------------------------------------------------------------

    describe 'blending sim × mercado (blend_alpha < 1.0)' do
      it 'α=1.0 (default) — comportamento idêntico ao status quo (regressão)' do
        a = EdgeCalculator.build(base_sim, base_odds, 1000)
        b = EdgeCalculator.build(base_sim, base_odds, 1000, blend_alpha: 1.0)
        expect(b.length).to eq(a.length)
        a.zip(b).each do |x, y|
          expect(y[:market]).to eq(x[:market])
          expect(y[:side]).to eq(x[:side])
          expect(y[:edge_pct]).to be_within(1e-6).of(x[:edge_pct])
          expect(y[:kelly_units]).to be_within(1e-6).of(x[:kelly_units])
          expect(y[:prob_calibrated]).to be_within(1e-6).of(x[:prob_calibrated])
        end
      end

      it 'α=0.0 — edge igual em todos lados do mesmo mercado (== -vig do bookmaker)' do
        out = EdgeCalculator.build(base_sim, base_odds, 1000, blend_alpha: 0.0)
        one_x2 = out.select { |c| c[:market] == '1x2' }
        expect(one_x2.length).to eq(3)
        one_x2.each_cons(2) { |a, b| expect(a[:edge_pct]).to be_within(1e-4).of(b[:edge_pct]) }
        # baseOdds invs sum ≈ 1.0251 → edge ≈ -2.45%
        expect(one_x2.first[:edge_pct]).to be_within(0.5).of(-2.45)
      end

      it 'α=0.0 com odds sem vig (2.0, 4.0, 4.0) → edge ≈ 0' do
        sim = { p_home: 0.5, p_draw: 0.25, p_away: 0.25 }
        odds = { home: 2.0, draw: 4.0, away: 4.0 }
        out = EdgeCalculator.build(sim, odds, 1000, blend_alpha: 0.0)
        out.select { |c| c[:market] == '1x2' }.each do |c|
          expect(c[:edge_pct].abs).to be < 0.001
        end
      end

      it 'α=0.5 — sim=0.6, market_devig=0.3, odd=10/3 → blended=0.45, edge=50%' do
        sim = { p_home: 0.6, p_draw: 0.2, p_away: 0.2 }
        odds = { home: 10.0 / 3, draw: 2.857142857, away: 2.857142857 }
        out = EdgeCalculator.build(sim, odds, 1000, blend_alpha: 0.5)
        home = out.find { |c| c[:market] == '1x2' && c[:side] == 'home' }
        expect(home[:prob_market]).to be_within(0.001).of(0.3)
        expect(home[:prob_blended]).to be_within(0.001).of(0.45)
        expect(home[:edge_pct]).to be_within(0.5).of(50.0)
      end

      it 'EdgeCandidate inclui prob_market e prob_blended quando blend_alpha < 1.0' do
        out = EdgeCalculator.build(base_sim, base_odds, 1000, blend_alpha: 0.5)
        out.each do |c|
          expect(c).to have_key(:prob_market)
          expect(c).to have_key(:prob_blended)
          expect(c[:prob_market]).to be_a(Numeric)
          expect(c[:prob_blended]).to be_a(Numeric)
        end
      end

      it 'blending opera só em mercados disponíveis (1x2 sem over25/btts)' do
        partial = { home: 2.10, draw: 3.50, away: 3.80 }
        out = EdgeCalculator.build(base_sim, partial, 1000, blend_alpha: 0.5)
        expect(out.length).to eq(3)
        out.each { |c| expect(c[:market]).to eq('1x2') }
      end

      it 'Kolding-like: sim=0.575, market_devig~0.27, odd=3.7 → α=0.5 reduz edge de 112% pra ~56%' do
        sim = { p_home: 0.575, p_draw: 0.20, p_away: 0.225 }
        odds = { home: 3.7, draw: 3.4, away: 2.30 }
        no_blend = EdgeCalculator.build(sim, odds, 1000)
        blend = EdgeCalculator.build(sim, odds, 1000, blend_alpha: 0.5)
        home_no = no_blend.find { |c| c[:market] == '1x2' && c[:side] == 'home' }
        home_bl = blend.find { |c| c[:market] == '1x2' && c[:side] == 'home' }
        expect(home_no[:edge_pct]).to be_within(1.0).of(112.75)
        expect(home_bl[:edge_pct]).to be > 50
        expect(home_bl[:edge_pct]).to be < 60
        expect(home_bl[:edge_pct]).to be < home_no[:edge_pct]
      end

      it 'isotonic + blending: cal aplicada ao sim antes do blend' do
        lookup = { '1x2-home' => ->(p) { p + 0.05 } }
        out = EdgeCalculator.build(base_sim, base_odds, 1000,
                                   blend_alpha: 0.5, isotonic_lookup: lookup)
        home = out.find { |c| c[:market] == '1x2' && c[:side] == 'home' }
        expect(home[:prob_calibrated]).to be_within(0.001).of(0.55)
        # market devig: invs (0.4762, 0.2857, 0.2632) sum 1.0251 → home=0.4645
        expect(home[:prob_market]).to be_within(0.01).of(0.4645)
        # blended = 0.5*0.55 + 0.5*0.4645 = 0.5072
        expect(home[:prob_blended]).to be_within(0.01).of(0.5072)
      end
    end

    describe '.devig_proportional' do
      it '3 odds sem vig (2.0, 4.0, 4.0) → (0.5, 0.25, 0.25) soma 1.0' do
        probs = EdgeCalculator.devig_proportional([2.0, 4.0, 4.0])
        expect(probs[0]).to be_within(1e-6).of(0.5)
        expect(probs[1]).to be_within(1e-6).of(0.25)
        expect(probs[2]).to be_within(1e-6).of(0.25)
        expect(probs.compact.sum).to be_within(1e-6).of(1.0)
      end

      it '3 odds com vig (2.0, 3.0, 3.0) → (3/7, 2/7, 2/7) soma 1.0' do
        probs = EdgeCalculator.devig_proportional([2.0, 3.0, 3.0])
        expect(probs[0]).to be_within(1e-4).of(3.0 / 7)
        expect(probs[1]).to be_within(1e-4).of(2.0 / 7)
        expect(probs[2]).to be_within(1e-4).of(2.0 / 7)
        expect(probs.compact.sum).to be_within(1e-6).of(1.0)
      end

      it '2 odds (1.91, 1.91) → (0.5, 0.5)' do
        probs = EdgeCalculator.devig_proportional([1.91, 1.91])
        expect(probs[0]).to be_within(1e-6).of(0.5)
        expect(probs[1]).to be_within(1e-6).of(0.5)
      end

      it 'ignora odds inválidas (nil, ≤1)' do
        probs = EdgeCalculator.devig_proportional([2.0, nil, 3.0])
        expect(probs.length).to eq(3)
        expect(probs[1]).to be_nil
        valid = [probs[0], probs[2]].compact
        expect(valid.sum).to be_within(1e-6).of(1.0)
      end
    end

    # ── Wave O+E: mercados secundários (corners, cards, SOT) ───────────────────

    describe 'mercados secundários — corners/cards/SOT' do
      let(:sim_with_secondary) do
        base_sim.merge(
          sim_corners_total_mean: 10.5,
          sim_cards_total_mean: 4.3,
          sim_sot_total_mean: 6.7
        )
      end
      let(:odds_with_secondary) do
        base_odds.merge(
          corners_over_95: 1.90, corners_under_95: 1.90,
          corners_over_105: 2.20, corners_under_105: 1.65,
          cards_over_45: 1.85, cards_under_45: 1.95,
          sot_over_75: 1.95, sot_under_75: 1.85
        )
      end

      it 'gera candidatos de corners quando sim_corners_total_mean e odds presentes' do
        out = EdgeCalculator.build(sim_with_secondary, odds_with_secondary, 1000)
        corners = out.select { |c| c[:market].start_with?('corners-') }
        expect(corners.length).to be >= 2
      end

      it 'gera candidatos de cards quando sim_cards_total_mean e odds presentes' do
        out = EdgeCalculator.build(sim_with_secondary, odds_with_secondary, 1000)
        cards = out.select { |c| c[:market].start_with?('cards-') }
        expect(cards.length).to be >= 1
      end

      it 'gera candidatos de SOT quando sim_sot_total_mean e odds presentes' do
        out = EdgeCalculator.build(sim_with_secondary, odds_with_secondary, 1000)
        sot = out.select { |c| c[:market].start_with?('sot-') }
        expect(sot.length).to be >= 1
      end

      it 'corners over 9.5 com mean=10.5: P(X>9.5|10.5) ≈ 0.603 via Poisson' do
        out = EdgeCalculator.build(sim_with_secondary, odds_with_secondary, 1000)
        over95 = out.find { |c| c[:market] == 'corners-over' && c[:side] == '95' }
        expect(over95).not_to be_nil
        # scipy: 1 - poisson.cdf(9, 10.5) = 0.6029
        expect(over95[:prob_estimated]).to be_within(0.02).of(0.6029)
      end

      it 'sem sim_corners_total_mean → nenhum candidato corners' do
        out = EdgeCalculator.build(base_sim, odds_with_secondary, 1000)
        corners = out.select { |c| c[:market].start_with?('corners-') }
        expect(corners).to be_empty
      end

      it 'sem odds corners → nenhum candidato corners mesmo com mean' do
        out = EdgeCalculator.build(sim_with_secondary, base_odds, 1000)
        corners = out.select { |c| c[:market].start_with?('corners-') }
        expect(corners).to be_empty
      end

      it 'edge calculado corretamente para corners-over 9.5 com odd 1.90' do
        out = EdgeCalculator.build(sim_with_secondary, odds_with_secondary, 1000)
        over95 = out.find { |c| c[:market] == 'corners-over' && c[:side] == '95' }
        expect(over95).not_to be_nil
        # prob ≈ 0.6029, odd 1.90 → edge = (0.6029 * 1.90 - 1) * 100 ≈ +14.5%
        expected_edge = (0.6029 * 1.90 - 1.0) * 100.0
        expect(over95[:edge_pct]).to be_within(1.0).of(expected_edge)
      end

      it 'resultado ainda ordenado por edge desc com mercados secundários' do
        out = EdgeCalculator.build(sim_with_secondary, odds_with_secondary, 1000)
        out.each_cons(2) { |a, b| expect(a[:edge_pct]).to be >= b[:edge_pct] }
      end
    end

    # ── Calibração de DISTRIBUIÇÃO (dist_k) — prioridade curva → k → raw ────────
    describe 'calibração de distribuição (dist_k)' do
      let(:sim_with_secondary) do
        base_sim.merge(sim_corners_total_mean: 10.5)
      end
      let(:odds_with_secondary) do
        base_odds.merge(corners_over_95: 1.90, corners_under_95: 1.90)
      end

      it 'aplica k na MÉDIA quando NÃO há curva (prob_calibrated = Poisson(mean·k))' do
        out = EdgeCalculator.build(sim_with_secondary, odds_with_secondary, 1000,
                                   dist_k: { 'corners' => 1.10 })
        over95 = out.find { |c| c[:market] == 'corners-over' && c[:side] == '95' }
        expect(over95).not_to be_nil
        # prob_estimated = raw (sem k); prob_calibrated = Poisson com mean escalada.
        expect(over95[:prob_estimated]).to be_within(1e-9).of(DistHelpers.poisson_prob_over(10.5, 9.5))
        expect(over95[:prob_calibrated]).to be_within(1e-9).of(DistHelpers.poisson_prob_over(10.5 * 1.10, 9.5))
        expect(over95[:prob_calibrated]).to be > over95[:prob_estimated]
      end

      it 'aplica k no UNDER simetricamente' do
        out = EdgeCalculator.build(sim_with_secondary, odds_with_secondary, 1000,
                                   dist_k: { 'corners' => 1.10 })
        under95 = out.find { |c| c[:market] == 'corners-under' && c[:side] == '95' }
        expect(under95[:prob_calibrated]).to be_within(1e-9).of(DistHelpers.poisson_prob_under(10.5 * 1.10, 9.5))
      end

      it 'curva isotônica TEM PRIORIDADE sobre o k (k não altera linha com curva)' do
        lookup = { 'corners-over-95' => ->(_p) { 0.42 } }
        out = EdgeCalculator.build(sim_with_secondary, odds_with_secondary, 1000,
                                   isotonic_lookup: lookup, dist_k: { 'corners' => 1.10 })
        over95 = out.find { |c| c[:market] == 'corners-over' && c[:side] == '95' }
        expect(over95[:prob_calibrated]).to be_within(1e-9).of(0.42)
      end

      it 'sem dist_k e sem curva → raw (comportamento atual preservado)' do
        out = EdgeCalculator.build(sim_with_secondary, odds_with_secondary, 1000)
        over95 = out.find { |c| c[:market] == 'corners-over' && c[:side] == '95' }
        expect(over95[:prob_calibrated]).to be_within(1e-9).of(over95[:prob_estimated])
      end

      it 'k inválido/zero → ignorado (raw)' do
        out = EdgeCalculator.build(sim_with_secondary, odds_with_secondary, 1000,
                                   dist_k: { 'corners' => 0 })
        over95 = out.find { |c| c[:market] == 'corners-over' && c[:side] == '95' }
        expect(over95[:prob_calibrated]).to be_within(1e-9).of(over95[:prob_estimated])
      end
    end
  end
end
