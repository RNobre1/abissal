# Agent Selection Guide — Abissal

Refina o guia global para este repositório. O roteamento base continua valendo:
Opus planeja/explora/escreve testes/revisa; `openrouter:z-ai/glm-5.2` implementa
ticket fechado. O que muda aqui é o **contrato do handoff** e a lista de trabalho
que não se delega.

## Nunca delegue para modelo barato

Estas não são tarefas de implementação — são decisões, e no Abissal já custaram
caro quando tratadas como mecânicas:

- **Prompt de LLM, threshold de edge, fração de Kelly, escolha de modelo.** Mudam
  por evidência medida, nunca por calendário nem por intuição (regra B24). O
  backtest walk-forward de 25/05 derrubou 10 de 10 cenários que pareciam bons
  in-sample. Refit isotônico/paramétrico é mecânico e automatizado; o resto não é.
- **Migration de banco.** São append-only: nunca editar uma já aplicada, sempre
  criar a próxima `NNNN_`. Aplicar em produção é decisão do Pilot, não do agente.
- **Qualquer coisa que decida o que a simulação ou o recomendador vão dizer.**
  Regra operacional: o ticket tem que **nomear** o algoritmo e os parâmetros. Se
  ele pedir para *escolher* qual — qual curva, qual `ν`, qual fator de correção —
  pare e devolva a pergunta. No Abissal essa escolha passa por gate de evidência
  (held-out cronológico, bootstrap pareado deflacionado), nunca por julgamento de
  agente. B32 e B35 são os dois casos em que a hipótese intuitiva foi refutada
  pela própria data do projeto.

## Contrato do handoff de implementação

O filho **deve ler o `CLAUDE.md` da raiz antes de escrever qualquer linha** — não
é opcional, é a fonte da verdade declarada do projeto. O handoff repete o
essencial abaixo porque o filho não tem as skills do Claude Code para se apoiar,
mas a repetição é rede de segurança, não substituto da leitura.

Todo handoff para um filho de implementação precisa carregar, por escrito:

**Escopo e TDD**
- Os testes já existem e já falham. O trabalho é fazer passar — não escrever
  testes novos como especificação, não relaxar assert, não marcar `skip`.
- Não tocar arquivo fora dos alvos listados no ticket.

**Gates que precisam estar verdes antes de reportar concluído**
```bash
pnpm lint && pnpm typecheck && pnpm test
cd scripts/scraper && bundle exec rspec   # só se mexeu no scraper Ruby
pnpm build                                # só se adicionou Client Component novo
```
O último não é opcional por preciosismo: `typecheck` + `test` já passaram verdes
num Client Component que quebrava no build (Wave N, OCR de bilhete).

**Armadilhas do projeto que um agente novo não infere**
- `createAdminClient()` é `service_role` e **ignora RLS**. Toda leitura de tabela
  user-scoped feita com ele precisa de `.eq("user_id", ...)` explícito. Há guard
  estático em `tests/unit/multiuser-isolation-guard.test.ts` que quebra o CI —
  o sistema tem duas contas reais em uso, isso já vazou dado de verdade duas vezes.
- **Nunca** `export const runtime = "edge"`. O OpenNext roda em Node; isso quebra
  o Worker (lição B22).
- O Worker Cloudflare é frágil com payload pesado: nada de cruzar `detail_json`
  inteiro para ele. Computar badges/insights em SQL ou renderizar `ssr:false`
  (B12/B14/B21/B23).
- Em `fixture_simulations.sim_stats` a chave é **`sot`**, nunca `shots_on_target`.
- `fixture_simulations` é versionada por `model_version` e versões coexistem. Quem
  lê para **agir** precisa de `DISTINCT ON (fixture_id)` — sem isso um bump de
  versão duplica recomendações (B53).
- **O id-space é dividido e o join errado casa zero linhas em silêncio.**
  `fixture_simulations.fixture_id` e `ai_recommendations.fixture_id` guardam o id
  numérico do **choistats** (~19,7M, parseado de `source_url` `/fixture/<id>`);
  já `fixture_badges_view.fixture_id` é o `fixtures.id` **interno** (~31 mil).
  Mesmo nome de coluna, id-spaces diferentes. Use sempre
  `lib/fixtures/choistats-id.ts#parseChoistatsId` — é a fonte única, e existe
  porque a lógica já esteve duplicada em quatro lugares. Valide com um `count(*)`
  de match antes de rodar backfill caro: um join no id errado não falha, retorna
  zero linhas em silêncio — foi assim que um backfill pulou 388 fixtures (B29).
- **`0` não é ausência de dado, e `?? 0` em agregador é quase sempre bug.** Guard
  de "tenho dado?" testa o **domínio válido** (`> 0` para uma média), não `nil` —
  o produtor externo manda `0.0` e `null`, não `nil`. Em agregação, `null` sai do
  numerador **e** do denominador; "nenhum valor válido" devolve `null` para a UI
  mostrar "—". Zero real continua zero e a distinção precisa sobreviver até a
  tela. Esta é a classe de bug mais recorrente do projeto: quatro instâncias
  independentes, uma delas protegida por um teste chamado *"treats nulls as
  zero"* (B50/B52). Se você encontrar uma, varra as outras.
- **Tabelas que existem no schema mas estão mortas:** `analysis_cache`,
  `league_baselines`, `actuals_fixture_mapping`. Migrations são append-only, então
  o schema permanece — mas nada lê nem grava nelas. Não "conserte" a fiação delas
  por conta própria; ressuscitar `analysis_cache` em particular é uma decisão em
  aberto do Pilot, não um bug para corrigir dentro de outro ticket.
- Numerais na UI vão em `font-mono` com `tabular-nums` (classe `.num`).

**Commits**
- Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`).
- **Nunca** adicionar `Co-Authored-By` — regra explícita do projeto, sem exceção.

## Isolamento

Filho de implementação roda em worktree próprio. Vale ainda mais aqui: o
`scripts/scraper/` é sub-projeto Ruby com `mise`/`bundle` próprios, e dois agentes
mexendo na mesma árvore se atropelam.

## Revisão

Segue o global: harness `claude`, `opus[1m]`, effort `xhigh`, skill
`traycer-review`. No Abissal a revisão deve checar explicitamente se a feature
está **fiada no caminho de produção principal** — reconciler, calibração e
recomendador já foram "terminados" aqui sem nunca serem chamados por ninguém
(B16/B25). Código que ninguém invoca passa em todos os testes.
