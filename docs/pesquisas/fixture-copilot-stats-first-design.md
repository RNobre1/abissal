# Design — Stats-first ao abrir o jogo + Copilot do jogo agêntico

> **⚠️ HISTÓRICO / SUPERSEDED (2026-05-28).** O copilot agêntico descrito aqui foi **substituído pelo recomendador IA-2** (`deepseek/deepseek-r1` → tabela `ai_recommendations`, rotas `/api/ai-reco/*`). Documento mantido como registro de pesquisa/decisão; **não reflete o código atual**.

> **Status:** APPROVED · **Data:** 2026-05-15 · **Owner:** Rafael Nobre
> **Origem:** pedido para inverter a tela inicial do jogo (stats no lugar do chat) e transformar o chat num copilot agêntico do jogo, com transparência de tools e auditoria total.
> **Brainstorm:** `.superpowers/brainstorm/1696662-1778881105/` (mockups companion).
> **Escopo:** Sub-projeto **A**. Sub-projeto **B** (copilot geral profundo + pipeline de padrões cross-jogo) fica para sessão futura, fora deste spec.

## Problema

Ao abrir um jogo, a tela inicial é o chat de IA (`AnalyzePanel`, auto-stream SSE de um resumo pré-jogo); as stats são uma rota separada (`/fixtures/[id]/stats`). O usuário quer o **dashboard como tela inicial** e o chat virando um **copilot do jogo** que enxerga não só o `detail_json` cru (que ele já recebe), mas a **camada tratada** que o dashboard calcula (correlações, trends, outliers, splits, radar, badges, readings) — respondendo de forma coerente com o que está na tela.

## Decisões (travadas no brainstorm)

1. **Sequenciamento:** A primeiro (este spec), B depois (sessão futura).
2. **Layout:** dashboard ocupa a tela; copilot via **FAB + gaveta**, mesmo padrão do copilot da home (`copilot-fab.tsx`) — consistência, sem roubar espaço, igual no mobile.
3. **Acesso a dados:** copilot **agêntico com ferramentas sob demanda** (tool-loop), não digest no prompt.
4. **Resumo automático:** **removido**. Gaveta abre vazia, puramente interativa. `/api/analyze` + `analysis_cache` aposentados.
5. **Arquitetura do endpoint:** **endpoint novo dedicado** `/api/fixture-copilot` (isolado, testável, base reaproveitável — não acoplada — para o B).
6. **Transparência:** cada tool chamada aparece explícita no chat (chip com nome + args + resumo do retorno).
7. **Auditoria/traceability:** toda chamada (LLM + cada tool) gravada de forma rastreável em `llm_request_logs` — regra de sempre, estendida.

## Arquitetura, escopo e roteamento

**Objetivo:** abrir um jogo → dashboard de 14 painéis como tela inicial; copilot do jogo numa gaveta (FAB), agêntico, enxergando derivações via ferramentas, mostrando cada tool no chat e gravando tudo para auditoria.

**Roteamento (consolidação para 1 URL):**
- `app/(dashboard)/fixtures/[id]/page.tsx` passa a renderizar o **dashboard** (hoje conteúdo de `[id]/stats/page.tsx`).
- `app/(dashboard)/fixtures/[id]/stats/page.tsx` → `redirect("/fixtures/[id]")` (bookmarks/links antigos seguem vivos; sem rota órfã).
- `AnalyzePanel` (auto-write-up SSE) removido da page; casca do copilot vira `FixtureCopilotDrawer` (FAB + Radix Dialog/drawer, espelhando `copilot-fab.tsx`).

**Aposentadoria controlada:** `/api/analyze/route.ts` e o consumo de `analysis_cache` saem do fluxo no mesmo PR que pluga o novo (sem rota morta). A migration de `analysis_cache` **não é deletada** (schema é append-only no projeto); a tabela recebe comentário `DEPRECATED`.

**Não muda (YAGNI):** os 14 painéis e a camada explicativa recém-entregue, o copilot geral `/api/copilot`, o scraper, o schema de `fixtures`/`detail_json`.

## Endpoint `/api/fixture-copilot`

`app/api/fixture-copilot/route.ts`. Tool-call loop espelhando `/api/copilot` (padrão em prod): **não-streaming** (loops de tool ruins de stream; consistência + testes determinísticos). Payload `{ fixture_id, messages, reasoner? }`. Carrega `detail_json` **uma vez** e fecha as ferramentas sobre ele. `MAX_TOOL_HOPS = 6`; cada hop pode chamar múltiplas tools.

**System prompt (pt-BR):** prime que analisa **este jogo específico**; proibido afirmar número que não veio de uma tool; deve citar valor + leitura; nada fora do `detail_json`.

**Modelo/SDK:** OpenRouter via `lib/openrouter.ts` (env `OPENROUTER_MODEL`; `reasoner=true` → deepseek-r1), igual aos endpoints atuais.

### Ferramentas (wrappers finos sobre funções puras já testadas — zero lógica de dados nova)

| Tool | Fonte | Retorno compacto |
|---|---|---|
| `get_insights` | `rankInsights` (`insights.ts`) | correlações/trends/outliers/padrões + readings |
| `get_team_record` | `deriveTeamRecord` | split casa/fora + geral |
| `get_recent_matches` | `deriveRecentMatchStats` | últimos N por lado (+ série de 1 métrica) |
| `get_h2h` | `detail_json.h2h` | confrontos diretos |
| `get_splits` | `deriveSplits1h2h` | médias 1T/2T por métrica |
| `get_distributions` | `deriveDistributions` | box stats por métrica |
| `get_radar` | `deriveRadarAxes` | 6 eixos casa×fora |
| `get_player_stats` | `detail_json.player_stats` | top jogadores por lado |
| `get_streaks` | `deriveStreakIndex` | sequências agrupadas |
| `get_referee` | `detail_json.referee_record` | média de cartões do árbitro |
| `get_odds` | `deriveOddsCategories` | mercados agrupados |
| `get_predictions` | `detail_json.predictions` | predições adamchoi |

Cada tool: schema de args validado; retorno JSON compacto + `result_summary` (string curta para o chip e para auditoria). Erro/seção ausente → `{ error: "..." }` (não lança; a IA segue com o que tem).

## Transparência de tools no chat

Resposta carrega `meta.hops[]` estruturado. UI renderiza **cada tool como passo visível**: chip `🔧 {tool} · {args}` → estado `chamando…` → `✓ {result_summary}` (ou `✗ {error}` em vermelho), e então a bolha de resposta. Streaming por-hop fica como polish futuro (YAGNI; não-streaming já mostra tudo explícito).

## Auditoria / traceability

- Reuso de `llm_request_logs`. `route` é `text not null` **sem CHECK/enum** (só índice) — gravar `route='fixture-copilot'` não exige DDL. Migration `0013_fixture_copilot_audit.sql` tem um único efeito: `COMMENT ON TABLE public.analysis_cache IS 'DEPRECATED 2026-05-15 — substituída pelo fluxo /api/fixture-copilot; mantida por histórico append-only'` (append-only, **não dropar**).
- Cada request grava: `route`, `fixture_id`, `model`, `reasoner`, `latency_ms`, `prompt_tokens`/`completion_tokens`/`total_tokens`, `error?`, e `hops[]` onde **cada hop = `{ tool, args, result_summary, took_ms }`** (espelha o shape de `Hop` já em prod no `/api/copilot`; erro de tool fica em `result_summary` prefixado `error:`) — toda tool rastreável fim a fim.

## UI

- `components/fixtures/fixture-copilot-drawer.tsx` — FAB + Radix Dialog/drawer espelhando `copilot-fab.tsx` (a11y, ESC, focus-trap). Mobile full-screen; desktop gaveta à direita.
- `components/fixtures/fixture-copilot-chat.tsx` — mensagens + input + render dos passos de tool (chip nome+args, estados ✓/✗) + bolha de resposta.
- `app/(dashboard)/fixtures/[id]/page.tsx` — remove `AnalyzePanel` e o `useEffect` de auto-stream; renderiza dashboard + `<FixtureCopilotDrawer fixtureId home away />`.
- `app/(dashboard)/fixtures/[id]/stats/page.tsx` — vira `redirect`.

**Estados:** carregando (skeleton no drawer); erro de tool (chip `✗`, IA segue); erro de LLM (mensagem amigável + log); `detail_json` ausente (drawer informa "sem detalhe ainda" + botão refresh existente).

## Testes (pirâmide TDD — testes primeiro)

- **Unit:** cada wrapper de tool (saída compacta + `result_summary`; erro quando seção falta); shaping do hop de auditoria. Não recomputa `derive.ts`/`insights.ts` (já cobertos) — testa o contrato do wrapper.
- **Integration (rota):** `/api/fixture-copilot` com OpenRouter mockado — loop executa, `hops[]` capturado, linha em `llm_request_logs` com `route='fixture-copilot'`, teto `MAX_TOOL_HOPS`, flag `reasoner`, `detail_json` ausente degrada.
- **Component:** `FixtureCopilotDrawer` (FAB abre, ESC/focus-trap), `FixtureCopilotChat` (chip de tool nome+args, estados ✓/✗, erro de LLM).
- **Integration UI:** `/fixtures/[id]` renderiza 14 slots + FAB; `/stats` redireciona; **guard de custo** — nenhuma chamada LLM no mount.
- **Regressão:** remover `AnalyzePanel`/`/api/analyze` não quebra dashboard; URL `/stats` resolve; guard de float cru preservado.
- **E2E (Playwright):** abrir jogo → dashboard (não chat) → FAB → gaveta → pergunta → chips de tool → resposta; axe-core 0 violações na gaveta.
- **Contrato:** schemas de args das tools validados; shape de request/response do tool-call OpenRouter (reusa padrão/testes do copilot).

## Waves

Worktree isolado + SDD por task (implementer → spec review → code-quality review → merge); autoria única (**sem `Co-Authored-By`**), Conventional Commits pt-BR, review/merge autônomos, deploy no push — mesmo pipeline das duas features anteriores.

- **Wave 1 — Ferramentas + auditoria (solo, TDD strict):** 12 wrappers + `result_summary` + migration `0013_fixture_copilot_audit.sql` + shape de hop logging. Sem UI. Gate: lint/typecheck/test verde.
- **Wave 2 — Endpoint (depende de W1):** `/api/fixture-copilot` (tool-loop, system prompt pt-BR, `MAX_TOOL_HOPS=6`, escrita em `llm_request_logs`); aposenta `/api/analyze` + código de `analysis_cache`. Integration com OpenRouter mockado. Congela contrato `meta.hops`.
- **Wave 3 — UI + roteamento (depende do contrato de W2):** drawer + chat + render dos passos de tool; `[id]` vira dashboard; `/stats` → redirect; remove `AnalyzePanel`. Component + integration UI.
- **Wave 4 — Integração & E2E:** fiação final, e2e novo, axe, guards de regressão, suíte cheia. Merge final + deploy monitorado.

## Riscos / trade-offs

- **Tool-loop não-streaming** = resposta aparece de uma vez (com os hops). Aceito: consistência com `/api/copilot`, testes determinísticos; streaming por-hop é polish futuro.
- **12 tools** = superfície de teste maior; mitigado por serem wrappers finos sobre funções puras já cobertas.
- **Remoção de `/api/analyze`/`analysis_cache`** mexe em código em prod; mitigado por remover só no PR que pluga o novo fluxo + guard de regressão + redirect da rota antiga.
- **`route` em `llm_request_logs`** verificado sem CHECK/enum (0012) — novo valor não exige DDL; risco descartado.
