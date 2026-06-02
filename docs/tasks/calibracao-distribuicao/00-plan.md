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

---

## ⬛ EVIDÊNCIA (2026-06-02) — gate B24 rodado, hipótese REVISADA

`scripts/calibracao/measure-dist-calibration.ts` (held-out cronológico 70/30,
n_train≈227, n_test≈98, via HTTPS). Brier médio nas 3 linhas calibradas:

| stat | k | Brier raw | Brier **k** | Brier **isotônica** |
|---|---|---|---|---|
| corners | 1.065 | 0.2987 | 0.2975 | **0.2505** |
| cards | 1.128 | 0.2664 | 0.2632 | **0.2551** |
| sot | 1.071 | 0.2474 | 0.2435 | **0.2261** |

**Achado:** o `k` é real (sim subestima 6–13%) e **sempre ≥ raw**, mas a
**isotônica é melhor que o `k`** nas 3 linhas centrais — o Poisson cru é
*overconfiante* (raw > 0.25 = pior que o acaso); a isotônica conserta a FORMA, o
`k` só a LOCALIZAÇÃO. → **`k` NÃO substitui a isotônica. Coexistem.**

## ✅ DESIGN FINAL (locked 2026-06-02)
- **`k` central persistido** em `model_calibration` (`corners-dist`/`cards-dist`/
  `sot-dist`/`goals-dist`, `pairs:[[meanPred, meanActual]]`, `n`). Refit no
  `fit-dist.ts` (cron semanal, mecânico — B24).
- **`EdgeCalculator` (Ruby+TS):** prioridade por linha = **curva isotônica → `k`
  → raw**. Não expande superfície de aposta (mesmas 3 linhas); o `k` é o
  fallback que conserta o cold-start de nova `model_version` (curva ausente).
  Comportamento idêntico quando há curva.
- **`value-bets-https` (tool de bilhete, human-gated):** lê o `k` central; é onde
  "todas as linhas" vive, com fade/reliability como guarda (B31).
- **`/calibracao`:** card "Calibração de distribuição" — `k`, `n`, Brier
  raw/`k`/isotônica + mini-scatter média-prevista × real.
- **DEFERIDO (gated em ROI/CLV):** expandir o recomendador IA-2 pra capturar as
  linhas extras (7.5/11.5/12.5…) que a casa oferece. Sem evidência de +EV nessas
  caudas, expandir a superfície = risco B31. Captura dinâmica de odds fica pra
  quando houver evidência por-linha.
