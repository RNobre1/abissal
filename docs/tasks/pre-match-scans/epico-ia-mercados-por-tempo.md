# Épico (FUTURO, não iniciar sem evidência) — IA aposta mercados por-tempo

> Levantado pelo Pilot em 2026-05-31 ("dá de adicionar essas opções de análise pra IA? resultado por half e escanteios por half?"). Avaliado, **adiado**, documentado aqui pra decidir com calma. **Não construir sem trigger de evidência** (regra B24).

## Veredito da avaliação (dados reais de prod, 388 fixtures)

| Mercado por-tempo | Odds em prod (`detail_json.odds_summary/devigged`) | Sim modela hoje? | Viável como mercado da IA? |
|---|---|---|---|
| **Resultado por tempo** (First/Second Half Result, HT/FT, First/Second Half Total Goals, Team Goals por tempo) | **Bem coberto** — First Half Result 308/388 (79%), Second Half Result 296 (76%), HT/FT 271, First Half Total Goals 272, Second Half Total Goals 296 | **NÃO** — o score model recusa half-split de gols **de propósito** (ADR-006 §6.5: "no fabricated 1h/2h") | **Possível, mas é trabalho de motor** (ver abaixo) |
| **Escanteios por tempo** (First Half Total Corners, First half team corners, Most corners 1st/2nd half) | **Raríssimo** — First Half Total Corners só **32/388 (~8%)**; per-half team corners ~29 | Sim (samples h1/h2 já existem no MC) | **INVIÁVEL** — sem odds não há edge; calibração nunca acumula amostra. **Descartado.** |

## Por que NÃO foi feito agora

1. **Escanteios por-tempo:** odds em ~8% dos jogos. A sim modela, mas o mercado não tem preço. Morto na cobertura. (O dado por-tempo entra só como **análise empírica display-only** no dashboard — ver scan principal.)
2. **Resultado por-tempo:** exige **modelar gols de 1º tempo na simulação** — reverter a decisão deliberada §6.5. Isso é:
   - novo modelo de gols por tempo (ex.: split do λ por taxa empírica de 1ºT/2ºT, que existe a 100% via HT) → **bump de `model_version`** → **reset da calibração** (todas as curvas isotônicas voltam a treinar do zero).
   - validação CRPS/Brier do half-split **antes/depois** (não pode degradar o full-match).
   - calibração própria dos novos mercados (HT actuals a 100% ajudam — reconciliação viável).
3. **Cautela estratégica (B24 / [[walk-forward-bomb]]):** a IA já é **−EV** em vários mercados atuais (over25 −55,9%, empate 1x2 0/8, herding em corners-under). **Alargar a superfície de aposta antes de consertar os existentes é o oposto do que a evidência manda.** Mudar mercado/modelo = por evidência, nunca por ideia nova.

## Plano SE for retomado (gated)

**Trigger de início (todos):** (a) os mercados existentes da IA estabilizados ≥ breakeven em ≥300 bets; (b) decisão explícita do Pilot; (c) PoC de CRPS mostrando que o half-split de gols não degrada o full-match.

1. **Motor:** adicionar λ_1ºT/λ_2ºT por time ao `Rates`/`ScoreModel` (taxa empírica de HT a 100% como prior; shrinkage condicional a `numMatches`). Amostrar placar por tempo no MC. Persistir `p_*` por tempo (resultado 1ºT/2ºT, over por tempo). Novo `model_version`.
2. **Edge/IA:** estender `edge_calculator` + prompt-builder pros mercados First/Second Half Result e Half Goals (odds já em `odds_devigged`). Mercados a 79%/76% de cobertura.
3. **Reconciliação:** actuals de HT (`homeGoalsHt`/`awayGoalsHt`) a 100% → reconciler novo no MESMO PR (B16). Escanteios por-tempo **não** (8%).
4. **Calibração:** curvas isotônicas próprias por novo mercado; entra no refit semanal mecânico (B24) só depois de ≥~40 resolvidas por mercado.
5. **CRPS antes/depois** + sanity backtest sem leakage (cuidado [[walk-forward-bomb]]: in-sample mente).

## Alternativa leve (sem risco de banca) — se quiser "ver" sem apostar

Exibir os mercados por-tempo como **análise** (prob da sim vs odd devigada, igual ao edge de hoje) em `/fixtures/[id]`, **sem a IA comprometer units**. Pra resultado por-tempo isso ainda precisaria da prob por-tempo (motor); pra escanteios por-tempo a sim já tem. Não priorizado — fica registrado.
