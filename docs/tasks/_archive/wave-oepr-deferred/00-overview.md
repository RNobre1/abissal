# Wave O+E+P+R — Expansão de Mercados (Corners, Cards, SOT, Players)

**Status:** DEFERRED — gate de entrada: CLV médio ≥ +1.5% sustentado em ≥100 bets reais
**Origem:** Backlog estratégico 2026-05-26 (brainstorm calibração)
**Arquivado em:** 2026-05-27

---

## Por que deferred

A expansão de mercados (corners, cards, SOT) faz sentido apenas quando o pipeline existente
(1x2/over25/btts) demonstra CLV positivo sustentado. Sem isso, ampliar mercados é amplificar
fluxo cego — mais recos sem ferramenta pra dizer se valem ou são ruído.

**Gate concreto:** CLV médio ≥ +1.5% em ≥100 bets reais resolvidas. Verificar em `/calibracao`.

---

## Sub-waves arquivadas

### W-O (Odds) — Captura de odds dos mercados novos

- Investigação: choistats expõe odds de corners/cards/SOT via `widget/fixtures/{id}`?
- Se sim: estender `lib/fixtures/parser.ts` + `lib/fixtures/repository.ts`
- Se não: avaliar Pinnacle API (~$15/mês), Bet365 scraping, Sportingbet via CF Worker proxy
- Esforço: 8-12h — Risco: bloqueio externo

### W-E (Edge Calculator Estendido)

- `lib/ai-reco/edge-calculator.ts`: estender union `Market` com mercados novos
- Isotonic calibration por mercado quando n≥30
- Esforço: 10-14h

### W-P (Prompt da IA Estendido)

- `lib/ai-reco/prompts.ts`: estender lista de mercados disponíveis
- Esforço: 4-6h

### W-R (Reconciler Estendido)

- `simulation_reconciler.rb`: pull de actuals de corners/cards/sot
- Bloqueio externo: choistats NÃO fornece corners/SOT além de placar+cartões vermelhos
- Esforço: 4-12h (depende de source alternativa)

---

## Esforço total estimado

- Total: **26-44h wall-clock** com /auto paralelo

## Ordem de execução quando gate for atingido

1. W-O primeiro (investigação choistats)
2. Em paralelo (após W-O confirmar): W-E + W-P + W-R
3. Validation: smoke E2E com ≥1 reco real em corners + reconciliada
