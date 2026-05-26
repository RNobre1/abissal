# ADR-008: Mercados Secundários — Corners, Cards, SOT

**Status:** ACCEPTED  
**Data:** 2026-05-26  
**Autor:** Wave O+E worker (autonomous)  
**Pilot:** Authorized execution

---

## Contexto

O simulador Monte Carlo já modelava 7 métricas por time (goals, sot, cards, fouls, corners, tackles, offsides) com p10/p50/p90 disponíveis em `fixture_simulations.sim_stats`. No entanto:

- `edge-calculator.ts` tinha `Market = "1x2" | "over25" | "btts"` (literal hard-coded)
- `fixture_simulations.market_anchor` só continha `{ Result: 1x2 }` (choistats só fornece odds 1x2 por padrão)
- `prompts.ts` listava só 3 mercados pro DeepSeek R1
- Wave G (2026-05-25) preparou colunas `actual_corners_home/away`, `actual_cards_*`, `actual_sot_*` — mas vazias pois o reconciler não populava esses campos

Pilot pediu: "não quero que ele só dê analise de 3 mercados, e assim teremos mais dados do desempenho dele".

---

## Investigação (W-O)

**Fixture usada para inspeção:** `19693448` (LDU Quito vs Always Ready, Copa Libertadores, 2026-05-26)

### Endpoint `recent-results` widget

```
GET https://api.choistats.com/api/widget/match/{id}/recent-results
```

`fixture.homeTeamHomeAvgs` / `homeTeamOverallAvgs` / `awayTeamAwayAvgs` / `awayTeamOverallAvgs` contêm:
- `cornersTotal`, `cornersFor`, `cornersAg`
- `cardsTotal`, `cardsFor`, `cardsAg`
- `shotsOnTargetFor`, `shotsOnTargetAg`
- `bookingPointsFor`, `bookingPointsAg`

Entradas históricas (`recentHomeResults[]`, `headToHead[]`) contêm por jogo:
- `homeCorners`, `awayCorners`
- `homeYellows`, `awayYellows`, `homeReds`, `awayReds`
- `homeShotsOnTarget`, `awayShotsOnTarget`

### Endpoint `odds` widget

```
GET https://api.choistats.com/api/widget/match/{id}/odds?lang=en
```

Retorna **40 mercados** para fixtures premium. Relevantes:

| Market Name | Outcomes disponíveis |
|---|---|
| `Total Corners` | Over/Under 7.5, 8.5, 9.5, 10.5, 11.5, 12.5 |
| `Total Cards` | Over 4.5, Over 5.5 |
| `Total shots on target` | Over/Under 7.5, 8.5, 9.5, 10.5, 11.5 |

**Esses odds já são persistidos em `detail_json.odds_summary`** pelo `WidgetMerger` desde a implementação original — basta extraí-los.

### Disponibilidade de actuals para reconciliação

O objeto `fixture` no widget `recent-results` quando `status=FT` expõe:
- `homeGoalsFt`, `awayGoalsFt` ✓
- `homeReds`, `awayReds` ✓ (mas não yellows)
- **Não expõe**: `homeCorners`, `awayCorners`, `homeShotsOnTarget`, `awayShotsOnTarget`, `homeYellows`, `awayYellows`

Portanto `actual_corners_*`, `actual_sot_*`, `actual_cards_*` **permanecem NULL** após reconciliação. Essa limitação foi documentada na migration 0029.

---

## Decisão

**Caso A**: choistats fornece odds para corners, cards e SOT via widget `odds`. Prosseguir com implementação completa.

### Mercados incluídos no MVP

| Market | Linhas | Razão |
|---|---|---|
| corners-over / corners-under | 8.5, 9.5, 10.5 | Choistats fornece; sim_stats tem corners p50 |
| cards-over / cards-under | 3.5, 4.5, 5.5 | Choistats fornece (4.5/5.5 mais comuns); sim_stats tem cards p50 |
| sot-over / sot-under | 7.5, 9.5, 10.5 | Choistats fornece; sim_stats tem sot p50 |

### Probabilidade estimada: Poisson CDF aproximação (V1)

**Problema**: sim_stats dá p10/p50/p90, não a CDF completa.

**V1 (MVP)**: usar p50 como Poisson mean. Para valores na faixa 3-15 (corners/cards/SOT), p50 ≈ mean com erro < 5%.

```
P(X > threshold) ≈ 1 - PoissonCDF(floor(threshold), mean=p50_home + p50_away)
```

**V2 (futuro)**: usar amostras reais do Monte Carlo para CDF exata.

### Reconciliação de actuals

**DEFER total**: nenhum dado real disponível via API para o jogo reconciliado (apenas reds, não yellows/corners/SOT). Colunas `actual_*` permanecem NULL até fonte alternativa.

---

## Consequências

### Positivo
- IA analisa 6-9 mercados adicionais por fixture (de 3 para potencialmente 15+)
- Dados de performance futuros permitirão calibração específica por mercado
- Sem custo adicional de API (odds já estão no `detail_json`)

### Negativo / Riscos
- Probabilidades Poisson são aproximações — não há back-testing para validar accuracy
- `actual_*` continuam NULL — modelo não pode ser calibrado via dados históricos até fonte alternativa
- Mais candidatos = mais tokens no prompt da IA = custo ligeiramente maior por fixture

### Regra V1: thresholds MVP
- Corners: média histórica em ligas top = 9-11 cantos/jogo. Linhas 9.5/10.5 mais informativas.
- Cards: média = 3-5 cartões/jogo. Linhas 3.5/4.5 mais comuns.
- SOT: média = 7-10 chutes/jogo. Linha 7.5/9.5 mais informativas.

---

## Alternativas consideradas

### Caso C: usar Pinnacle API para odds alternativas
- Custo: ~$15/mês
- **Rejeitado**: choistats já fornece gratuitamente.

### Não implementar mercados secundários
- **Rejeitado**: Pilot explicitamente pediu expansão.

---

## Lições aprendidas

1. O widget `odds` do choistats expõe ~40 mercados completos — muito mais do que os 3 usados historicamente. Verificar widgets adicionais antes de assumir limitação de dados.
2. p50 como aproximação de mean para Poisson é válido no range 3-15; documentar claramente a aproximação.
3. Actuals para corners/cards/SOT requerem fonte alternativa (ex: Sportmonks direto, Football-Data.co.uk, ou scraping da detail page do adamchoi pós-jogo).
