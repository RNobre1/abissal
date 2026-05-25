# Backtest IA-2 — WALK-FORWARD (sem leakage in-sample)

**Data:** 2026-05-25T20:49:44.959Z

## Por que walk-forward

O backtest anterior (`2026-05-25-backtest-ai-reco-relatorio.md`) projetou ROI +14.4% (D20) e +18.66% (H). Esses números justificaram subir o `EDGE_THRESHOLD` de 5% pra 20% em prod. Diagnóstico do ML Researcher:

- `getActiveCurves` retorna curvas isotônicas treinadas sobre as MESMAS 1052 sims que o backtest pontuou ⇒ calibração em-amostra.
- `loadCalibratedLeagues` puxa `league_parameters` ativas — MoM sobre as mesmas linhas que o backtest avalia.
- PAV in-sample com n≈770 é 30-60% otimista ⇒ ROI real provavelmente +2% a +8%, não +14-18%.
- Multiple testing inflation: α=0.5 escolhido por ROI no MESMO dataset que tunou sanity=50 e edge=20%.

**Solução:** refit das curvas isotônicas e dos `league_params` a cada passo da janela temporal, usando APENAS samples com `kickoff_utc < t`. Avaliamos fixtures em [t, t+1d] com a calibração do passado.

**Eixo temporal:** `kickoff_utc` (hora do jogo) — não `actual_resolved_at` (batch reconciler timestamp, que se condensa em poucos pontos próximos do `now()` e não reflete a ordem cronológica real). Passo de 1 dia (não 7d): o dataset de prod tem 1052 sims concentradas em ~7 dias de kickoff, então diário dá ~6 janelas honestas; semanal nos daria 1 janela só. STEP_DAYS=1 é um proxy do cron noturno que o sistema deveria estar rodando.

## Universo

- Fonte: `fixture_simulations` com `status='resolved'` nos últimos 90 dias (janela ampliada vs. 30d do backtest in-sample, pra ter warmup decente).
- Sims usáveis (com odds disponíveis): **771**
- Odds origem fixtures.detail_json: 771
- Odds origem ai_recommendations.edge_table_snapshot: 0
- Sims sem odds: 281
- Warmup (n samples antes da primeira janela): **99**
- n_train final (samples antes da ÚLTIMA janela): **760**
- Passos diários executados (STEP_DAYS=1): **3**

## Resultados comparados (in-sample vs walk-forward)

| Cenário | ROI in-sample (anterior) | ROI walk-forward | IC95% (bootstrap, 1000×) | Δ (wf − in-sample) | n_bets wf |
|---------|--------------------------|------------------|--------------------------|---------------------|-----------|
| A | +8.10% | -14.16% | [-26.01%, -2.01%] | -22.26 pp | 642 |
| B | +4.14% | -18.26% | [-28.93%, -6.57%] | -22.40 pp | 621 |
| C | +2.02% | -31.90% | [-58.40%, -3.79%] | -33.92 pp | 58 |
| D10 | +10.07% | -13.12% | [-25.76%, -0.55%] | -23.19 pp | 603 |
| D15 | +11.94% | -13.53% | [-26.30%, -0.20%] | -25.47 pp | 570 |
| D20 | +14.40% | -14.00% | [-26.89%, 0.22%] | -28.40 pp | 522 |
| E | +2.02% | -31.90% | [-59.28%, -0.41%] | -33.92 pp | 58 |
| F | +11.10% | -13.63% | [-26.60%, 0.21%] | -24.73 pp | 541 |
| G | +14.89% | -21.56% | [-38.04%, -4.32%] | -36.45 pp | 365 |
| H | +18.66% | -19.19% | [-40.25%, 4.30%] | -37.85 pp | 237 |

## Métricas honestas (walk-forward)

| Cenário | n_bets | WR % | ROI % | Brier | Reliability (↓) | Resolution (↑) | Uncertainty | LogLoss | Sharpe-like |
|---------|--------|------|-------|-------|-----------------|----------------|-------------|---------|-------------|
| A | 642 | 34.3 | -14.16 | 0.2140 | 0.0270 | 0.0378 | 0.2253 | 0.6701 | -0.093 |
| B | 621 | 36.9 | -18.26 | 0.2186 | 0.0227 | 0.0362 | 0.2328 | 0.6792 | -0.129 |
| C | 58 | 29.3 | -31.90 | 0.2274 | 0.0792 | 0.0535 | 0.2072 | 0.6410 | -0.291 |
| D10 | 603 | 33.8 | -13.12 | 0.2131 | 0.0293 | 0.0398 | 0.2239 | 0.6715 | -0.085 |
| D15 | 570 | 33.3 | -13.53 | 0.2120 | 0.0296 | 0.0398 | 0.2222 | 0.6724 | -0.086 |
| D20 | 522 | 32.6 | -14.00 | 0.2085 | 0.0305 | 0.0407 | 0.2196 | 0.6704 | -0.089 |
| E | 58 | 29.3 | -31.90 | 0.2274 | 0.0792 | 0.0535 | 0.2072 | 0.6410 | -0.291 |
| F | 541 | 32.7 | -13.63 | 0.2075 | 0.0280 | 0.0395 | 0.2201 | 0.6657 | -0.087 |
| G | 365 | 27.7 | -21.56 | 0.2017 | 0.0459 | 0.0435 | 0.2001 | 0.5912 | -0.133 |
| H | 237 | 24.5 | -19.19 | 0.2062 | 0.0500 | 0.0272 | 0.1848 | 0.6018 | -0.111 |

> **Brier (Murphy 1973):** `BS = reliability − resolution + uncertainty`.
> - **Reliability** (mais perto de 0 = melhor): o quanto a freq observada de cada bin diverge da prob prevista.
> - **Resolution** (maior = melhor): capacidade discriminativa entre bins (vs. base rate).
> - **Uncertainty**: `p̄(1-p̄)`, limite inferior irredutível.
> 
> **Sharpe-like** = `mean(pl_per_bet) / std(pl_per_bet)`. Per-bet, NÃO anualizado. Valores > 0.10 são considerados decentes pra apostas.

## Ranking honesto (walk-forward, por ROI%)

1. **D10** — ROI -13.12% (603 bets, WR 33.8%)
2. **D15** — ROI -13.53% (570 bets, WR 33.3%)
3. **F** — ROI -13.63% (541 bets, WR 32.7%)
4. **D20** — ROI -14.00% (522 bets, WR 32.6%)
5. **A** — ROI -14.16% (642 bets, WR 34.3%)
6. **B** — ROI -18.26% (621 bets, WR 36.9%)
7. **H** — ROI -19.19% (237 bets, WR 24.5%)
8. **G** — ROI -21.56% (365 bets, WR 27.7%)
9. **C** — ROI -31.90% (58 bets, WR 29.3%)
10. **E** — ROI -31.90% (58 bets, WR 29.3%)

## Console summary

```
cenário  | n_bets | WR%   | PL u    | ROI %   | CI95% ROI         | Brier  | Rel    | Res    | LogLoss | Sharpe
---------+--------+-------+---------+---------+-------------------+--------+--------+--------+---------+-------
A        |    642 |  34.3 |  -57.78 |  -14.16 |   [-26.01, -2.01] | 0.2140 | 0.0270 | 0.0378 | 0.6701 | -0.093
B        |    621 |  36.9 |  -72.59 |  -18.26 |   [-28.93, -6.57] | 0.2186 | 0.0227 | 0.0362 | 0.6792 | -0.129
C        |     58 |  29.3 |  -37.00 |  -31.90 |   [-58.40, -3.79] | 0.2274 | 0.0792 | 0.0535 | 0.6410 | -0.291
D10      |    603 |  33.8 |  -50.36 |  -13.12 |   [-25.76, -0.55] | 0.2131 | 0.0293 | 0.0398 | 0.6715 | -0.085
D15      |    570 |  33.3 |  -49.12 |  -13.53 |   [-26.30, -0.20] | 0.2120 | 0.0296 | 0.0398 | 0.6724 | -0.086
D20      |    522 |  32.6 |  -46.19 |  -14.00 |    [-26.89, 0.22] | 0.2085 | 0.0305 | 0.0407 | 0.6704 | -0.089
E        |     58 |  29.3 |  -37.00 |  -31.90 |   [-59.28, -0.41] | 0.2274 | 0.0792 | 0.0535 | 0.6410 | -0.291
F        |    541 |  32.7 |  -47.10 |  -13.63 |    [-26.60, 0.21] | 0.2075 | 0.0280 | 0.0395 | 0.6657 | -0.087
G        |    365 |  27.7 |  -51.64 |  -21.56 |   [-38.04, -4.32] | 0.2017 | 0.0459 | 0.0435 | 0.5912 | -0.133
H        |    237 |  24.5 |  -29.94 |  -19.19 |    [-40.25, 4.30] | 0.2062 | 0.0500 | 0.0272 | 0.6018 | -0.111
```

## Dados

- CSV bruto: `docs/superpowers/specs/2026-05-25-backtest-walk-forward-cenarios.csv` (inclui `n_train_at_t` por linha).
- Cada linha: (cenário × sim_id), com `bet_won` = `skip` quando o cenário não apostou.

## Recomendação

**Todos os cenários têm ROI walk-forward NEGATIVO.** O melhor é **D10** com ROI -13.12% (CI95% [-25.76%, -0.55%]) — ainda perde dinheiro em expectativa.

### Diagnóstico

- ROI in-sample +14.40% (D20) caiu para -14.00% walk-forward (Δ = -28.40 pp).
- ROI in-sample +18.66% (H) caiu para -19.19% walk-forward (Δ = -37.85 pp).
- Magnitude do leakage confirma o diagnóstico do ML Researcher: 22-38 pp de queda — mais severo que a estimativa inicial (30-60% inflation).
- Brier (~0.21) e Reliability (~0.03) honestos NÃO são catastróficos — as probs calibradas são razoáveis. **O problema é o gap entre essas probs e as odds de mercado**: o simulador não tem edge real contra a casa.

### Ações concretas

1. **EDGE_THRESHOLD=20% NÃO é mais defensável** com base no backtest. Subir o threshold removeu volume sem melhorar ROI (D10→D20: -13.12% → -14.00%, ranking PIOROU). Sugestões alternativas:
   - **Voltar pra 5-10%** mas com units MUITO menores (0.1u ao invés de 0.5u) enquanto o sinal real é inexistente. Melhor cenário hoje é D10 com ROI -13.12% — ainda perde, mas perde menos.
   - **Pausar produção até** ter mais ligas com `league_parameters` calibradas (cenários C/E têm n=58 bets — calibração não cobre suficiente do universo).
2. **sanity=50 mantém-se discutível.** B (com guard) tem ROI -18.26% vs A -14.16%: guard remove +4 pp de retorno. Em walk-forward NÃO ajuda. Voltar pra threshold mais alto (ex 75-100%) ou desativar.
3. **α=0.5 (blending) é defensável**: F (α=0.5) tem ROI -13.63% vs A (α=1.0) -14.16% — ligeira melhora, com Brier mais baixo (0.2075 vs 0.2140). H (D20+α=0.5) é PIOR que F porque o gate alto remove o pouco signal restante.
4. **α=0.3 é PERIGOSO**: G tem ROI -21.56% (pior que A). Mais peso pro mercado faz sentido apenas se o mercado fosse mais informativo que o sim — não é. Manter α=0.5.
5. **Investigação a montante** (urgente):
   - O simulador tem Brier 0.21 binário (OK) mas Reliability **bem maior que zero** (0.027-0.08). Significa que as probs estão sistemática e moderadamente off-calibradas em walk-forward. Aumentar o universo de calibração (mais ligas, mais semanas).
   - Vies de selecionar odds: confirmar que `extractOdds` está pegando os mesmos timestamps de mercado que estavam vigentes na hora do pre-match (não closing line). Closing line bias inflaria o gap odds−prob, anulando edges aparentes.
   - Considerar Platt scaling como alternativa ao isotonic — PAV em n=100-300 super-fita pequenas amostras.

### Conclusão executiva

Os números que justificaram EDGE_THRESHOLD=20 e α=0.5 são **artefato de leakage in-sample**. O pipeline determinístico AINDA NÃO tem edge real. Antes de gastar mais tokens com DeepSeek R1, é mais barato (a) reduzir units, (b) investigar a fonte do gap odds−prob, (c) recalibrar quando o universo de sims dobrar.

