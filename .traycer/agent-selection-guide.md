# Agent Selection Guide — Abissal

> Complementa o guia global (`~/.traycer/agent-selection-guide.md`), não o
> substitui. **O roteamento continua sendo o de lá** — Opus decide, Sonnet 5
> implementa ticket fechado, Fable 5 audita o que é perigoso, e revisão nunca
> volta para o mesmo agente **nem para o mesmo modelo** que escreveu.
>
> O que este arquivo acrescenta é o que só vale **neste repositório**: as
> armadilhas que já custaram tempo aqui e que um agente-filho não tem como
> adivinhar.

---

## Antes de qualquer coisa

**Leia o `CLAUDE.md` da raiz e o `docs/lessons.md`.** São 56 lições, cada uma
paga com horas de depuração. Um agente que ignora uma delas não está
economizando tempo — está repetindo um defeito que já foi resolvido.

O `CLAUDE.md` é o hub e declara isso explicitamente: as lições ficam em
`docs/lessons.md`, e é lá que se faz append — nunca no `CLAUDE.md`.

---

## Ferramentas: o que quebra aqui

**1. TCP 5432/6543 está bloqueado na rede local do Pilot.** `psql` e qualquer
conexão `pg` direta falham do ambiente de desenvolvimento — não é ambiente
quebrado, é filtro de ISP (ADR-004 / B30). O caminho é HTTPS:

```bash
# leitura: PostgREST
curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/<tabela>?select=..." \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
# DDL: Management API (ver CLAUDE.md § Commands)
```
Nos runners do GitHub Actions não há esse filtro — lá o scraper usa o pooler
normalmente. Não "conserte" o código porque ele falhou localmente.

**2. Confira o `tsc` pelo EXIT CODE**, nunca por `| tail` — o pipe devolve 0
mesmo com erro.

**3. `pnpm build` é gate obrigatório quando entra Client Component novo.** Não é
preciosismo: `pnpm typecheck && pnpm test` passaram verdes num componente que
quebrava o build (Wave N, OCR de bilhete). Os outros gates não o substituem.

**4. O scraper Ruby é sub-projeto com toolchain própria.** `cd scripts/scraper
&& mise install && bundle install` antes de qualquer `rspec`. Localmente
`bundle exec rspec` roda **741 de ~770** — os de integração pulam sem Postgres
em `:5433` (B54); no CI eles abortam em vez de pular. Menos exemplos localmente
**não é regressão**.

**5. Este repositório é majoritariamente PT-BR acentuado**, inclusive em nomes
de teste e strings de UI. Edição por regex de shell (`sed`, `perl -0pi`) é
frágil com acento e falha em **silêncio** — e mutação que não aplica é
indistinguível de guarda que não existe: nos dois casos a suíte fica verde. Use
as ferramentas de edição do harness, ou `python3` com `assert alvo in conteudo`.

**6. Ao reverter uma mutação, NUNCA `git checkout --`** em arquivo com mudanças
não commitadas: ele restaura o último commit e apaga o trabalho da sessão.
Reverta pelo mesmo caminho que aplicou.

---

## Disciplina de teste

TDD de verdade: teste primeiro, **visto falhando**, depois o código. O ticket
que sai para implementação já traz os testes escritos e vermelhos — o executor
faz passar, não escreve a especificação.

E a parte que costuma ser pulada: **guarda só é guarda depois de mutada.**
Quebre o código de propósito e confirme que um teste ESPECÍFICO fica vermelho.
Teste que nunca foi visto vermelho é decoração — e decoração é pior que teste
nenhum, porque cria confiança falsa.

**Ao escrever dublê, pergunte em que ele difere do objeto real.** Duas regras
concretas daqui:

- ⚠️ **O PostgREST corta em 1.000 linhas.** Um mock que devolve 5.000 numa
  chamada é mais generoso que a produção, e o código que depende disso passa no
  teste e trunca no ar.
- 📦 **Payload de fixture usa arquivo REAL versionado** (`tests/fixtures/detail-json/`),
  não JSON inventado. Mock inventado e bug convergem para a mesma ficção: o
  teste confirma a suposição errada em vez de refutá-la (B51).

---

## O que um agente-filho NÃO faz sozinho

**Não aplica migration.** Escreve o `.sql` numerado em `supabase/migrations/` e
**para**. Migrations são append-only: nunca editar uma já aplicada, sempre criar
a próxima `NNNN_`. Quem aplica é o Pilot, depois de revisar.

⚠️ **Não há Supabase de staging.** O `.env.local` aponta para o banco **vivo**,
com as duas contas reais em uso. Toda escrita ad-hoc é escrita em produção.

**Não decide o que a IA vai dizer.** Prompt de LLM, threshold de edge, fração de
Kelly, escolha de modelo — mudam por **evidência medida**, nunca por calendário
nem por intuição (B24). O backtest walk-forward de 25/05 derrubou 10 de 10
cenários que pareciam bons in-sample. Refit isotônico/paramétrico é mecânico e
automatizado; o resto não é. Regra operacional: **o ticket tem que nomear o
algoritmo e os parâmetros.** Se ele pedir para *escolher* qual — qual curva,
qual `ν`, qual fator de correção — pare e devolva a pergunta. B32 e B35 são os
dois casos em que a hipótese intuitiva foi refutada pela própria data do projeto.

**Não fala com o mundo.** Qualquer coisa que publique no Telegram (o cron
`telegram-closure` escreve no chat real do Pilot), consuma OpenRouter em lote ou
toque env/secret de produção volta para o orquestrador.

**Não mexe na banca.** Registrar aposta, transação ou resolver bilhete é dado
financeiro real de duas pessoas. Leitura sim; escrita, nunca sem ordem.

**Não decide sozinho depois de três tentativas.** Se um teste não passa na
terceira, o problema provavelmente é a arquitetura, não o código. Devolva.

---

## Armadilhas do domínio que um agente novo não infere

- **`createAdminClient()` é `service_role` e ignora RLS.** Toda leitura de tabela
  user-scoped feita com ele precisa de `.eq("user_id", ...)` explícito. Há guard
  estático em `tests/unit/multiuser-isolation-guard.test.ts` que quebra o CI —
  o sistema tem duas contas reais, e isso já vazou dado de verdade duas vezes.
- **Nunca** `export const runtime = "edge"`. O OpenNext roda em Node; isso quebra
  o Worker (B22).
- O Worker Cloudflare é frágil com payload pesado: nada de cruzar `detail_json`
  inteiro para ele. Computar badges/insights em SQL ou renderizar `ssr:false`
  (B12/B14/B21/B23).
- Em `fixture_simulations.sim_stats` a chave é **`sot`**, nunca `shots_on_target`.
- `fixture_simulations` é versionada por `model_version` e versões **coexistem**.
  Quem lê para **agir** precisa de `DISTINCT ON (fixture_id)` — sem isso um bump
  de versão duplica recomendações (B53).
- **O id-space é dividido e o join errado casa zero linhas em silêncio.**
  `fixture_simulations.fixture_id` e `ai_recommendations.fixture_id` guardam o id
  numérico do **choistats** (~19,7M, parseado de `source_url`); já
  `fixture_badges_view.fixture_id` é o `fixtures.id` **interno** (~31 mil). Mesmo
  nome de coluna, id-spaces diferentes. Use sempre
  `lib/fixtures/choistats-id.ts#parseChoistatsId` — fonte única, criada porque a
  lógica já esteve duplicada em quatro lugares. Valide com um `count(*)` de match
  antes de rodar backfill caro: um join no id errado não falha, retorna zero
  linhas em silêncio, e foi assim que um backfill pulou 388 fixtures (B29).
- **`0` não é ausência de dado, e `?? 0` em agregador é quase sempre bug.** Guard
  de "tenho dado?" testa o **domínio válido** (`> 0` para uma média), não `nil` —
  o produtor externo manda `0.0` e `null`, não `nil`. Em agregação, `null` sai do
  numerador **e** do denominador; "nenhum valor válido" devolve `null` para a UI
  mostrar "—". Zero real continua zero e a distinção precisa sobreviver até a
  tela. É a classe de bug mais recorrente do projeto: quatro instâncias
  independentes, uma delas protegida por um teste chamado *"treats nulls as
  zero"* (B50/B52). Se você encontrar uma, varra as outras.
- **Prior não é predição.** A simulação emite `p_home/p_draw/p_away` mesmo quando
  não tem histórico do time — e a saída de fallback tem a cara de uma previsão
  convicta. Ao mexer no motor ou no consumidor, trate "não tenho dados" como um
  estado distinto de "tenho dados que dão 44/28/28"; é a mesma família do item
  anterior, com consequência financeira.
- **Tabelas que existem no schema mas estão mortas:** `analysis_cache`,
  `league_baselines`, `actuals_fixture_mapping`. Migrations são append-only, o
  schema permanece — mas nada lê nem grava nelas. Não "conserte" a fiação delas
  por conta própria; ressuscitar `analysis_cache` é decisão em aberto do Pilot,
  não um bug para corrigir dentro de outro ticket.
- Numerais na UI vão em `font-mono` com `tabular-nums` (classe `.num`).

---

## Gates antes de reportar concluído

```bash
pnpm lint && pnpm typecheck && pnpm test
cd scripts/scraper && bundle exec rspec   # só se mexeu no scraper Ruby
pnpm build                                # só se adicionou Client Component novo
```

⚠️ **Executores em paralelo derrubam teste por contenção.** Antes de acreditar
num vermelho — e sobretudo antes de deixar alguém "consertar" — rode o arquivo
isolado.

---

## Commits

Conventional Commits, em português (`feat:`, `fix:`, `refactor:`, `test:`,
`docs:`, `chore:`). **NUNCA `Co-Authored-By`** nem trailer equivalente — autoria
única do Pilot, regra explícita do projeto, sem exceção.

Não faça `git push` sem ordem explícita.

---

## Worktree: o passo que sempre falta

Todo filho que **escreve** código recebe worktree próprio — vale ainda mais aqui,
porque `scripts/scraper/` é sub-projeto Ruby com `mise`/`bundle` próprios e dois
agentes na mesma árvore se atropelam. Filho que só **lê** (exploração, varredura,
auditoria) fica em Local.

Worktree novo nasce **sem `node_modules` e sem `.env.local`**, então nenhum teste
roda e o executor reporta sucesso sem ter rodado nada:

```bash
ln -sfn "/home/rnobre/Área de trabalho/Projetos Git/abissal/node_modules" node_modules
ln -sfn "/home/rnobre/Área de trabalho/Projetos Git/abissal/.env.local"   .env.local
[ -x node_modules/.bin/vitest ] || echo "FALTA node_modules"
```

O `.gitignore` do repo já cobre os dois (`/node_modules` e `.env*`), então o
symlink não vaza num `git add -A` — mas confira, não presuma.

Remova as worktrees depois de integrar, conferindo antes o que não está em
`origin/main`.

---

## Modelos: o que não usar

- **`haiku` está fora da política.** Ele não aceita `reasoning_effort`, e pedir
  `xhigh` a ele é instrução descartada **em silêncio** — não erro. Como aqui tudo
  roda em `xhigh`, ele não entra nem para varredura.
- **Não confunda roteamento de agente com modelo do produto.** `deepseek/r1`,
  `deepseek-v3.2` e afins são configuração do recomendador e da análise, vivem em
  env var, e trocá-los é decisão de evidência (B24) — não tem relação com qual
  modelo o Traycer usa para programar.
- Confira o catálogo antes de adotar modelo novo (`traycer_list_harness_models`).

---

## Revisão

Segue o global: harness `claude`, `opus[1m]`, effort `xhigh`, skill
`traycer-review` — e nunca no modelo que escreveu.

No Abissal a revisão deve checar explicitamente se a feature está **fiada no
caminho de produção principal**. Reconciler, calibração e recomendador já foram
"terminados" aqui sem nunca serem chamados por ninguém (B16/B25). **Código que
ninguém invoca passa em todos os testes.**

Mudança que toca RLS, `createAdminClient()`, rota pública, secret ou dado das
duas contas vai também para o **Fable** — peça refutação, não aprovação.
