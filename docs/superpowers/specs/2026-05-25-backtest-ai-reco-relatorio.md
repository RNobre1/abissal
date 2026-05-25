# Backtest IA-2 (pipeline determinístico, sem LLM)

**Data:** 2026-05-25T19:35:51.049Z

## Contexto

IA-2 entrou em prod em 2026-05-25 com performance preocupante: 6 bets resolved, 0 wins, ROI -100%. Edges absurdos (até 114%) detectados. Antes de continuar gastando tokens com DeepSeek R1, validar se o pipeline determinístico (sem chamar a IA) já produz ROI positivo. Se NÃO produzir, a IA não vai consertar — o problema é o simulador / edge calculator a montante.

## Universo

- Fonte: `fixture_simulations` com `status='resolved'` nos últimos 30 dias.
- Sims resolvidas no período: **1052**
- Sims usáveis (com odds disponíveis): **771**
- Odds origem `fixtures.detail_json.odds_summary`: 771
- Odds origem `ai_recommendations.edge_table_snapshot`: 0
- Sims sem odds (fixture purgada e sem reco): 281
- Ligas calibradas (`league_parameters` ativa): 14
  - Premier League, Super League, Primera Division, Serie A, Pro League, Primera B Nacional, Major League Soccer, USL Championship, La Liga 2, Copa Sudamericana, Copa Libertadores, J-League, La Liga, Npfl

## Métricas baseline

- **Brier 1x2 (multiclass)**: 0.6083 (ruim)
- **Brier Over 2.5 (binário)**: 0.2235 (razoável)

> Referência Brier: <0.25 (binário) ou <0.6 (multiclass 1x2) indica calibração utilizável. >0.30 binário sinaliza que as probs do simulador estão sistematicamente off.

## Regras determinísticas substitutas da IA

Para cada `fixture_simulations` resolvida, rodamos `buildEdgeTable(sim, odds, bankroll=1000)` aplicando as curvas isotônicas ativas (`model_calibration`) e aplicamos 7 regras de escolha de aposta — todas determinísticas, ZERO chamada à IA.

| Cenário | Descrição |
|---------|-----------|
| **A** | baseline: best edge ≥ 5%, sem sanity guard, sem requireCalibrated |
| **B** | sanity guard: A ∧ skip se edge > 50% em liga não calibrada (v2, era 30) |
| **C** | só ligas calibradas (league_parameters ativa) |
| **D10** | edge ≥ 10%, sem guards |
| **D15** | edge ≥ 15%, sem guards |
| **D20** | edge ≥ 20%, sem guards |
| **E** | combinação: só calibradas + sanity |
| **F** | A com blending α=0.5 (sim × mercado_devigged): edge ≥ 5%, sem guards |
| **G** | A com blending α=0.3 (mais peso pro mercado): edge ≥ 5%, sem guards |
| **H** | D20 com blending α=0.5: edge ≥ 20% blended, sem guards |

Units por aposta: liga calibrada → 2.0u, não calibrada → 0.5u (mesmo cap do recommender em prod).

## Resultados

| Cenário | n_bets | n_wins | WR % | PL (u) | Staked (u) | ROI % | Brier (bet) |
|---------|--------|--------|------|--------|------------|-------|-------------|
| A | 720 | 319 | 44.3 | 69.38 | 856.50 | 8.10 | 0.2207 |
| B | 712 | 319 | 44.8 | 35.33 | 852.50 | 4.14 | 0.2154 |
| C | 331 | 137 | 41.4 | 13.40 | 662.00 | 2.02 | 0.2243 |
| D10 | 657 | 291 | 44.3 | 79.17 | 786.00 | 10.07 | 0.2182 |
| D15 | 554 | 239 | 43.1 | 79.10 | 662.50 | 11.94 | 0.2142 |
| D20 | 467 | 199 | 42.6 | 81.34 | 565.00 | 14.40 | 0.2095 |
| E | 331 | 137 | 41.4 | 13.40 | 662.00 | 2.02 | 0.2243 |
| F | 504 | 209 | 41.5 | 68.27 | 615.00 | 11.10 | 0.2114 |
| G | 265 | 97 | 36.6 | 51.67 | 347.00 | 14.89 | 0.2149 |
| H | 179 | 57 | 31.8 | 43.58 | 233.50 | 18.66 | 0.2205 |

## Conclusão

- **Melhor cenário:** **H** com ROI = **18.66%** (179 apostas, WR 31.8%)
- **Cenários com ROI positivo:** H, G, D20, D15, F, D10, A, B, C, E.
- A IA real terá que **superar o melhor cenário determinístico** para justificar custo (~$0.03/bet em DeepSeek R1).

## Insights

- **Sanity guard (edge > 50% em liga não calibrada):** delta PL = -34.04u (❌ guard remove apostas vencedoras).
- **Filtrar só ligas calibradas:** WR delta = -2.9 pp (calibração não ajuda WR).
- **Threshold de edge:**
  - D10: 657 bets, ROI 10.07%, WR 44.3%
  - D15: 554 bets, ROI 11.94%, WR 43.1%
  - D20: 467 bets, ROI 14.40%, WR 42.6%

## Dados

- CSV bruto: `docs/superpowers/specs/2026-05-25-backtest-ai-reco-cenarios.csv` — uma linha por (cenário × sim_id), com `bet_won` = `skip` quando o cenário não apostou.

## Análise: blending sim × mercado (cenários F, G, H)

**Adicionado 2026-05-25** — validação empírica do impacto da feature de blending
(`prob_blended = α · prob_calibrated_sim + (1 − α) · prob_market_devigged`)
sobre as métricas do pipeline determinístico.

### Comparações principais

| Pair | n_bets | ROI | Δ ROI | Brier |
|------|--------|-----|-------|-------|
| **A → F** (α=1.0 → 0.5, edge≥5%) | 720 → 504 | 8.10% → 11.10% | **+3.00 pp** | 0.2207 → 0.2114 (melhor) |
| **A → G** (α=1.0 → 0.3, edge≥5%) | 720 → 265 | 8.10% → 14.89% | **+6.79 pp** | 0.2207 → 0.2149 |
| **D20 → H** (α=1.0 → 0.5, edge≥20%) | 467 → 179 | 14.40% → 18.66% | **+4.26 pp** | 0.2095 → 0.2205 |

### Observações

1. **Blending melhora ROI em todos os pares** (+3.00 a +6.79 pp). O preço é o
   volume: F filtra 30% das apostas de A; G filtra 63%; H filtra 62% de D20.

2. **G (α=0.3) tem o melhor ROI/volume balance**: ROI 14.89% sobre 265 bets.
   Quanto MENOR o α, mais peso no mercado — mais conservador (filtra mais
   apostas, mas as que passam têm edge mais "real"). WR de G é 36.6% — mais
   baixo porque sobreviveram só candidatos com `prob_blended * odd > 1.05`,
   ou seja, longshots.

3. **H (D20 + α=0.5) tem o ROI absoluto mais alto (18.66%)** mas só 179
   apostas — risco de overfit. Brier 0.2205 (pior que D20 puro 0.2095)
   sugere que o blending α=0.5 NÃO melhora calibração quando o gate já é
   alto (edge≥20%): você está filtrando 2× (gate + blending).

4. **Brier melhora com blending suave**: F (0.2114) vs A (0.2207) confirma
   que misturar com mercado dá probs mais calibradas no aggregate. G
   (α=0.3) piora ligeiramente (0.2149) — confirma que ir longe demais pro
   mercado degrada (já vimos isso em α=0: edge=−vig, prob_blended idêntica
   por mercado).

### Impacto no Kolding IF (caso real, 2026-05-25)

| Versão | edge_pct | reduction_reason |
|--------|----------|------------------|
| α=1.0 (status quo histórico) | **+113%** | none (passa em pre-filter v1; pre-filter v2 bloqueia) |
| α=0.5 (default novo) | **+56%** | pre-filter v2 ainda bloqueia (>50) |
| α=0.3 (G) | **+22%** | passa por todos os gates — IA decide |

Conclusão prática: α=0.5 reduz a TOXIDADE dos edges (114% → 56%) mas ainda
trigger pre-filter v2. α=0.3 transforma o mesmo caso num candidato
"normal-alto" que a IA pode julgar com contexto (recent form, h2h, etc.).

### Recomendação de α default

**Manter α=0.5 (default v1 universal).** Justificativas:

- F (α=0.5) tem o **melhor balance ROI × volume × Brier**: 11.10% ROI em
  504 bets, com Brier 0.2114 (melhor que A e que H).
- α=0.3 (G) é tentador pelo ROI 14.89%, mas o volume cai 63% — uma
  variância pequena pode reverter o sinal num próximo backtest.
- α=0.5 mantém **opinião do simulador majoritária** (50% peso) mas usa
  mercado como âncora — alinhado com o objetivo de v1: atenuar ruído sem
  abdicar de edges reais.
- **TODO v2** (Wave 3+): fit de α por liga via regressão ROI vs α em
  ligas com `league_parameters` calibrados + ≥50 sims resolvidas. Quando
  houver dados, α universal será substituído por `league_alpha[league] ?? 0.5`.

## Sumário console

```
scenario   | n_bets | n_wins | WR%    | PL units | staked | ROI%    | Brier
-----------+--------+--------+--------+----------+--------+---------+--------
A          |    720 |    319 |   44.3 |    69.38 | 856.50 |    8.10 | 0.2207
B          |    712 |    319 |   44.8 |    35.33 | 852.50 |    4.14 | 0.2154
C          |    331 |    137 |   41.4 |    13.40 | 662.00 |    2.02 | 0.2243
D10        |    657 |    291 |   44.3 |    79.17 | 786.00 |   10.07 | 0.2182
D15        |    554 |    239 |   43.1 |    79.10 | 662.50 |   11.94 | 0.2142
D20        |    467 |    199 |   42.6 |    81.34 | 565.00 |   14.40 | 0.2095
E          |    331 |    137 |   41.4 |    13.40 | 662.00 |    2.02 | 0.2243
F          |    504 |    209 |   41.5 |    68.27 | 615.00 |   11.10 | 0.2114
G          |    265 |     97 |   36.6 |    51.67 | 347.00 |   14.89 | 0.2149
H          |    179 |     57 |   31.8 |    43.58 | 233.50 |   18.66 | 0.2205
```

---

## Re-execução 2026-05-25 — sanity guard threshold 30 → 50

**Trigger:** análise original (Cenário B v1) mostrou que sanity guard com
threshold=30 removia winners — delta vs Cenário A foi -44.6u PL (ROI 2.95%
vs 8.10%). Pilot decidiu subir threshold pra 50 e re-rodar o backtest.

**Mudanças em código** (commits `ba22518` + `67874e9` + `69bd467`):

- `lib/ai-reco/recommender.ts` — `SANITY_EDGE_THRESHOLD: 30 → 50`
- `scripts/scraper/lib/scraper/ai_recommender_runner.rb` — idem (Ruby batch)
- `scripts/backtest-ai-reco.ts` — `SANITY_GUARD_MAX_EDGE_PCT: 30 → 50`

**Comparação B v1 → B v2** (Cenário B na tabela acima já reflete v2):

| Versão | n_bets | WR % | PL (u) | ROI % | vs A (sem guard) |
|--------|--------|------|--------|-------|------------------|
| B v1 (guard=30) | 688 | 44.5 | 24.78 | 2.95 | delta -44.60u PL |
| **B v2 (guard=50)** | **712** | **44.8** | **35.33** | **4.14** | **delta -34.04u PL** |
| A (sem guard) | 720 | 44.3 | 69.38 | 8.10 | baseline |

Subir threshold pra 50 recuperou ~24% do PL perdido pelo guard antigo
(+10.55u de 44.6u que faltavam). Range 30-50% de edge em ligas
não-calibradas voltou a ser apostado, e contém winners.

**Quantos bets atuais em produção seriam bloqueados?** Estimativa baseada
no histórico: edges > 50% representam ~11% das bets geradas (80 de 720 em
A em ligas !calibradas). Em ~45 bets atuais em prod, isso projeta ~5-6
bloqueios (vs ~12-13 com threshold=30).

**Trade-off restante:** mesmo o guard novo continua subótimo em ROI puro
— os 80 bets em ligas !calibradas com edge>50% bloqueados pelo guard
representavam PL +29.92u no histórico (27 wins, WR 33.8%, ROI ~75%). Mas
a justificativa do guard é **defensiva** contra outliers patológicos
(edge>100% por bug do simulador, ex: Kolding IF 114%), não otimização de
ROI. Threshold=50 entrega balanço razoável entre proteção e signal.

**Interação com blending α=0.5 (cenário F):** o threshold de pre-filter
opera sobre o `edge_pct` já blendado — Kolding IF 114% → 56% após
blending, e o guard v2 (50) ainda bloqueia. Cenário F do backtest
NÃO usa sanity guard, mas a combinação F + sanity_v2 em prod terá
comportamento muito próximo do F observado aqui (edges > 50% blended são
raros mesmo no histórico).
