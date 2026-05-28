# Plano — pré-marcar "sem valor" (Parte 1) + botão "forçar análise" (Parte 2)

> **Status:** Parte 1 ✅ **IMPLEMENTADA** (2026-05-28) · Parte 2 ⏸ **DEFERIDA**
> pós-hibernação (~2026-06-03). Registrado: 2026-05-28.

## Contexto do pipeline atual (verificado 2026-05-28)

- Badge da lista (`FixtureCard`): `verdict='bet'` → **⚡ IA** (vermelho);
  `verdict='skip'` → **IA · sem valor** (cinza, recém-shipado em `c01ed59`);
  sem reco → nada. Surfaçado via `lib/fixtures/repository.ts#fetchAiVerdicts`
  (query escalar `fixture_id, verdict`, bet vence skip).
- Batch (`scripts/scraper/lib/scraper/ai_recommender_runner.rb`): seleciona
  `FROM fixture_simulations` (só jogos COM sim), `kickoff_utc` nas **próximas
  48h**, ligas calibradas primeiro, **`LIMIT 50`** (corte de **tokens**).
- **Skip é de graça:** quando nenhum mercado bate edge ≥ 10%, persiste skip
  **sem chamar o LLM** (`cost=$0`, `model='(no-llm-call)'`). O `compute` route
  (`app/api/ai-reco/compute/route.ts`) tem o mesmo caminho `persistSkip`.
- Jogos que hoje exigem on-demand: overflow do top-50, >48h, ou sem sim.

## Parte 1 — pré-marcar os "sem valor" ✅ IMPLEMENTADA (2026-05-28; custo ~0)

> **Entregue:** `ai_recommender_runner.rb` — `LIMIT 50` do SQL virou `LIMIT 500`
> (guardrail de memória); novo `LLM_CALL_BUDGET = 50` + `@llm_calls_made` capam
> **só** o ramo `run_ia_for` (chamada R1). Edge-calc roda em todas as fixtures da
> janela; skips persistem de graça (badge "IA · sem valor" cobre o overflow);
> fixtures COM valor além do teto ficam pra on-demand. Param `llm_budget:`
> injetável no construtor pra testabilidade. 3 testes RSpec novos (orçamento +
> skip não-capado), suíte de unidade verde (25/25 no arquivo; falhas restantes
> da suíte = `PG.connect` sem DB local, pré-existentes). Sem migration/frontend.

### Plano original (referência)


**Objetivo:** o badge "IA · sem valor" aparecer também nos jogos fora do top-50,
pra o Pilot não gastar clique de on-demand em jogo que só daria skip.

**Implementação:** em `ai_recommender_runner.rb`, **desacoplar o cap do LLM do
edge-calc**:
1. Rodar o edge-calc em **TODAS** as fixtures com sim na janela (sem `LIMIT 50`).
2. Persistir **skip** (sem LLM) pra todas as sem candidato ≥ threshold — de graça.
3. Aplicar o `LIMIT` (token budget) **só no ramo que chama o LLM** (top-N
   candidatos com edge, na ordem atual: liga calibrada primeiro, kickoff ASC).
4. (Opcional) ampliar a janela de 48h — sem custo de LLM, só mais inserts de skip.

**Por que é ~0 custo:** zero tokens novos (skip não chama R1); CPU/runtime
desprezível (edge-calc é ms/jogo vs 130-240s por chamada R1); só mais linhas de
skip em `ai_recommendations` (não poluem ROI/Brier — `pl_units` null).

**Limitação honesta:** só cobre jogos COM simulação (sem sim, não há probs).

**Hibernação:** é **cobertura/medição** (rodar o MESMO modelo em mais jogos),
não muda modelo/prompt/threshold/calibração → permitido agora.

**TDD (RSpec, `scripts/scraper/spec`):** o runner roda edge-calc em todas as sims
da janela; persiste skip sem LLM; LLM chamado só pro top-N candidatos; o cap
antigo não esconde mais skips.

## Parte 2 — botão "forçar análise" (PÓS-HIBERNAÇÃO ~2026-06-03; model-adjacent)

**Objetivo:** em jogos que a IA deu skip (sem valor), um botão "forçar análise"
que chama o R1 **mesmo abaixo do threshold de edge**, com flags claras de que
foi forçado e não passou do gate.

**Cuidados inegociáveis:**
1. **Flag + exclusão das métricas:** marcar a reco forçada (ex: coluna
   `forced boolean` ou `verdict='forced'`) e **excluí-la de ROI/Brier/calibração**
   — senão envenena as métricas (mesma classe do bug B19: aposta abaixo do gate
   contada como dado real).
2. **UI:** mostrar com flags explícitas ("análise forçada — não passou do edge
   mínimo; não conta pra calibração").
3. **Custo:** 1 chamada R1 por force ($) — aceitável pra uso pontual.

**Arquivos prováveis:** migration (flag) · `app/api/ai-reco/compute/route.ts`
(param `force` que bypassa o gate de edge ≥10%) · `AiRecoPanel`
(`app/(dashboard)/fixtures/[id]/_components/ai-reco-panel.tsx`) botão + display ·
queries de `/calibracao` + `lib/calibracao/ai-reco-metrics.ts` (excluir forced).

**Hibernação:** mexe no **gate de decisão** do recomendador → só após o fim da
hibernação (ver memória `hibernacao-ia-sim-calibracao`).

## Itens relacionados
- Follow-up R1 JSON (`01-r1-json-robustness.md`) — independente, também pós-hibernação.
