# Design — Copilot geral cross-jogo profundo (Sub-projeto B)

> **⚠️ HISTÓRICO / SUPERSEDED (2026-05-28).** O copilot agêntico descrito aqui foi **substituído pelo recomendador IA-2** (`deepseek/deepseek-r1` → tabela `ai_recommendations`, rotas `/api/ai-reco/*`). Documento mantido como registro de pesquisa/decisão; **não reflete o código atual**.

> **Status:** APPROVED · **Data:** 2026-05-16 · **Owner:** Rafael Nobre
> **Origem:** pedido para o copilot geral da home de fixtures responder qualquer coisa sobre qualquer jogo do dia com profundidade, fazer filtro/ranking cross-jogo e comparar jogos/times.
> **Brainstorm:** `.superpowers/brainstorm/214800-1778941128/` (mockups companion).
> **Escopo:** Sub-projeto **B**. Depende das primitivas entregues no Sub-projeto **A** (`fixture-copilot-stats-first-design.md`).

## Problema

O copilot geral (`POST /api/copilot`, FAB na home `app/(dashboard)/fixtures/page.tsx`) hoje tem **uma única tool** `query_fixtures`, que devolve uma lista compacta de uma janela-dia BRT (badges, `referee_avg_booking`, `has_detail`). Ele **não abre o `detail_json` de nenhum jogo** nem roda derivações — então não responde "tudo sobre qualquer jogo" nem detecta padrões cross-jogo. O gap real é **profundidade de acesso**, não falta de histórico: cada `detail_json` já embute o histórico dos times (o dashboard deriva 14 painéis de UM blob). Não há necessidade de store histórico novo nem de RAG (dado estruturado, tamanho modesto).

## Decisões (travadas no brainstorm)

1. **Capacidades:** mergulho profundo num jogo · filtro/ranking cross-jogo · comparação entre jogos/times. **Sem** garimpo autônomo de padrões não-solicitados.
2. **Escopo:** jogos do dia (hoje/amanhã, janela BRT). Qualidade > velocidade; latência tolerada (escopo menor ⇒ exigência de qualidade maior).
3. **Agregação:** duas etapas — triagem rasa (`scan_fixtures`) → mergulho profundo (`inspect_fixture`). **Sem** pipeline/índice pré-computado (YAGNI: escopo 1 dia, latência tolerada, sem garimpo autônomo).
4. **Superfície:** **estender o `/api/copilot` existente** (mesma FAB da home). Sem endpoint novo dedicado.
5. **Transparência/auditoria:** regra de sempre — cada tool explícita no chat + auditoria total em `llm_request_logs` (`route='copilot'`, `hops[]`).
6. **Reuso:** reaproveitar as 12 tools de A (`lib/fixtures/fixture-copilot-tools.ts`) via `executeFixtureTool`, sem acoplar ao endpoint de A.

## Arquitetura

**Objetivo:** o copilot geral, no mesmo tool-loop, orquestra três famílias de tool sobre os jogos do dia: lista → triagem rasa → mergulho profundo nos top-N → síntese com evidência citada.

```
usuário → /api/copilot (tool-loop, MAX_TOOL_HOPS 3→6)
  hop 1 → query_fixtures(date)             → lista compacta do dia (tool atual, intacta)
  hop 2 → scan_fixtures(filter,sort,signals) → shortlist rankeado (filtro+projeção server-side)
  hop 3 → inspect_fixture(id) ×N top        → 12 derivações COMPLETAS de A (alta qualidade)
  hop 4 → síntese final com evidência citada
```

- `query_fixtures` — a tool atual de `lib/fixtures/copilot-tools.ts`, **não tocada** (compatibilidade retroativa: "quais jogos hoje" continua resolvendo só com ela).
- `scan_fixtures` — itera os jogos do dia, constrói `ctx{detail,home,away}` por row, roda derivadores **baratos** de `derive.ts`, filtra/ordena/projeta **no servidor**.
- `inspect_fixture(id)` — resolve `id → row → ctx{detail,home,away}` e **delega a `executeFixtureTool`** (de A) — zero lógica de dados nova.

Wrappers finos sobre funções puras já testadas; contrato `{error}`-never-throws idêntico ao A; não-streaming (consistência com o copilot atual). System prompt disciplina as duas etapas (triagem antes de mergulhar).

## Novo módulo

`lib/fixtures/copilot-scan-tools.ts` (novo, isola o que é novo; `copilot-tools.ts`/`query_fixtures` não é tocado):

- `SCAN_FIXTURES_TOOL`, `INSPECT_FIXTURE_TOOL` — schemas OpenRouter.
- `scanFixtures(args, admin)` — varre o dia, deriva barato, filtra/ordena/projeta.
- `inspectFixture(args, admin)` — busca row por id (`admin.from('fixtures').select(...).eq('id',id).maybeSingle()`), monta `FixtureToolCtx`, delega a `executeFixtureTool` (de `lib/fixtures/fixture-copilot-tools.ts`). Id inexistente / sem `detail_json` → `{ error }`.

## Contrato do `scan_fixtures`

### Catálogo de sinais por jogo (grupos projetáveis)

| Grupo | Campos | Fonte (já testada) |
|---|---|---|
| `cards` | `referee_avg_booking`, `home_avg_cards`, `away_avg_cards`, `badge_cartao_alto` | `referee_record`, `deriveRecentMatchStats`, `computeBadges` |
| `goals_over` | `home_over25_pct`, `away_over25_pct`, `avg_total_goals`, `badge_over_alto` | `deriveRecentMatchStats`, `computeBadges` |
| `btts` | `home_btts_pct`, `away_btts_pct`, `badge_btts_alto` | `deriveRecentMatchStats`, `computeBadges` |
| `first_half` | `home_fh_goal_pct`, `away_fh_goal_pct`, `badge_primeiro_tempo` | `deriveSplits1h2h`, `computeBadges` |
| `form` | `home{w,d,l,pts_recent}`, `away{w,d,l,pts_recent}`, `home_streak`, `away_streak` | `deriveTeamRecord`, `deriveStreakIndex` |
| `h2h` | `games`, `avg_goals` | `detail_json.h2h` (`RawRecentMatch[]`) |
| `odds` | `categories` (lista), `match_favorite` (label), `adamchoi_pred` (string) | `deriveOddsCategories`, `detail_json.predictions` |

Lado `home` usa o split casa; `away` usa o split fora (mesma correção do A — seleção honesta de lado). No grupo `form`: `pts_recent` = `3·w + d` do split correspondente; `*_streak` = label (`desc`) da maior sequência ativa de `deriveStreakIndex` (string, ou `null` se nenhuma).

**Estreitamento `h2h`/`odds` (decisão de planejamento):** o `detail_json.h2h` é `RawRecentMatch[]` e não há deriver de h2h nem de "favorito implícito". Calcular vitórias por lado / favorito exigiria casar nome de time, que o **Lesson #9** (drift de nomes listing×widget) marca como footgun. Logo `h2h` expõe só `games` e `avg_goals` (média de `homeGoalsFt+awayGoalsFt`), e `odds` expõe `categories` (`Object.keys(deriveOddsCategories)`), `match_favorite` (label do outcome de menor `decimal_odds` na categoria `match`, ou `null`) e `adamchoi_pred` (a `Prediction` de maior `chance` → `"stat_type"` + `": chance_team"` se houver, ou `null`). Sem `home_wins/draws/away_wins`, sem `implied_favorite` enum, sem `pred_divergence` — campos dependentes de matching por nome ficam fora por correção.

### Args

| Arg | Tipo | Notas |
|---|---|---|
| `date?` | `'today'`(def)\|`'tomorrow'`\|`'YYYY-MM-DD'` | BRT, mesmo resolver do `query_fixtures` |
| `league_substr?` | string | pré-filtro barato (igual `query_fixtures`) |
| `country?` | string (slug) | pré-filtro barato |
| `filters?` | `[{ field, op:'gte'\|'lte'\|'eq', value }]` | aplicado **server-side** após computar sinais |
| `sort?` | `{ field, dir:'asc'\|'desc' }` | rankeia por qualquer `field` |
| `signals?` | `string[]` (nomes de grupo) | projeção; default = todos |
| `limit?` | number | 1..30, default 15 (tamanho do shortlist) |

`field` usa nome pontuado: `cards.referee_avg_booking`, `goals_over.home_over25_pct`, `form.home.pts_recent`. O enum válido é documentado na `description` da tool. Field inválido → `{ error }` (a IA corrige).

### Retorno (compacto — filtrado + projetado)

```
{
  date,
  total,                       // total APÓS filtros
  fixtures: [
    { id, home_team, away_team, league, country, kickoff_brt,
      signals: { ...só grupos projetados... } }
  ]
}
```

`result_summary`: `"N/total · filtros: X · ord: Y"` (chip + auditoria). Jogo sem `detail_json` → excluído do scan (nunca lança). Contrato `{error}`-never-throws idêntico ao A; reaproveita o resolver de data e os filtros coarse do `query_fixtures`.

## Mudanças no `app/api/copilot/route.ts` (extensão in-place, retrocompatível)

**Muda:**
- `tools:` agora `[QUERY_FIXTURES_TOOL, SCAN_FIXTURES_TOOL, INSPECT_FIXTURE_TOOL]` (era só QUERY).
- `executeToolCall` vira dispatch por nome das 3 tools (em vez de rejeitar ≠ `query_fixtures`).
- `MAX_TOOL_HOPS` 3 → 6 (paridade com A; permite lista→scan→inspect×N→síntese).
- `summarizeResult` cobre os shapes de scan (`N/total`) e inspect (reusa `summarizeFixtureToolResult` de A).
- `SYSTEM_PROMPT` reescrito com a disciplina das 2 etapas.

**Não muda (retrocompat):** `bodySchema` `{messages,date?,reasoner?}` idêntico; `Hop` `{tool,args,result_summary,took_ms}` idêntico → auditoria/log inalterados; `route='copilot'` em `llm_request_logs` **sem migration/DDL**; injeção do `parsed.date` como system hint mantida; "quais jogos hoje" ainda resolve só com `query_fixtures`.

### System prompt — disciplina das 2 etapas (pt-BR)

1. Para perguntas cross-jogo: `query_fixtures`/`scan_fixtures` primeiro (triagem) — nunca inventar jogos/números.
2. Só então `inspect_fixture` nos top-N do shortlist para a análise profunda de alta qualidade.
3. Toda afirmação numérica cita o valor vindo de uma tool + a leitura; nada fora do `detail_json`.
4. pt-BR, markdown, seções curtas; diga quantos jogos casaram; liste "HH:MM BRT • A vs B (Liga, País)".
5. Se nada casar o filtro, diga explicitamente.

## UI / transparência (híbrida, no `components/fixtures/copilot-fab.tsx`)

- **Sempre visível (novo):** uma linha-chip por hop — `🔧 {tool} · {result_summary}` ✓/✗ — espelhando a linguagem visual do `FixtureToolSteps` de A (one-liner; escala para os ~6 hops). Erro de tool → chip `✗ {error}` vermelho, a IA segue.
- **Colapsado (mantido):** o `<details>` "log do turno" atual (`CopilotLogDetails`) permanece para a profundidade de auditoria — modelo, latência, tokens, e por hop `args` JSON + `took_ms` + `→ result_summary`.

Espelha o visual de A sem acoplar ao endpoint de A (A é superfície própria). Transparência sempre-visível + auditoria completa, sem inflar a bolha de resposta.

**Estados:** carregando (loader atual); erro de tool (chip `✗`, IA segue); erro de LLM (mensagem amigável + log); `MAX_TOOL_HOPS` atingido (mensagem segura, igual hoje).

## Testes (pirâmide TDD — testes primeiro)

- **Unit:** `scanFixtures` — cada grupo de sinal (valores corretos + ausência de seção → campo omitido); `filters` `gte`/`lte`/`eq` server-side; `sort` `asc`/`desc`; `signals` projeção; field inválido → `{error}`; jogo sem `detail_json` excluído. `inspectFixture` — id→ctx ok; id inexistente → `{error}`; delega a `executeFixtureTool`. `result_summary` de scan e inspect.
- **Integração (rota):** `/api/copilot` com OpenRouter mockado — 3 tools registradas; loop lista→scan→inspect; `hops[]` capturado; linha em `llm_request_logs` `route='copilot'` com `hops`; teto `MAX_TOOL_HOPS=6`; flag `reasoner`; retrocompat (só `query_fixtures` ainda funciona).
- **Component:** `copilot-fab` — chips sempre-visíveis (nome+summary, ✓/✗); `<details>` log mantido; erro de tool; erro de LLM amigável.
- **Contrato:** schemas de args das 3 tools; shape do tool-call OpenRouter (reusa padrão dos testes do copilot/A).
- **Regressão:** "quais jogos hoje" continua resolvendo só com `query_fixtures`; `Hop` shape inalterado; nenhuma chamada LLM no mount.
- **E2E (Playwright):** home → FAB → pergunta cross-jogo → chips das 3 tools aparecem → resposta citando valores; axe-core 0 violações.

## Waves

Worktree isolado + SDD por task (implementer → spec review → code-quality review → merge); autoria única (**sem `Co-Authored-By`**), Conventional Commits pt-BR, review/merge autônomos, deploy no push — mesmo pipeline das features anteriores. Gate order: remover worktree → `rm -rf .next` → lint → typecheck → vitest.

- **Wave 1 — Tools + sinais (solo, TDD strict):** `lib/fixtures/copilot-scan-tools.ts` (`scanFixtures` 7 grupos via `derive.ts`, filter/sort/projeção server-side; `inspectFixture` id→ctx→`executeFixtureTool`; schemas; `result_summary`). Sem endpoint/UI. Gate verde.
- **Wave 2 — Endpoint (depende W1):** estende `/api/copilot` (3 tools, dispatch, `MAX_TOOL_HOPS=6`, `summarizeResult`, system prompt 2 etapas). Integração com OpenRouter mockado. Congela contrato `meta.hops` (idêntico ao atual).
- **Wave 3 — UI + E2E (depende do contrato W2):** chips sempre-visíveis no `copilot-fab.tsx` + `<details>` log mantido; component + integração UI + e2e novo + axe + regressão. Merge final + deploy monitorado.

## Riscos / trade-offs

- **Scan de ~50 jogos × 7 grupos por pergunta** = CPU + latência de tool. Mitigado: derivadores puros já testados; filtro/projeção server-side compacta o payload; escopo-dia limita N; latência aceita pelo usuário.
- **Mais tools = modelo pode pular `scan` e abusar de `inspect`.** Mitigado: system prompt disciplina as 2 etapas + teto 6 hops + teste assertando triagem-antes-de-mergulho.
- **Estender endpoint em prod mexe em código vivo.** Mitigado: retrocompat (bodySchema/Hop inalterados, `query_fixtures` intacto), teste de regressão, sem DDL.
- **`inspectFixture` reusa `executeFixtureTool` de A** (acoplamento à lib). Aceito: é lib pura compartilhada (não o endpoint de A); A já a estabeleceu como primitiva reutilizável.
- **Drift de shape do `detail_json` entre fixtures.** Mitigado: contrato `{error}`-never-throws + omissão de sinal; mesmo contrato já provado em A.
