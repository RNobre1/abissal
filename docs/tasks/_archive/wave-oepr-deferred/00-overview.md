# Wave O+E+P+R — Expansão de Mercados (Corners, Cards, SOT, Players)

**Status:** DEFERRED — gate de entrada: CLV médio ≥ +1.5% sustentado em ≥100 bets reais  
**Origem:** Backlog estratégico 2026-05-26 (brainstorm calibração)  
**Arquivado em:** 2026-05-27

---

## Por que deferred

A expansão de mercados (corners, cards, SOT) faz sentido apenas quando o pipeline existente
(1x2/over25/btts) demonstra CLV positivo sustentado. Sem isso, ampliar mercados é amplificar
fluxo cego — mais recos sem ferramenta pra dizer se valem ou são ruído.

O Pipeline Health Card (Wave A+B+C, já shippado) detectará quando W-E gerar recos sem actuals
correspondentes, tornando a descalibração visível antes de queimar capital.

**Gate concreto:** CLV médio ≥ +1.5% em ≥100 bets reais resolvidas. Verificar em `/calibracao`.

---

## Sub-waves arquivadas

### W-O (Odds) — Captura de odds dos mercados novos

- Investigação: choistats expõe odds de corners/cards/SOT via `widget/fixtures/{id}`?
- Se sim: estender `lib/fixtures/parser.ts` + `lib/fixtures/repository.ts` pra extrair e persistir em `market_anchor`
- Se não: avaliar Pinnacle API (~$15/mês), Bet365 scraping, Sportingbet via CF Worker proxy
- Persistência: estender `fixture_simulations.market_anchor jsonb` pra incluir `Corners`, `Cards`, `SOT` com odds por threshold
- Começar com over/under corners (mais líquido) e over/under cards
- Esforço: 8-12h — Risco: bloqueio externo (choistats pode não ter; alternativas custam)

### W-E (Edge Calculator Estendido)

- `lib/ai-reco/edge-calculator.ts`: estender union `Market` com mercados novos:
  `"corners-over-95" | "corners-over-105" | "cards-over-25" | "cards-over-35" | "sot-over-95" | ...`
- Prob predicta: derivar de `sim_stats.home.corners.distribution` (precisa amostras Monte Carlo)
- Migration `0035_model_calibration_metrics.sql`: adicionar novos markets ao enum `metric`
- Isotonic calibration: rodar `fit-isotonic.ts` por mercado quando n≥30
- Edge candidates por jogo: ~4-6 → ~15-25. Pre-filter: `edge ≥ 10%` antes de chamar IA
- Esforço: 10-14h

### W-P (Prompt da IA Estendido)

- `lib/ai-reco/prompts.ts`: estender lista de mercados disponíveis
- Heurísticas de contexto: corners em ligas com pressing alto vs baixo; cards em jogos de rivalidade
- Side-perspective novos: "over corners home" vs "under cards away"
- Edge_table_snapshot inclui todos candidatos novos
- Custo: ~2x tokens input (~$0.007/call em R1 — aceitável)
- Esforço: 4-6h

### W-R (Reconciler Estendido — dependência de W-O+G)

- `simulation_reconciler.rb`: pull de actuals de corners/cards/sot via choistats (Wave G confirmou: NÃO disponível além de placar + cartões vermelhos)
- **Bloqueio externo conhecido**: fixture detail page só tem `homeCorners` em recent_results histórico
- Mitigação: SofaScore API ou Footystats — investigar custo e cobertura
- Esforço: 4-6h se source OK; XL se reverse-engineering

---

## Ordem de execução quando gate for atingido

1. **W-O primeiro** — investigar se choistats expõe odds desses mercados
2. **Em paralelo (após W-O confirmar dados)**: W-E + W-P + W-R
3. **Validation gate**: smoke E2E — pelo menos 1 reco real em corners gerada + reconciliada

## Critério de sucesso (quando executar)

- ≥3 mercados novos emitindo recos diárias
- Edge_table_snapshot mostra ≥15 candidatos/jogo (vs ~6 hoje)
- 30d depois: Brier por mercado em `/calibracao`
- ROI por mercado no Pipeline Health Card

## Risco principal

Actuals de corners/SOT indisponíveis externamente. Sem reconciliation = bets sem feedback loop = calibração quebrada. Contingência: começar com cards (Wave G validou `homeReds/homeYellows` parcialmente disponíveis).

## Esforço total estimado

- W-O: 8-12h
- W-E: 10-14h
- W-P: 4-6h
- W-R: 4-12h (depende de source)
- Total: **26-44h wall-clock** com /auto paralelo
