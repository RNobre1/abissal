# Calibração de DISTRIBUIÇÃO — "calibrar tudo" do jeito certo (PROPOSTA)

> Pedido do Pilot (2026-06-02): "coloque calibração em tudo, deviamos estar
> fazendo isso há muito tempo." Direção correta. Este doc registra **por que
> não dá per-linha** e **como fazer de forma robusta**. NÃO iniciar sem decisão
> (mexe no pipeline de calibração + edge-calculator → gated por evidência, B24).

## O problema com "calibrar todas as linhas" per-linha
Hoje a isotônica cobre o catálogo: 1x2 (home/draw/away), over25 (over/under),
btts (sim/nao), e os secundários em 3 linhas cada — corners/sot/cards
(85/95/105 · 75/95/105 · 35/45/55). Estender pra TODA linha (corners 1.5…15.5)
por isotônica **não dá**, porque:
1. Isotônica precisa de pares (prob-prevista, resultado-real) **daquela linha**.
2. Actuals de corners/sot/cards só são reconciliados em **~13-53%** dos jogos
   (B19, sem backfill). Fatiar esse pouco por dezenas de linhas → n≪30 por linha
   → **overfit** (B24/[[walk-forward-bomb]]).
3. Resultado prático (B31): linhas sem curva usam Poisson **cru** = overconfiante
   → "edges" falsos (`corners-under/7.5 +142%`). Pior que não ter.

## A forma robusta: calibrar a DISTRIBUIÇÃO, não a linha
Calibrar UMA vez o que o sim erra — a **média/forma** do total por métrica —
contra os actuals; aí TODA linha herda a correção (sample-efficient: usa todos
os jogos resolvidos do metric, não fatiado).

Opções (a decidir):
- **(A) Calibração da média (quantile/ratio):** ajustar `actual_total ~ g(sim_total_mean)`
  por métrica (corners/sot/cards/goals) — monotônica (PAV/regressão isotônica
  sobre a MÉDIA, não sobre cada linha). Aplicar `g` ao `total_mean` antes do
  Poisson → todas as linhas calibradas pela média corrigida.
- **(B) Calibração da forma:** além da média, corrigir a dispersão (a sim usa
  NegBin; comparar variância prevista vs real do total) → Poisson/NegBin com
  parâmetros calibrados.
- **(C) CDF empírica:** mapear o quantil previsto → quantil real (PIT/histogram)
  — corrige a distribuição inteira sem assumir forma.

Recomendado: começar por **(A)** (mais simples, sample-efficient, robusto a
small-sample). Goals já têm 100% de actuals → calibram fácil; corners/sot/cards
usam os ~13-53% (gated n≥30 no agregado do metric, não por linha).

## Onde mexe
- `scripts/calibracao/` (fit semanal): novo fit de distribuição por métrica →
  persistir em `model_calibration` (novo `metric` tipo `corners-dist`).
- `lib/calibracao/` + `ai_reco/edge_calculator.rb` + `dist_helpers.rb`: aplicar
  `g(mean)` antes do `poisson_prob_over`. Reflexo no `value-bets-https.ts`.
- TDD + CRPS/Brier antes/depois (não pode degradar as 3 linhas já calibradas).

## Trigger pra iniciar (gated)
(a) decisão do Pilot; (b) PoC mostrando que a calibração de média melhora o
Brier do total em ≥1 métrica sem piorar as linhas atuais; (c) respeitar B24
(refit mecânico, sem mexer em threshold/Kelly por calendário).

## Enquanto não shipa
`value-bets-https.ts` aposta **só nas linhas calibradas** (default exclui `raw`);
`--include-raw` só pra exploração. SOT-under (71%) e corners-over (67%) entram
sempre que houver odd na linha calibrada.
