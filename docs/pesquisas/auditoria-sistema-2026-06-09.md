# Auditoria geral do sistema — 2026-06-09

> Workflow multi-agente: 10 revisores (1 por subsistema) + verificação adversarial achado a achado (66 agentes, ~12min). Cada item abaixo foi CONFIRMADO por um verificador independente que tentou refutá-lo lendo o código real e checou se já não estava documentado em `docs/lessons.md`/`CLAUDE.md`. 5 achados foram refutados e descartados (lista no fim).

**51 achados confirmados** · severidade: high: 6 · medium: 30 · low: 15

---


## 🟠 HIGH (6)


### [app-api] UPDATE path do 'Apostei' altera stake/casa da bet sem ajustar o ledger (transactions é imutável) — saldo da banca diverge

**Onde:** `app/api/ai-reco/apostei/route.ts:231`


No INSERT path, `place_bet` (0006_bet_rpcs.sql:131-137) grava bet + transaction `bet_stake` com o valor da stake. No UPDATE path idempotente (apostei/route.ts:231-243 e apostei/batch/route.ts:150-160), revisar a aposta faz `update bets set total_stake, total_odds, house_id` direto — mas a transaction original NUNCA é ajustada (e nem poderia via update: trigger `transactions_block_update`, 0002_audit_triggers.sql:161-163, torna transactions imutável). Resultado: `house_balance()` (0003, computado de transactions) fica com o débito antigo enquanto `bets.total_stake`/`pending_stake` mostram o novo valor; mudar `house_id` é pior — a bet migra de casa mas o débito de stake fica na casa original. O comentário da rota afirma 'ledger fica coerente', o que é falso. Caminho de produção real (botão ✅ Apostei revisando stake/casa).


**Fix sugerido:** Substituir o UPDATE direto por um RPC transacional (ex. `update_pending_bet_stake`) que emita transactions compensatórias append-only (estorno do bet_stake antigo + novo bet_stake na casa/valor corretos), ou então proibir alteração de stake/house no path idempotente (retornar 409 e exigir cancelamento+nova aposta). Aplicar nas duas rotas (single e batch).


<details><summary>Evidência do verificador</summary>

CONFIRMADO ponto a ponto. (1) INSERT path: `place_bet` insere transaction `bet_stake`/'out' com `v_total_stake` na casa original (supabase/migrations/0006_bet_rpcs.sql:131-137). (2) UPDATE path idempotente: app/api/ai-reco/apostei/route.ts:227-256 faz `update bets set total_stake, total_odds, expected_return, house_id` direto (linhas 234-241), sem nenhuma transaction compensatória; idêntico em app/api/ai-reco/apostei/batch/route.ts:148-164 (processItem). (3) Transactions são de fato imutáveis: `tg_transactions_immutable` faz `raise exception 'Transactions are immutable...'` em qualquer UPDATE (0002_audit_triggers.sql:147-150; trigger `transactions_block_update` criado logo abaixo) — só entrada compensatória resolveria, e a rota não cria nenhuma. (4) `house_balance` (0003:8-40) computa balance/staked_to_date de `transactions` mas `pending_stake` de `bets.total_stake` — após revisão de stake os dois divergem; mudar `house_id` deixa o débito na casa antiga e o pending na nova, corrompendo o saldo das DUAS casas (e os `balance_snapshots` diários derivados). (5) Pior que o reportado: a divergência é PERMANENTE — `resolve_bet` (0006:200-248) credita `bet_return` baseado em `v_bet.expected_return`/`total_stake` NOVOS e na `house_id` NOVA, enquanto o débito `bet_stake` antigo fica com valor/casa originais; o ledger nunca se reconcilia. (6) O comentário da rota (route.ts:39-42) afirma 'Permite o Pilot revisar casa/stake sem duplicar (ledger fica coerente)' — afirmação falsa para mudança de stake/casa. (7) Não documentado como conhecido/aceito: grep por apostei/ledger/transactions em docs/lessons.md só acha B13 (gap de harness SQL) e B21 (perf de view), ambos não relacionados; CLAUDE.md não menciona. Caminho de produção real: botão '✅ Apostei' com bet pending existente. Severidade mantida em high (integridade financeira da banca corrompida permanentemente, mas escopo single-user, valor limitado ao delta de stake/casa por revisão, corrigível com entradas compensatórias manuais).

</details>


### [banca-domain] Bet builder nunca debita o stake no ledger (sem transação bet_stake)

**Onde:** `app/(dashboard)/bilhete/builder/actions.ts:69`


createBetBuilderAction insere a row em `bets` diretamente (linhas 69-84) e as selections (linha 117), mas NUNCA insere a transação `bet_stake` — diferente de placeBetAction e commitSlip, que passam pelo RPC place_bet (0041, linhas 114-122) que grava o débito. Não existe trigger que crie transactions a partir de bets (0002 só cria audit_log/bet_events). Resultado: toda aposta bet_builder NÃO-free entra no ledger sem débito; quando resolve_bet roda, o `bet_return` é creditado integral (expected_return) → `house_balance` (0003) infla pelo valor do stake em cada builder ganho, e builders perdidos nunca aparecem como saída de dinheiro. O saldo da banca diverge permanentemente da realidade, e como `transactions` é append-only (tg_transactions_immutable), o conserto retroativo exige transações de ajuste. O 'rollback' manual da linha 121 (delete de bets se selections falharem) também confirma que o caminho é não-transacional.


**Fix sugerido:** Rotear o builder pelo RPC place_bet (estendendo-o pra kind='bet_builder' com 1 leg de odd combinada) ou criar um RPC próprio que insira bets + bet_selections + transactions(bet_stake, quando não-free) atomicamente. Backfill: inserir transações bet_stake retroativas pras bets kind='bet_builder' com is_free_bet=false já existentes.


<details><summary>Evidência do verificador</summary>

CONFIRMADO em todos os pontos. (1) `app/(dashboard)/bilhete/builder/actions.ts:69-84` insere a row em `bets` diretamente via `supabase.from("bets").insert(...)` e as selections em :115-117; o arquivo inteiro não contém nenhum insert em `transactions` nem chamada ao RPC `place_bet` (grep por bet_stake/place_bet no arquivo: zero hits). (2) Os caminhos corretos existem e contrastam: `app/(dashboard)/bets/actions.ts:153` e `lib/bet-slip/actions.ts:310` chamam `supabase.rpc("place_bet", ...)`, e `supabase/migrations/0041_place_bet_free_bet.sql:113-119` insere `transactions(kind='bet_stake', direction='out')` para apostas não-free. (3) Não há trigger que crie transactions a partir de bets: `0002_audit_triggers.sql` só cria audit_log (linha 65-66) e enforcement de imutabilidade (`tg_transactions_immutable`, linhas 141-167) — confirmando também que conserto retroativo exige transações de ajuste, não update. (4) Efeito no saldo confirmado: `house_balance` em `0003_balance_snapshots.sql` calcula balance = sum(in)−sum(out) sobre `transactions`; sem `bet_stake`, builder pending só aparece em `pending_stake` (derivado de bets.status='pending'), e ao resolver: `resolve_bet` (0042, sem restrição de kind, chamado de `app/(dashboard)/bets/actions.ts:224`) credita `bet_return` = `expected_return` integral pra won não-free (0042 linhas 76-81, 109-118) → saldo infla pelo stake em cada builder ganho; void credita `total_stake` nunca debitado (mesma inflação); lost não gera transação → a saída real de dinheiro nunca aparece no ledger. (5) O delete manual de rollback em actions.ts:121 existe como descrito. (6) NÃO documentado como conhecido/aceito: grep por "builder"/"bet_stake" em docs/lessons.md e docs/ não retorna nada sobre isso (única menção a bilhete/builder em lessons é a migração getClaims do B22); CLAUDE.md descreve bet_slips/commitSlip (que usa o RPC corretamente) mas nada sobre o builder bypassar o ledger; migration 0039 só adiciona o enum value. Severidade high é honesta: corrupção permanente do ledger financeiro (domínio central da banca) em toda aposta bet_builder não-free, com agravante de append-only dificultar correção — não é critical porque é single-user, escopo restrito ao kind bet_builder, free bets não são afetadas (por design não debitam) e o `pending_stake` mascara parcialmente enquanto pendente.

</details>


### [banca-domain] Caminho UPDATE do /api/ai-reco/apostei muda stake/casa sem ajustar a transação bet_stake

**Onde:** `app/api/ai-reco/apostei/route.ts:227`


No caminho de idempotência (linha 227, `existingBet !== null`), a rota faz UPDATE direto em `bets` mudando `total_stake` (linha 236) e `house_id` (linha 239), mas a transação `bet_stake` criada pelo place_bet original mantém o valor e a casa antigos. O próprio comentário do arquivo afirma 'Permite o Pilot revisar casa/stake sem duplicar (ledger fica coerente)' — mas não fica: `house_balance` (0003) soma transactions, então mudar o stake de 21→50 deixa a banca debitada em 21; mudar a casa deixa o débito preso na casa errada. Como transactions é append-only (tg_transactions_immutable em 0002:141-167), não há como 'editar' a transação — o caminho está estruturalmente errado.


**Fix sugerido:** No UPDATE path, emitir transações de ajuste no ledger: estorno (`in`) do stake antigo na casa antiga + novo `bet_stake` (`out`) na casa/valor novos — idealmente num RPC transacional (ex: `adjust_bet_stake`) pra não deixar ajuste parcial se uma escrita falhar.


<details><summary>Evidência do verificador</summary>

CONFIRMADO. (1) app/api/ai-reco/apostei/route.ts:227-244 — UPDATE direto em bets com total_stake (236) e house_id (239), sem nenhuma escrita em transactions; o comentário nas linhas 41-42 ('ledger fica coerente') é falso. (2) place_bet insere transactions(kind='bet_stake','out', v_total_stake) na casa original (0006_bet_rpcs.sql:132-137; mesma lógica nas re-criações 0027:142 e 0041:119) e nada a ajusta depois. (3) house_balance soma transactions (0003_balance_snapshots.sql:21-41: balance = sum(in)−sum(out) por casa) — mudar stake 21→50 deixa a banca debitada em 21; mudar a casa deixa o débito preso na casa antiga. (4) transactions é append-only via tg_transactions_immutable (0002_audit_triggers.sql:141-167, trigger transactions_block_update) — 'Create a compensating entry instead', exatamente a correção sugerida. (5) Único trigger em bets UPDATE é tg_bets_emit_event (0002:83-135), só auditoria em bet_events, sem compensação. (6) Agravante: resolve_bet (0006:208,241-244) calcula o retorno a partir do total_stake ATUALIZADO e emite bet_return 'in' na house_id ATUALIZADA — a casa nova é creditada com retorno cujo stake nunca foi debitado lá; incoerência permanente nas duas casas. (7) Não está documentado como conhecido/aceito: nenhuma menção em docs/lessons.md (B13 é sobre harness SQL ausente, outra coisa) nem no CLAUDE.md (só menções estruturais à rota). Severidade mantida em high: o caminho buggy É a feature anunciada (revisar casa/stake), corrompe silenciosamente o ledger financeiro append-only e não há auto-correção (snapshots regeneram das mesmas transactions).

</details>


### [reconcilers-ai] Recos duplicadas (e gasto R1 em dobro) pra fixtures entre 24-48h: janela de 48h + cron diário sem nenhum dedup

**Onde:** `scripts/scraper/lib/scraper/ai_recommender_runner.rb:92`


O FIXTURES_QUERY seleciona sims com `kickoff_utc < now() + INTERVAL '48 hours'` e `status='pending'`. O scrape coleta 7 dias à frente (api_list_fetcher.rb:16 `DEFAULT_DAYS_AHEAD = 7`), então existem sims pendentes pra jogos de amanhã e depois; o cron ai-reco roda 1x/dia (10:45 UTC). Toda fixture com KO entre ~24h e ~48h é selecionada em DUAS rodadas consecutivas — e não há NENHUM dedup: o query não tem `NOT EXISTS` contra ai_recommendations, o INSERT (linha 120) não tem ON CONFLICT, e a migration 0022 não tem unique em fixture_id (só índices comuns). Resultado: skip duplicado pra toda a janela de overlap, segunda chamada R1 paga pros candidatos com edge, e — pior — reco 'bet' duplicada que o AiRecommendationReconciler resolve DUAS vezes, dobrando o peso da aposta no ROI/win-rate de /calibracao (lib/calibracao/ai-reco-metrics.ts:72 soma `pl_units` linha a linha, sem dedup por fixture). O spec do runner não cobre dedup (zero hits pra exist/duplic/already).


**Fix sugerido:** Adicionar ao FIXTURES_QUERY `AND NOT EXISTS (SELECT 1 FROM ai_recommendations r WHERE r.fixture_id = s.fixture_id AND r.forced = false)` (preserva on-demand/forced), OU criar partial unique index `(fixture_id) WHERE NOT forced` + ON CONFLICT DO NOTHING no insert. Alternativa mínima: encolher a janela pra 24h (cadência do cron). Em qualquer caso, dedupar as métricas de /calibracao por fixture (último reco) e limpar duplicatas existentes em prod antes de citar ROI.


<details><summary>Evidência do verificador</summary>

CONFIRMADO em código E empiricamente em prod. (1) Código: `scripts/scraper/lib/scraper/ai_recommender_runner.rb` — FIXTURES_QUERY (linhas ~86-101) filtra `s.kickoff_utc < now() + INTERVAL '48 hours' AND s.status = 'pending'` sem nenhum `NOT EXISTS` contra `ai_recommendations`; `RECO_INSERT_SQL` (linhas ~120-137) e o insert de skip não têm `ON CONFLICT`; `classify_fixture` (linhas ~275-350) não checa reco existente em lugar nenhum. `supabase/migrations/0022_ai_recommendations.sql:73-75` tem só índice comum em `fixture_id` (não unique); a 0045 só adiciona a coluna `forced`. `scripts/scraper/lib/scraper/api_list_fetcher.rb:16` confirma `DEFAULT_DAYS_AHEAD = 7` (sims pendentes existem pra 24-48h à frente). Zero specs de dedup (grep exist/duplic/already em spec/ = vazio). (2) Prova empírica em prod (PostgREST read-only, 1000 recos não-forced mais recentes): 308 fixtures com >1 reco, padrão dominante = dias consecutivos (ex.: fixture 19441528 bet em 30/05 E 31/05; 19441532 com 9 linhas 'bet' em 29-31/05). No subconjunto resolved+bet (o que alimenta o ROI): 279 linhas mas só 130 fixtures únicas — 67 fixtures duplicadas, 149 linhas excedentes (~53% das linhas de bet resolvida são duplicata). (3) `lib/calibracao/ai-reco-metrics.ts` (`summarizeAiRecoRoi`, linhas ~60-85, e `brierAiReco`) somam `pl_units`/`units_final` linha a linha sem dedup por fixture — duplicatas dobram/multiplicam o peso e inflam o n usado nas decisões evidência-based (regra B24 depende de contagens de bets). (4) Não está documentado como conhecido/aceito: grep em docs/lessons.md, CLAUDE.md e memória não tem nenhuma menção a recos duplicadas/janela 48h. Efeitos colaterais adicionais confirmados: as chamadas R1 repetidas também consomem o LLM_CALL_BUDGET (50/rodada), reduzindo cobertura de fixtures novas. Único detalhe menor: parte das duplicatas é intra-dia (provável workflow_dispatch manual/on-demand), mas o mecanismo cross-dia da janela 48h + cron diário é exatamente o descrito e domina o padrão. Severidade mantida em high: o sistema inteiro toma decisões (prompt/threshold só por evidência) sobre métricas de /calibracao que hoje têm ~53% de linhas duplicadas no ROI da IA.

</details>


### [tests-ci] Suíte RSpec do scraper (~565 examples) não roda em nenhum workflow de CI

**Onde:** `.github/workflows/ci.yml:12`


O ci.yml só tem os jobs `build` (lint/typecheck/vitest/next build) e `e2e`. `grep -rn rspec .github/workflows/` retorna zero — nenhum dos 7 workflows executa `bundle exec rspec` de scripts/scraper/. O scraper é o pipeline de produção que alimenta simulação, reconcilers e calibração (caminho de dinheiro), e o histórico em docs/lessons.md mostra bugs recorrentes exatamente nele (B16 reconciler nunca cabeado, B19, B29 id-space). Hoje um PR que quebra o orchestrator/reconciler passa o CI inteiro verde e só explode no cron das 10:00 UTC do dia seguinte.


**Fix sugerido:** Adicionar job `scraper` no ci.yml: ruby/setup-ruby com bundler-cache em scripts/scraper + `bundle exec rspec`. Opcionalmente gateado por paths-filter (scripts/scraper/**) pra não custar minutos em PRs só de frontend — mas rodando sempre em push pra main.


<details><summary>Evidência do verificador</summary>

CONFIRMADO. (1) grep -rn "rspec" em .github/workflows/ = zero matches nos 7 workflows; únicos comandos Ruby em CI são execuções de produção (scrape-daily.yml:56 `bundle exec bin/scrape`, ai-reco.yml:71 `bundle exec bin/run_ai_recommender`, closing-odds-capture.yml:49), nunca testes. (2) ci.yml tem só os jobs build e e2e: pnpm lint (l.34), pnpm typecheck (l.37), pnpm test/Vitest (l.40), pnpm build (l.46), playwright (l.100) — nenhum setup-ruby/mise/rspec. (3) A suíte existe: scripts/scraper/spec/ com ~565 examples (CLAUDE.md:164,212), cobrindo orchestrator/reconcilers/sim engine. (4) NÃO documentado como aceito: nenhuma menção em docs/lessons.md ou CLAUDE.md à ausência de RSpec no CI como decisão; CLAUDE.md descreve ci.yml como "lint + typecheck + tests + next build" (Vitest only); RSpec só roda como gate local. (5) Histórico confirma o risco: lessons.md:47 (B19) — bug de reconciler rodou verde em prod corrompendo dados silenciosamente (55 false-loss, ROI −29,8% artefato), classe de defeito que healthchecks não detectam mas specs sim. Ressalva não-refutante: specs de spec/db/ exigem Postgres com roles Supabase (B5, db_helper.rb#ensure_supabase_roles!), então o job de CI sugerido precisa de service container. Severidade mantida em high: scraper é o pipeline do caminho de dinheiro, a própria metodologia do projeto exige suíte completa no CI (Regra 2.8), e o failure mode inclui corrupção silenciosa de dados além de crash no cron.

</details>


### [tests-ci] Deploy pra prod ignora o resultado do CI e roda com --no-frozen-lockfile

**Onde:** `.github/workflows/deploy.yml:3`


deploy.yml dispara em `push: branches: [main]` sem `needs`/`workflow_run` sobre o ci.yml — os dois workflows correm em paralelo, então main vermelha deploya mesmo assim (já aconteceu: memória registra 'CI main vermelha' no episódio do helper E2E stale, com deploys seguindo normalmente). Agrava: o passo install usa `pnpm install --no-frozen-lockfile` (linha 35), cujo próprio comentário diz 'Reconcile by committing the regenerated pnpm-lock.yaml and restoring --frozen' — o lockfile JÁ foi reconciliado (pnpm-lock.yaml:1593 tem @opennextjs/cloudflare@1.19.10), mas o --frozen nunca voltou. Resultado: o build de prod pode resolver versões de deps diferentes das que o CI testou, e chega em produção sem nenhum gate de teste. Viola a própria regra do CLAUDE.md ('nenhum código chega a produção sem passar por todas as camadas de teste').


**Fix sugerido:** Trocar o trigger pra `workflow_run` (workflows: [ci], types: [completed], conclusion == success) ou mover o deploy pra um job com `needs: [build, e2e]` no mesmo workflow; restaurar `--frozen-lockfile` no install do deploy.


<details><summary>Evidência do verificador</summary>

CONFIRMADO. (1) deploy.yml:3-6 dispara em `push: branches: [main]` sem `workflow_run`/`needs` sobre o ci.yml; ci.yml:4-6 dispara no mesmo push — correm em paralelo e nada no deploy consulta o resultado do CI, então main vermelha deploya (episódio real registrado na memória do projeto: 'CI main vermelha' do helper E2E stale com deploys normais). (2) deploy.yml:35 usa `pnpm install --no-frozen-lockfile` e o comentário nas linhas 29-33 manda 'restoring --frozen' após reconciliar o lockfile; a reconciliação JÁ ocorreu (package.json:24 `"@opennextjs/cloudflare": "^1.19.10"` + pnpm-lock.yaml:1593 `'@opennextjs/cloudflare@1.19.10'`), mas o flag nunca voltou — enquanto o CI instala com `--frozen-lockfile` (ci.yml:31,66), o deploy pode resolver versões semver diferentes das testadas. (3) Não está documentado como conhecido/aceito: grep por frozen/deploy.yml/workflow_run em docs/lessons.md retorna vazio; o CLAUDE.md só descreve o deploy.yml sem registrar o gap — o único registro é o comentário inline que trata o --no-frozen como temporário. Viola a regra explícita do CLAUDE.md (pipeline bloqueia merge/produção se teste falhar). Severidade high mantida: dois defeitos compostos, já materializados em prod.

</details>


## 🟡 MEDIUM (30)


### [app-api] POST /api/fixtures/[id]/refresh sem auth gate nem rate limit (escrita via service_role + fan-out upstream)

**Onde:** `app/api/fixtures/[id]/refresh/route.ts:24`


O handler POST ignora a request (`_request`), não tem nenhuma checagem de sessão e usa `createAdminClient()` (bypassa RLS) pra sobrescrever `fixtures.detail_json`/`status`. O middleware exclui `/api/*` do matcher (middleware.ts:10-21), então a rota é 100% pública. Cada chamada anônima dispara ~6 requests ao choistats com o token `ADAMCHOI_API_TOKEN` (`fetchFixtureDetail`, linha 76) — um loop de curl anônimo pode queimar/banir o token upstream e gravar no banco via service_role. O lockdown de 2026-05-27 (commit c5bb3a1) gateou compute/feedback/telemetry mas NÃO esta rota; o comentário em app/api/ai-reco/compute/route.ts:54-55 ('Auth: matches sibling routes (/api/fixtures/[id]/refresh) ... no per-request session gate') está stale — o compute ganhou gate, o refresh não.


**Fix sugerido:** Adicionar o mesmo auth gate dos siblings (createClient().auth.getUser() → 401) antes do lookup, igual a /api/ai-reco/feedback. Opcional: rate limit simples (ex. 1 refresh/fixture/minuto via timestamp em scraped_at — recusar se scraped_at < 60s). Atualizar o comentário stale no compute/route.ts.


<details><summary>Evidência do verificador</summary>

CONFIRMADO em todos os detalhes factuais. (1) `app/api/fixtures/[id]/refresh/route.ts:24-105` — o POST ignora `_request` (linha 25), não tem NENHUMA checagem de sessão (zero `getUser`/`getClaims`/`createClient` no arquivo) e usa `createAdminClient()` (linha 54) pra UPDATE de `fixtures.detail_json/scraped_at/status` (linhas 88-95, comentário do próprio código: "Service-role client bypasses RLS"). (2) `middleware.ts:21` exclui `api` do matcher, com comentário dizendo que route handlers fazem auth "independently when they need auth" — esta não faz. Rota 100% pública. (3) Fan-out de 6 widgets ao choistats com o token confirmado em `lib/fixtures/choistats-api.ts:6,39-46` chamado em `route.ts:76`. (4) `git show c5bb3a1 --stat` confirma que o lockdown de 27/05 tocou só `ai-reco/compute`, `ai-reco/feedback` e `telemetry` — refresh ficou de fora. (5) Comentário stale confirmado: `app/api/ai-reco/compute/route.ts:54-55` diz "Auth: matches sibling routes (/api/fixtures/[id]/refresh) — ... no per-request session gate", mas o compute ganhou gate (linhas ~130-143, retorna 401) e o refresh não. (6) NÃO documentado como conhecido/aceito: grep em CLAUDE.md e docs/lessons.md não acha nenhuma menção à rota refresh ser intencionalmente pública. ATENUANTES que rebaixam de high pra medium: (a) o payload gravado NÃO é controlado pelo atacante — é sempre o JSON fresco do próprio choistats pro fixture existente (404 se id não existe), então não há injeção de dados arbitrários via service_role; (b) o `ADAMCHOI_API_TOKEN` é, segundo o próprio CLAUDE.md ("token público/estático embutido na SPA choistats"), público — qualquer um já pode martelar o choistats com ele diretamente, sem passar por esta rota; o risco marginal de "queimar o token" via este endpoint é menor do que o achado sugere; (c) sem custo LLM/dinheiro. Risco real remanescente: mutação não-autenticada do banco, vetor de abuso de recursos (Worker CF + Supabase + egress podendo flagrar nossos IPs no upstream) e inconsistência com a postura de lockdown — merece o mesmo gate dos siblings, mas é medium, não high.

</details>


### [app-api] Tabela fantasma `banca_snapshots`: a tabela real é `balance_snapshots` — bankroll do recomendador on-demand sempre cai no fallback 1000

**Onde:** `app/api/ai-reco/compute/route.ts:626`


`loadBankroll()` consulta `from("banca_snapshots").select("current_balance")`, mas nenhuma migration cria `banca_snapshots` — a tabela é `balance_snapshots` (0001_init.sql:208) e a coluna é `balance` (não existe `current_balance`). A query SEMPRE erra e o código degrada silenciosamente pra ENV `AI_RECO_BANKROLL` (não documentada nas GH secrets) e depois pro default 1000. Como `kelly_units = f × bankroll / 100` (lib/ai-reco/edge-calculator.ts:150-157), o sizing das recomendações on-demand é calculado sobre uma banca fictícia. O mesmo nome fantasma se repete em app/(dashboard)/fixtures/[id]/page.tsx:500 (unitValue sempre no fallback) e app/(dashboard)/banca/page.tsx:104 (chart sempre pulado). O step 'DB query defensiva' documentado no header da rota (linha 43) é dead code desde sempre.


**Fix sugerido:** Apontar os 3 consumidores pra `balance_snapshots` (order by `snapshot_date desc`, select `balance`; somar por house se quiser banca total) e adicionar teste de regressão que falhe se o nome da tabela divergir do schema (ex. validar contra lib/supabase/types.ts em vez de cast `any`).


<details><summary>Evidência do verificador</summary>

CONFIRMADO. (1) `banca_snapshots` não existe em nenhuma migration nem em lib/supabase/types.ts; a tabela real é `balance_snapshots` (supabase/migrations/0001_init.sql:208) com coluna `balance` (0001_init.sql:213) — `current_balance` não existe. (2) Os 3 consumidores conferem: app/api/ai-reco/compute/route.ts:626 (loadBankroll → query falha → ENV AI_RECO_BANKROLL → DEFAULT_BANKROLL 1000), app/(dashboard)/fixtures/[id]/page.tsx:500 (fetchBankrollSettings, unitValue sempre fallback) e app/(dashboard)/banca/page.tsx:104 (colunas certas, tabela errada → snapshotsQuery.data null → chart de bankroll permanentemente vazio em prod). (3) O nome fantasma vem do próprio plano (docs/superpowers/plans/2026-05-24-ai-recomendador-plan.md:1261) — dead code desde a concepção, como o achado afirma. (4) NÃO está documentado como conhecido/aceito: zero menções a `banca_snapshots` em docs/lessons.md ou CLAUDE.md; os comentários inline ("if exposed", "degrades gracefully") não reconhecem o mismatch de nome. (5) Nuance de severidade: o pipeline batch Ruby (ai_recommender_runner.rb:150-153) por design nunca lê o DB — usa ENV/default 1000, e ai-reco.yml:64 injeta vars.AI_RECO_BANKROLL — então o fallback do on-demand é consistente com o caminho primário do sistema (o sizing em "units" sobre banca-1000 é a convenção geral, não uma distorção exclusiva da rota). O efeito user-visible mais concreto é a feature morta do chart em /banca e o unitValue nunca refletir a banca real. Mantém medium: 3 consumidores quebrados silenciosamente, 1 feature shipped que nunca funcionou, comentários enganosos, app single-user.

</details>


### [app-api] GET /api/calibracao/secondary-metrics público apesar do comentário 'Requires service-role auth' — scan de 5000 rows via admin client por request anônima

**Onde:** `app/api/calibracao/secondary-metrics/route.ts:53`


O header da rota (linha 17) afirma 'Requires service-role auth (server-only)', mas o handler GET não tem nenhum gate — só usa `createAdminClient()` internamente. Com `dynamic = "force-dynamic"` (linha 30) e sem cache-control, cada hit anônimo dispara um SELECT de até 5000 linhas de `fixture_simulations` (incluindo `sim_stats` jsonb, payload pesado cruzando pro Worker — classe B12) + CRPS/Brier em JS. É um vetor barato de carga contra o free tier do Supabase e contra o Worker, além de expor métricas internas sem auth. Ficou fora do lockdown c5bb3a1.


**Fix sugerido:** Adicionar auth gate (getUser/getClaims → 401) como nas rotas ai-reco, e/ou trocar `force-dynamic` por `cache-control: s-maxage` (os dados só mudam no scrape diário). Avaliar tirar `sim_stats` do select — as funções de CRPS deveriam consumir só os escalares actual_*/p_*.


<details><summary>Evidência do verificador</summary>

CONFIRMADO. Evidência: (1) app/api/calibracao/secondary-metrics/route.ts:17 diz "Requires service-role auth (server-only)", mas o handler GET (linha 53) não tem nenhum gate — só `createAdminClient()` na linha 55, que bypassa RLS. (2) middleware.ts:21 exclui explicitamente `api` do matcher ("api/* route handlers — no Supabase Auth round-trip needed... route handlers use createAdminClient or createClient() independently when they need auth") — ou seja, NADA upstream protege a rota; request anônima chega direto ao handler. (3) Linhas 30 (`dynamic = "force-dynamic"`), 59-70 (SELECT de 18 colunas incluindo `sim_stats` jsonb, `.limit(5000)`) e nenhum header de cache na resposta — cada hit anônimo dispara o scan completo + CRPS/Brier em JS no Worker. (4) O lockdown c5bb3a1 (2026-05-27) cobriu só ai-reco/compute, ai-reco/feedback e telemetry — secondary-metrics ficou de fora, exatamente como o achado afirma; e ai-reco/compute/route.ts:136-141 tem o padrão getUser→401 pronto pra replicar. (5) Não está documentado como conhecido/aceito: grep em docs/lessons.md e CLAUDE.md só acha a menção na árvore de diretórios (CLAUDE.md:148). Nuances que não refutam mas calibram: a resposta expõe apenas métricas agregadas (Brier/CRPS/n) — zero dado de usuário; nenhum consumer in-app foi encontrado (rota aparentemente órfã, mas deployada e pública); e a sugestão de "tirar sim_stats do select" é parcialmente errada — cornersCrps/cardsCrps/sotCrps consomem os percentis de sim_stats (lib/calibracao/sim-reliability.ts:277-398), então o jsonb é necessário pro cálculo (o fix correto é auth gate + cache, não trocar o select). Severidade medium se sustenta: vetor barato de carga não-autenticado contra Supabase free tier + contradição direta com a intenção documentada da rota, mas sem vazamento de dado sensível.

</details>


### [banca-domain] Free bets distorcem P/L nas views de ROI e no stop-loss (total_stake fantasma)

**Onde:** `supabase/migrations/0014_banca_loop.sql:148`


As views `roi_by_house_view`/`roi_by_period_view` computam pl = sum(actual_return) − sum(total_stake) sobre TODAS as bets resolvidas (0014:148-149, 196-197), mas free bets (0040-0042) não debitam stake e, quando ganham, retornam só o lucro (`stake*(odds-1)`, 0042:70). Free bet ganha: view mostra pl = lucro − stake (subestimado pelo stake); free bet perdida: view mostra −stake quando o P/L real em dinheiro é 0 (perda fantasma). O mesmo erro existe em lib/disciplina/disciplina-guard.ts:95-97 (plToday = totalReturn − totalStake sem filtrar is_free_bet), onde uma free bet perdida pode disparar stop-loss sem perda real de dinheiro. As views são de 0014 e nunca foram atualizadas quando is_free_bet entrou (0040).


**Fix sugerido:** Nova migration recriando as views com stake efetivo: `sum(total_stake) filter (where not is_free_bet)` (e pl de free bet won = actual_return puro); no disciplina-guard, excluir total_stake das free bets no cálculo do plToday. Decidir e documentar se yield deve ou não contar stake de free bet.


<details><summary>Evidência do verificador</summary>

CONFIRMADO em todos os pontos. (1) Views: `supabase/migrations/0014_banca_loop.sql` computa `pl = resolved_returned - resolved_staked` somando `total_stake` de TODAS as bets resolvidas sem filtro de `is_free_bet` (CTE `bet_agg`: `sum(b.total_stake) filter (where b.status <> 'pending')`, e o mesmo padrão nas CTEs `monthly`/`rolling_30d` da `roi_by_period_view`). Grep confirma que `roi_by_house_view`/`roi_by_period_view` só existem em 0014 — nenhuma migration posterior (0040-0050) as recriou após `is_free_bet` entrar. (2) Semântica free bet: `0040_bets_is_free_bet.sql` documenta "stake não desconta da banca"; `0042_resolve_bet_free_bet.sql` (branch `ELSIF v_bet.is_free_bet`) define won → `actual_return = stake*(odds-1)`, lost/void → 0. Logo free bet ganha aparece nas views como pl = lucro − stake (subestimado em exatamente o stake fantasma) e free bet perdida como pl = −stake quando o P/L real em dinheiro é 0 (e void idem: view mostra −stake). (3) Stop-loss: `lib/disciplina/disciplina-guard.ts:94-98` — o select (linha 72) nem busca `is_free_bet`; `resolvedBets` filtra só `actual_return !== null` (free bet perdida tem actual_return=0, é incluída), `plToday = totalReturn - totalStake` (linhas 95-97), então free bet perdida contribui −stake e pode disparar o stop-loss diário (linha 100) sem perda real. (4) Não está documentado como conhecido/aceito: `docs/lessons.md` não menciona free bet; CLAUDE.md (Data model 0040-0042) só descreve a semântica do RPC, não a distorção nas views/guard. Severidade medium é honesta: app single-user, free bets raras, efeito é display de ROI/yield distorcido + possível falso-positivo de fricção (stop-loss bloqueia aposta, não perde dinheiro) — não é perda financeira nem corrupção de ledger (transactions estão corretas).

</details>


### [banca-domain] Thesis do thesis-gate é coletada na UI mas silenciosamente descartada (nunca persiste)

**Onde:** `app/(dashboard)/bets/actions.ts:140`


placeBetAction envia `thesis` no payload do RPC (linha 140), mas a versão vigente do place_bet (0041_place_bet_free_bet.sql) não lê nem insere o campo — o INSERT em bets (0041:82-91) não inclui `thesis`. Pior: o apostei-modal (app/(dashboard)/fixtures/[id]/_components/apostei-modal.tsx:144-158) EXIGE thesis ≥10 chars quando o gate dispara e a envia no body, mas o bodySchema de /api/ai-reco/apostei (route.ts:55-62) nem tem o campo — Zod descarta. Resultado: a fricção ética do thesis gate (migration 0033) força o usuário a escrever a tese e joga o texto fora em 2 dos 3 caminhos de aposta (só o builder persiste, builder/actions.ts:80). Feature de disciplina quebrada em produção sem nenhum erro visível.


**Fix sugerido:** Migration recriando place_bet lendo `p_payload->>'thesis'` e inserindo em bets.thesis; adicionar `thesis` ao bodySchema do /api/ai-reco/apostei e propagá-la (no INSERT path via payload do RPC; no UPDATE path via update direto).


<details><summary>Evidência do verificador</summary>

CONFIRMADO em todos os pontos centrais. (1) RPC ignora thesis: supabase/migrations/0041_place_bet_free_bet.sql é a versão vigente de place_bet (grep em todas as migrations: só 0006/0027/0040/0041 mencionam place_bet; 0042-0050 não a recriam). O corpo da função (0041:17-47) declara/lê house_id, kind, total_stake, placed_at, note, tags, selections, is_free_bet — nunca p_payload->>'thesis' — e o INSERT em bets (0041:82-91) lista colunas id..is_free_bet sem thesis. Enquanto isso app/(dashboard)/bets/actions.ts:140 envia `thesis: data.thesis ? data.thesis : null` no payload do RPC (linha 153 chama supabase.rpc("place_bet")). Nuance honesta: o form desse caminho (app/(dashboard)/bets/new/form.tsx) NÃO tem input de thesis (grep vazio), então ali é fiação morta, não texto do usuário descartado. (2) Caminho apostei — o pior: apostei-modal.tsx:144-147 BLOQUEIA submit se thesisRequired e thesis<10 chars, e linha 158 envia `thesis: thesis.trim() || undefined` no body do POST /api/ai-reco/apostei; mas o bodySchema da rota (app/api/ai-reco/apostei/route.ts:52-59) só tem aiRecommendationId/houseId/stake/odd/market/side — sem thesis — e z.object() default faz strip de chaves desconhecidas; nem o UPDATE path (route.ts:233-241) nem o placeBetPayload (route.ts:274-291) propagam thesis. O usuário é forçado a escrever a tese e ela é jogada fora sem erro. (3) Só o builder persiste: app/(dashboard)/bilhete/builder/actions.ts:80 faz INSERT direto em bets com `thesis: data.thesis ?? null`. (4) Não documentado como conhecido: zero menções a thesis em docs/lessons.md; CLAUDE.md só cita bets.thesis como coluna existente (linha 246) e o thesis gate como feature (linha 245). A coluna bets.thesis existe (0033_bets_thesis.sql:5) e seu COMMENT diz que guarda a tese quando o gate dispara — exatamente o que não acontece nos caminhos RPC. Severidade medium mantida: feature de disciplina/auditoria quebrada silenciosamente no caminho principal de aposta via reco IA (apostei-modal), sem impacto financeiro nem erro visível.

</details>


### [banca-domain] Stop-loss e cooldown só enxergam bets PLACED hoje — derrota de bet de ontem não conta

**Onde:** `lib/disciplina/disciplina-guard.ts:74`


A query única filtra `gte("placed_at", todayStart)` (linha 74) e alimenta os 3 checks. O cooldown_after_loss_min (linhas 124-143) procura o último loss dentro desse conjunto: uma bet apostada ontem à noite e resolvida como 'lost' há 5 minutos NÃO dispara o cooldown — cenário comum (jogos noturnos resolvidos no dia seguinte). O stop_loss_daily_pct (linhas 94-100) tem o mesmo furo: o P/L 'de hoje' ignora perdas resolvidas hoje de bets de ontem, então o drawdown real do dia pode ultrapassar o limite sem bloquear. Bônus: o resetAt usa `setUTCHours(27,...)` (linha 103), que devolve a meia-noite BRT do dia seguinte ao calendário UTC — entre 00:00-03:00 UTC isso aponta 24h à frente do reset real (display only).


**Fix sugerido:** Pro cooldown e pro P/L diário, consultar por `resolved_at >= todayStart` (independente do placed_at); manter `placed_at` só pro max_bets_per_day. Corrigir resetAt reutilizando todayBrtStart()+24h.


<details><summary>Evidência do verificador</summary>

CONFIRMADO em lib/disciplina/disciplina-guard.ts. (1) Linha 74: query única `.gte("placed_at", todayStart)` alimenta os 3 checks via `bets` (linha 77). (2) Cooldown (linhas 124-143): filtra `lostBets` a partir desse conjunto — bet apostada ontem (placed_at < todayStart) e resolvida 'lost' há 5 min fica fora do array, logo `minutesSinceLoss` nunca é avaliado e o cooldown não dispara; cenário real e comum (jogo noturno resolvido de manhã). O cooldown é semanticamente sobre recência da DERROTA (usa resolved_at na linha 130), então o filtro por placed_at é incoerente com a própria lógica. (3) Stop-loss (linhas 94-100): plToday soma só bets de hoje com actual_return != null — perda resolvida hoje de bet de ontem não entra no drawdown, contradizendo o doc-comment "PL_hoje" (linha 7). (4) resetAt linha 103: `setUTCHours(27,0,0,0)` rola pro dia UTC seguinte às 03:00; entre 00:00-03:00 UTC o próximo 00:00 BRT é 03:00 UTC do MESMO dia UTC, então o valor exibido fica 24h à frente — display-only, a `reason` é genérica. Guard está WIRED nos 3 caminhos de produção (bets/actions.ts, bilhete/builder/actions.ts, bet-slip/actions.ts). Testes (lib/disciplina/__tests__/disciplina-guard.test.ts) só cobrem bets com placed_at=hoje — o cenário cross-day não é testado nem documentado como aceito em docs/lessons.md/CLAUDE.md/ADRs. Severidade mantida em medium: é feature de fricção comportamental opt-in (single-user), não perda financeira direta nem segurança, mas o furo derrota o propósito do cooldown num cenário frequente.

</details>


### [banca-domain] commitSlip não confere o update de status — slip pode ficar draft com bet real criada (dupla aposta)

**Onde:** `lib/bet-slip/actions.ts:326`


Após o place_bet RPC suceder (linha 310, débito real no ledger), o update `{status:'committed', bet_id}` (linhas 326-330) tem o resultado totalmente ignorado — nenhum check de error. Se esse update falhar (rede, RLS, timeout do Worker), o slip permanece 'draft' com uma bet+transação reais já gravadas; o usuário (vendo o bilhete ainda aberto) clica confirmar de novo e o commitSlip cria uma SEGUNDA bet com novo débito de stake — não há nenhum guard de idempotência (ex.: slip.bet_id pré-existente) antes de chamar o RPC de novo. Mesma classe de fire-and-forget em Workers que já mordeu o projeto (Wave T, commit 1aba0ee).


**Fix sugerido:** Checar o erro do update e, se falhar, ainda retornar o betId com aviso; antes de chamar place_bet, abortar se o slip já tiver bet_id preenchido (setar bet_id ANTES de mudar status, ou num único update verificado). Ideal: mover commit do slip pra dentro de um RPC transacional.


<details><summary>Evidência do verificador</summary>

CONFIRMADO. lib/bet-slip/actions.ts:326-330 — o update {status:'committed', bet_id} após o place_bet RPC (linha 310, débito real) tem o resultado ignorado (sem destructure de error), enquanto cancelSlip no mesmo arquivo (linhas 352-358) checa o erro — padrão omitido só no caminho que move dinheiro. O fetch do slip (linhas 263-269) filtra apenas .eq("status","draft") e não verifica slip.bet_id pré-existente; nenhum guard de idempotência antes do RPC. supabase/migrations/0032_bet_slips.sql confirma que não há constraint no schema que impeça re-commit (bet_id nullable, sem UNIQUE). Cenário do achado é exato: update falho ⇒ slip continua draft com bet+transação reais ⇒ retry cria segunda bet com novo débito. Não está documentado como conhecido/aceito: grep em docs/lessons.md, CLAUDE.md e docs/ não acha menção a esse gap em commitSlip (a lição Wave T/1aba0ee era do endpoint de telemetria, código diferente). Mitigantes: exige falha parcial + retry humano, app single-user — severidade medium se sustenta (impacto é dinheiro real duplicado no ledger, probabilidade baixa).

</details>


### [calibracao] p-valor do bootstrap inverte de direção quando o challenger é pior — número 'significativo' exibido com champion ganhando

**Onde:** `lib/calibracao/model-comparison.ts:68`


`const pChallengerBetter = meanDelta > 0 ? le0 / iterations : 1 - le0 / iterations;` — quando meanDelta < 0 (challenger pior), le0 (fração de reamostras ≤ 0) é grande, então o código devolve `1 − le0` ≈ pequeno. Ou seja: quanto MAIS decisivamente o champion ganha, MENOR o 'p de challenger melhor' — o oposto da semântica documentada no próprio arquivo (linha 34: "p-valor unilateral de 'challenger NÃO é melhor'") e do próprio teste (model-comparison.test.ts:74 monta à mão `meanDelta: -0.05 … pChallengerBetter: 0.99`, valor que a implementação real jamais produziria). O veredito em si está protegido (modelVerdict:98 exige meanDelta > 0 pra `challenger_better`, e `champion_better` usa ciHi < 0), mas o `pDeflated` derivado desse número é exibido como "p deflacionado" no card da arena (components/calibracao/champion-challenger-card.tsx:231 e compare-models.ts:232) — num cenário de champion claramente melhor, o painel mostraria p<.001 ao lado do badge, induzindo leitura errada num painel de decisão de promoção de modelo.


**Fix sugerido:** Trocar por `const pChallengerBetter = le0 / iterations;` (monotônico: pequeno ⇔ evidência pró-challenger, grande ⇔ pró-champion), opcionalmente com correção `(le0 + 1) / (iterations + 1)` pra nunca dar 0 exato. Adicionar teste que passa deltas consistentemente NEGATIVOS por `pairedBootstrap` (não objeto montado à mão) e espera p próximo de 1.


<details><summary>Evidência do verificador</summary>

CONFIRMADO. (1) lib/calibracao/model-comparison.ts:68 contém exatamente `meanDelta > 0 ? le0 / iterations : 1 - le0 / iterations` — com champion decisivamente melhor (todos os deltas<0), le0≈iterations e o código devolve ≈0; quanto mais o champion ganha, menor o "p de challenger melhor". Não-monotônico como alegado. (2) Contradiz o contrato documentado no próprio arquivo: linhas 34 e 40 definem p = "fração de reamostras com média ≤ 0" incondicionalmente. (3) O teste mascara o bug: model-comparison.test.ts:74 monta à mão `pChallengerBetter: 0.99` com meanDelta −0.05 e CI todo <0 — pairedBootstrap real produziria ≈0 nesse cenário; nenhum teste passa deltas consistentemente negativos pela função real. (4) Veredito protegido como o achado admite (model-comparison.ts:98-99 exige meanDelta>0 / ciHi<0), mas o número inverso É exibido: champion-challenger-card.tsx:231 ("p deflacionado", sem rótulo de direção) e compare-models.ts:232/247. (5) NÃO está documentado como conhecido: docs/lessons.md B34-B37 cobrem a arena sem mencionar isso; pior, o B37 já registra "p=0.258" que é o valor invertido (semântica documentada daria 0.742) — a ambiguidade já vazou pras lições. Severidade: o badge correto fica ao lado do número e nenhuma decisão errada foi tomada até hoje, mas é violação de contrato num primitivo estatístico do painel de promoção de modelo, mascarada por teste hand-built, e qualquer consumidor futuro de pChallengerBetter herda a semântica invertida — medium se sustenta.

</details>


### [calibracao] Paginação .range() sem tiebreaker único — ordem não-determinística pode duplicar/perder linhas entre páginas da arena

**Onde:** `scripts/calibracao/compare-models.ts:66`


Quatro leitores paginam com `.range()` ordenando por coluna NÃO-única: compare-models.ts:66 e app/(dashboard)/calibracao/page.tsx:556 ordenam `model_predictions` só por `fixture_id` (cada fixture tem até 6 markets × N modelos → dezenas de linhas empatadas na chave de ordenação); seed-model-predictions.ts:341 ordena `fixture_simulations` por `fixture_id` (múltiplas re-sims por jogo); seed-challenger-cards-cmp.ts:86 e fit-scoreline-cal.ts:60 ordenam por `actual_resolved_at`, que o reconciler seta em batch diário com `now()` (simulation_reconciler.rb:133) — timestamps idênticos/quase-idênticos pra todo o lote do dia. Sem tiebreaker único, o Postgres não garante ordem estável entre requests → linhas empatadas podem trocar de página entre uma chamada e a seguinte, duplicando ou omitindo registros. Com model_predictions já em ~7k linhas (7+ páginas), deltas duplicados inflam o n do bootstrap pareado e pares omitidos somem da comparação — corrompe silenciosamente exatamente a métrica que decide promoção de modelo.


**Fix sugerido:** Adicionar tiebreaker único em todas as paginações: `.order("fixture_id").order("market").order("model_version")` (ou `.order("id")`) em model_predictions, e `.order("actual_resolved_at").order("id")` (ou fixture_id) nas leituras de fixture_simulations.


<details><summary>Evidência do verificador</summary>

CONFIRMADO no núcleo, com duas ressalvas que atenuam parte do achado. Evidência: (1) compare-models.ts:60-74 pagina model_predictions com `.order("fixture_id")` + `.range()` sem tiebreaker; a migration 0049_model_predictions.sql:38 define `unique (fixture_id, model_version, market)` — ou seja, cada fixture_id tem por construção múltiplas linhas (modelos × mercados), empates na chave de ordenação são garantidos, e com champion v7 semeado pra todas as sims resolvidas × mercados a tabela passa de 1000 linhas (paginação real ocorre). PostgREST/Postgres não garantem ordem estável de empates entre requests, logo linha empatada pode trocar de página → duplicar/omitir. O efeito descrito procede: em computeDeltas (compare-models.ts:116-137) o champion vira Map (duplicata absorvida), mas chalRows é array — challenger duplicado empurra delta duplicado (infla n do bootstrap) e linha omitida some do pareamento; é exatamente a métrica que decide promoção. (2) app/(dashboard)/calibracao/page.tsx:556-557 — mesmo padrão, mesma tabela. (3) fit-scoreline-cal.ts:60-61 ordena fixture_simulations por actual_resolved_at; simulation_reconciler.rb:133 seta `actual_resolved_at = now()` num UPDATE em lote (now() é por-transação → timestamp IDÊNTICO pra todo o lote do dia) — empates massivos, e fit-scoreline-cal não deduplica (linhas vão direto pro array). (4) seed-challenger-cards-cmp.ts:86-87 tem os mesmos empates, MAS deduplica por fixture_id (seenR/seenU, linhas 96-113) — duplicatas mitigadas, omissões ainda possíveis. RESSALVA que refuta um sub-claim: a justificativa "múltiplas re-sims por jogo" pra seed-model-predictions.ts:341 está ERRADA — 0018_fixture_simulations.sql:55-81 mostra que re-sims fazem UPSERT dedupado (unique parcial em (fixture_id, kickoff_utc)); empates em fixture_id ali só ocorrem em reschedule de kickoff ou fixture_id NULL (raros). Não está documentado como conhecido/aceito em docs/lessons.md nem CLAUDE.md (grep por pagination/tiebreak/.order não acha nada relacionado). Severidade: medium é honesto — bug latente/intermitente (exige reordenação de empates entre requests consecutivos, mais provável sob escrita concorrente dos crons), mas corrompe silenciosamente a métrica de decisão da arena e o fix é trivial (.order secundário único).

</details>


### [frontend-rsc] Tabela fantasma `banca_snapshots`: gráfico de bankroll morto e stake sugerido sempre no fallback de R$1000

**Onde:** `app/(dashboard)/banca/page.tsx:104`


Três caminhos de produção consultam `banca_snapshots`, relação que NUNCA existiu no schema: as migrations criam `balance_snapshots` (supabase/migrations/0001_init.sql:208) e o `lib/supabase/types.ts` gerado de prod só contém `balance_snapshots` — confirmando que a tabela não existe no banco. Consumidores: (1) `app/(dashboard)/banca/page.tsx:104` — a seção "bankroll ao longo do tempo (90d)" degrada silenciosamente (query erra, `snapshotsQuery.data=null`, `bankrollChartData.length<=1`) e o BankrollChart NUNCA renderiza, apesar de o CLAUDE.md afirmar que os snapshots são regenerados diariamente (o dado existe, só o nome está errado); (2) `app/(dashboard)/fixtures/[id]/page.tsx:500` — `fetchBankrollSettings` seleciona `current_balance`/`created_at` (colunas que tampouco existem em `balance_snapshots`) e SEMPRE cai no fallback `DEFAULT_BANKROLL=1000` (lib/ai-reco/stake-calculator.ts:19); o comentário em buildPanels (linha 544) diz "stake default usando banca real do Pilot (fix #1)" — falso na prática: o stake sugerido no modal Apostei é calculado sobre uma banca fictícia de R$1000, não a real; (3) mesma query em `app/api/ai-reco/compute/route.ts:626`. Feature shippada porém estruturalmente morta — classe B16/B25 (construído-mas-nunca-fiado), não documentada em docs/lessons.md.


**Fix sugerido:** Em `/banca`, trocar a fonte do gráfico para a view `daily_pl_view` (já agrega `sum(balance)` por `snapshot_date` em 0004_views.sql — `balance_snapshots` cru tem 1 linha por casa/dia e duplicaria pontos). Em `fetchBankrollSettings` (fixtures/[id] e ai-reco/compute), ler `daily_pl_view.total_balance` da data mais recente (ou somar `balance_snapshots` do último `snapshot_date`). Adicionar teste de fiação que falhe quando o nome da relação não existir no `Database` type gerado (o cast `as any` foi o que escondeu o erro do typecheck).


<details><summary>Evidência do verificador</summary>

CONFIRMADO. (1) `banca_snapshots` nunca existiu: migrations criam só `balance_snapshots` (supabase/migrations/0001_init.sql:208); grep por `banca_snapshots` em supabase/, lib/supabase/types.ts, docs/lessons.md e CLAUDE.md = zero hits. Origem do nome fantasma: docs/superpowers/plans/2026-05-24-ai-recomendador-plan.md:1261. (2) Os 3 consumidores conferem: app/(dashboard)/banca/page.tsx:104 (via cast `sbAny = supabase as any`, linha 79, que esconde do typecheck) → erro PostgREST → data=null → carryForwardSeries([]) retorna [] (lib/banca/metrics.ts:88) → gate `bankrollChartData.length > 1` (page.tsx:174) → BankrollChart NUNCA renderiza; app/(dashboard)/fixtures/[id]/page.tsx:500 (`fetchBankrollSettings` seleciona `current_balance`, coluna que nem em balance_snapshots existe — lá é `balance`) → sempre fallback DEFAULT_BANKROLL=1000 (lib/ai-reco/stake-calculator.ts:19), tornando falso o comentário "banca real do Pilot" na linha 544; app/api/ai-reco/compute/route.ts:626 idem, e o fallback env AI_RECO_BANKROLL só está fiado no ai-reco.yml (cron Ruby), ausente de wrangler.jsonc/deploy.yml/.env.example → Worker cai em 1000. (3) Não documentado como conhecido/aceito em docs/lessons.md nem CLAUDE.md. Ajuste de severidade high→medium: sem crash/corrupção/segurança; impacto = gráfico morto silenciosamente + PREFILL de stake (editável pelo Pilot) sobre banca fictícia de R$1000 — classe B16/B25 real, mas dano em nível de sugestão num app single-user. Detalhe menor do achado levemente impreciso: `created_at` EXISTE em balance_snapshots (0001_init.sql:219); só `current_balance` não existe.

</details>


### [frontend-rsc] /calibracao: ~12 round-trips de DB sequenciais numa página force-dynamic (comentário mente "queries paralelas")

**Onde:** `app/(dashboard)/calibracao/page.tsx:184`


A página inteira é uma cadeia de awaits sequenciais independentes: a IIFE de Pipeline Health (linhas 184-284) faz 5 awaits um após o outro — apesar do comentário na linha 183 dizer "queries paralelas, degradam graciosamente" — e depois seguem, em série, `ai_predictions` (:289), `fixture_simulations` limit 2000 (:308), `model_calibration` (:359), `league_parameters` (:384), `ai_recommendations` limit 2000 (:426), `bets` com JOIN (:454), o loop paginado de `model_predictions` (:551) e `closing_odds` limit 2000 (:625). Nenhuma query depende do resultado da outra (exceto o `cutoff` do recoPendingPastKickoff, que depende só de `lastReconciledAt`). Com `export const dynamic = "force-dynamic"` (:57) e Worker CF → Supabase sa-east-1 (~80-150ms RTT cada), são ~1.2-1.8s de wall só de I/O serializado por page view — a mesma classe do follow-up wall-lento documentado em B23, mas para /calibracao, que NÃO está documentada.


**Fix sugerido:** Agrupar todas as leituras independentes num único `Promise.all` (cada bloco já degrada gracioso por try/catch, então o paralelismo é seguro); encadear apenas `recoPendingPastKickoff` após `lastReconciledAt`. Corrigir/remover o comentário "queries paralelas". Ganho esperado: ~10x menos round-trips seriais (~1.5s → ~200ms de I/O).


<details><summary>Evidência do verificador</summary>

CONFIRMADO lendo app/(dashboard)/calibracao/page.tsx. (1) Linha 57: `export const dynamic = "force-dynamic"`. (2) Linha 183: comentário "── Pipeline Health: queries paralelas, degradam graciosamente ──" seguido de uma IIFE `await (async ...)` (linha 184) que faz 5 awaits estritamente sequenciais: fixtures.scraped_at (:193), count fixture_simulations (:211), ai_recommendations último reconcile (:225), count pending (:252) e top ligas (:265) — o comentário de fato mente sobre paralelismo. (3) Depois da IIFE, todas as demais queries são awaits sequenciais no topo do componente: ai_predictions limit 500 (:289), fixture_simulations limit 2000 (:308), model_calibration (:359), league_parameters (:384), ai_recommendations limit 2000 (:426), bets com JOIN ai_recommendations (:454), loop paginado de model_predictions com `await` dentro de while (:551), closing_odds limit 2000 (:625). Nenhum `Promise.all` existe no arquivo. (4) Única dependência real entre queries é o `cutoff` (:250-251), que deriva de `lastReconciledAt` (:233) — exatamente como o achado afirma; todo o resto é independente e cada bloco já degrada gracioso por try/catch próprio, então o paralelismo sugerido é seguro. (5) Não está documentado como conhecido/aceito para /calibracao: docs/lessons.md B23 (linha 63) registra o follow-up "wall-lento: 6 awaits sequenciais → Promise.all" apenas para /fixtures/[id]; nenhuma menção a /calibracao nessa classe em lessons.md nem no CLAUDE.md (B40 menciona o page.tsx de /calibracao só pra validar o matching do CLV, não perf). Severidade: mantida medium — é perf-only numa página single-user, sem bug de correção, mas é força-dynamic com ~12-13 round-trips seriais Worker→Supabase (a estimativa de ~1.2-1.8s de I/O serializado é plausível com RTT sa-east-1), é a mesma classe que o próprio projeto considerou digna de fix em B23, e o comentário enganoso na linha 183 agrava (afirma um paralelismo que não existe).

</details>


### [frontend-rsc] /calibracao pagina TODA a `model_predictions` (sem janela) + roda bootstrap de 2000 iterações no request path do Worker

**Onde:** `app/(dashboard)/calibracao/page.tsx:543`


O bloco da arena (linhas 543-613) baixa TODAS as predições resolvidas via loop paginado de 1000 em 1000 (`.range(from, from+999)`, sem cutoff de data nem cap de páginas) — o seed do champion sozinho já são 6944 linhas (lição B35), ou seja ~7+ round-trips sequenciais extras por page view, e a tabela é forward-only (cresce todo dia com champion + cada challenger × mercado, por design do ADR-011). Em cima disso, monta `champMap` em memória e roda `pairedBootstrap` com 2000 reamostragens × n deltas POR challenger (lib/calibracao/model-comparison.ts:50) dentro do render do Server Component. Hoje o CPU é pequeno (n=300), mas o crescimento é não-limitado e o Worker Free tem 10ms de CPU/request — exatamente a classe do exceededCpu/1102 do B23, que custou um outage. O try/catch só protege contra erro, não contra lentidão/CPU.


**Fix sugerido:** Curto prazo: limitar a leitura a uma janela (ex.: `resolved_at >= now()-interval '90 days'`) e/ou cap de páginas com aviso no card. Estrutural: mover o agregado (mean log-loss, deltas, veredito bootstrap) para fora do request path — computar no cron semanal de calibração (que já existe) e persistir o resumo numa linha de `model_calibration`/tabela pequena, deixando a página ler só escalares (mesmo padrão do fixture_badges_view/B14).


<details><summary>Evidência do verificador</summary>

CONFIRMADO. (1) page.tsx:543-563: loop `while (keepFetching)` paginando model_predictions de 1000 em 1000 com `.range()`, sem cutoff de data nem cap de páginas — round-trips sequenciais (await dependente). (2) page.tsx:57 `export const dynamic = "force-dynamic"` ⇒ roda em toda request, sem cache. (3) page.tsx:596 chama `pairedBootstrap(deltas, {seed:42})` por challenger dentro do render do RSC; lib/calibracao/model-comparison.ts:50 confirma default 2000 iterações. (4) docs/lessons.md B35 confirma seed do champion = 6944 linhas ⇒ ~7-8 round-trips hoje. (5) ADR-011 (docs/adrs/011-...md:20) declara "um INSERT por modelo×mercado no scrape" — crescimento forward-only é o design; nuance: a escrita FORWARD no scraper ainda é pendência (grep model_predictions no scraper Ruby = vazio; só scripts/calibracao/seed-*.ts escrevem hoje), então o crescimento diário está latente, não ativo. (6) try/catch (page.tsx:609-613) só captura erro, não CPU/lentidão. (7) NÃO documentado como aceito: lessons B34-B38 e CLAUDE.md não mencionam esse custo; ao contrário, a regra crítica do CLAUDE.md ("payload pesado/JSON só escalar pro Worker", B12/B14) e o precedente B23 (Error 1102 exceededCpu) tornam isso violação de regra explícita do projeto. Severidade medium honesta: risco real (classe 1102 já causou outage) mas latente — n atual pequeno e crescimento diário ainda não fiado.

</details>


### [infra-workflows] Deploy de produção instala com --no-frozen-lockfile (workaround stale, ships deps não testadas)

**Onde:** `.github/workflows/deploy.yml:35`


O step de install do deploy roda `pnpm install --no-frozen-lockfile`. O comentário no próprio workflow (linhas 29-34) diz que foi um hotfix temporário de 2026-05-16 (commit f78e46d, bump do @opennextjs/cloudflare quando o lockfile não pôde ser transferido) e manda 'Reconcile by committing the regenerated pnpm-lock.yaml and restoring --frozen'. A reconciliação já aconteceu: pnpm-lock.yaml foi regenerado e commitado em 2026-05-29 junto com o package.json e contém `@opennextjs/cloudflare@1.19.10` (pnpm-lock.yaml:1593) — tanto que o CI roda `--frozen-lockfile` (ci.yml:30) e passa verde. Mas o deploy nunca voltou pro frozen. Consequência real: cada deploy re-resolve os ranges semver na hora do build, podendo embarcar versões de dependência que o CI nunca testou (CI testa o lockfile, deploy ignora) e tornando o build de produção não-reproduzível; também expõe o Worker a um patch release malicioso publicado entre o CI e o deploy.


**Fix sugerido:** Trocar pra `pnpm install --frozen-lockfile` em deploy.yml:35 (o lockfile já está em sync — o CI prova). Remover o comentário stale das linhas 29-34.


<details><summary>Evidência do verificador</summary>

CONFIRMADO. (1) deploy.yml:35 roda `pnpm install --no-frozen-lockfile` com comentário stale nas linhas 29-34 mandando "restoring --frozen" após reconciliar o lockfile. (2) A reconciliação já ocorreu: pnpm-lock.yaml:1593 tem '@opennextjs/cloudflare@1.19.10' casando com o range ^1.19.10 de package.json:24, e ambos foram modificados pela última vez no mesmo commit (08868da, 2026-05-29) — em sync. (3) ci.yml:31 e ci.yml:66 usam --frozen-lockfile e o run mais recente do CI na main (2026-06-10) é success, provando que frozen passa. (4) Zero menções a frozen/lockfile em docs/lessons.md e CLAUDE.md — não é dívida documentada/aceita. Efeito descrito (deploy re-resolve ranges caret e pode embarcar deps que o CI nunca testou; build não-reproduzível; exposição a patch release malicioso) procede. Severidade ajustada de high→medium: o dano depende de evento externo (release quebrado/comprometido dentro dos ranges semver entre lockfile e deploy), não é vulnerabilidade direta nem quebra atual — mas é o caminho único de deploy de prod e o fix é trivial (uma linha).

</details>


### [infra-workflows] Deploy pra produção não é gated pelo CI — push direto na main deploya em paralelo com os testes

**Onde:** `.github/workflows/deploy.yml:3-5`


`deploy.yml` dispara em `push: branches: [main]` sem nenhum `needs`/`workflow_run` ligando ao `ci.yml` (que dispara no mesmo push). Os dois rodam em paralelo: se lint/typecheck/testes/E2E falharem, o deploy já foi (o único gate implícito é o `pnpm cf:build` compilar). O histórico do repo tem commits de hotfix direto na main (ex.: f78e46d, fa7cd10), então o caminho 'push sem PR → deploy sem teste' é real, não teórico. Isso contraria a regra do próprio projeto ('o pipeline deve ser o guardião final: nenhum código chega a produção sem passar por todas as camadas de teste').


**Fix sugerido:** Encadear: trocar o trigger do deploy pra `workflow_run: workflows: [ci], types: [completed], branches: [main]` com `if: github.event.workflow_run.conclusion == 'success'` (mantendo `workflow_dispatch` pra emergência), ou mover o job deploy pro ci.yml com `needs: [build, e2e]` + `if: github.ref == 'refs/heads/main'`.


<details><summary>Evidência do verificador</summary>

CONFIRMADO. (1) `.github/workflows/deploy.yml:3-6` dispara em `push: branches: [main]` + `workflow_dispatch`, sem `needs`, sem `workflow_run` e sem qualquer referência ao CI; os jobs do deploy (linhas 12-48) só fazem install → `pnpm cf:build` → `wrangler deploy`. (2) `.github/workflows/ci.yml:3-6` dispara no MESMO evento (`push: branches: [main]`), então os dois rodam em paralelo — se `pnpm lint`/`pnpm typecheck`/`pnpm test`/E2E falharem no ci.yml, o deploy já foi pra produção. (3) Os commits citados existem e são mesmo hotfixes direto na main: `f78e46d` "fix(infra): bump @opennextjs/cloudflare ^1.19.10" e `fa7cd10` "fix(ci): bump runner Node 20→22" — o caminho push-sem-PR→deploy é real. (4) Não está documentado como aceito: grep por gate/paralelo/workflow_run em docs/lessons.md e CLAUDE.md não retorna nada sobre isso; o CLAUDE.md global do usuário exige explicitamente "o pipeline deve ser o guardião final: nenhum código chega a produção sem passar por todas as camadas de teste" (Regra 2, item 8). Mitigantes que justificam manter MEDIUM (não subir pra high): `cf:build` roda `next build` internamente e `next.config.ts` NÃO tem `ignoreBuildErrors`, então erros de compilação/TypeScript bloqueiam o deploy implicitamente; é projeto pessoal single-user com monitoramento ativo; e o `environment: production` (deploy.yml:16) permitiria adicionar required reviewers/proteção sem mudar o workflow. Mas testes unitários, E2E e lint não bloqueiam nada — a sugestão de `workflow_run` gated em `conclusion == 'success'` é válida.

</details>


### [infra-workflows] Actions de terceiros sem SHA pinning em jobs com DATABASE_URL de escrita total e service_role key

**Onde:** `.github/workflows/scrape-daily.yml:29`


`jdx/mise-action@v2` (scrape-daily.yml:29, ai-reco.yml:40, closing-odds-capture.yml:28) e `pnpm/action-setup@v4` (ci.yml:21/56, deploy.yml:20, ai-reco.yml:94, calibracao-weekly.yml:35, telegram-closure.yml:24) são actions de terceiros pinadas por tag mutável. Elas rodam em jobs cujo env contém `SCRAPER_DATABASE_URL` (Postgres com escrita total na banca/bets), `SUPABASE_SERVICE_ROLE_KEY` (bypassa RLS) e `OPENROUTER_API_KEY` — um repo público. Um compromisso estilo tj-actions/changed-files (mar/2025: tag re-apontada pra commit que dumpa env/memória do runner) exfiltra essas credenciais. O ADR-010 afirma que os workflows seguem o checklist `optimizing-github-actions`, que exige exatamente o SHA pinning de actions de terceiros — está descumprido.


**Fix sugerido:** Pinar `jdx/mise-action` e `pnpm/action-setup` por SHA completo de commit (ex.: `jdx/mise-action@<sha40> # v2.x.y`) em todos os workflows e habilitar Dependabot `package-ecosystem: github-actions` pra manter os pins atualizados. As actions `actions/*` (first-party) são risco menor, mas pinar junto custa nada.


<details><summary>Evidência do verificador</summary>

CONFIRMADO em todos os pontos verificáveis. (1) Pins por tag mutável conferem linha a linha: `jdx/mise-action@v2` em .github/workflows/scrape-daily.yml:29, ai-reco.yml:40 e closing-odds-capture.yml:28; `pnpm/action-setup@v4` em ci.yml:21 e 56, deploy.yml:20, ai-reco.yml:94, calibracao-weekly.yml:35 e telegram-closure.yml:24. Nenhuma action de terceiro está pinada por SHA. (2) Os jobs realmente carregam as credenciais citadas: `SCRAPER_DATABASE_URL` (scrape-daily.yml:48, ai-reco.yml:59, closing-odds-capture.yml:47), `OPENROUTER_API_KEY` (ai-reco.yml:62), `SUPABASE_SERVICE_ROLE_KEY` (ai-reco.yml:111) e ainda `CLOUDFLARE_API_TOKEN` (deploy.yml:46, job que usa pnpm/action-setup@v4). (3) Não existe `.github/dependabot.yml` (só DEPLOY.md e workflows/ em .github/). (4) NÃO está documentado como conhecido/aceito: grep por pinning/SHA/dependabot em docs/lessons.md e CLAUDE.md não retorna nada sobre o tema. (5) A inconsistência com o ADR-010 procede: o CLAUDE.md afirma que o workflow ai-reco "segue o checklist optimizing-github-actions", e a descrição dessa skill exige explicitamente "SHA pinning of third-party actions" — descumprido; o ai-reco.yml até cita o checklist em comentário (linha 60-61, "checklist item 2") mas não pinou por SHA. Nuance honesta que NÃO refuta: os secrets são step-scoped (env do passo `run`, não do passo da action), então a action comprometida não os lê do próprio env; porém o vetor descrito (estilo tj-actions: dump da memória do Runner.Worker, que detém todos os secrets do job) e o fato de o mise-action instalar a própria toolchain Ruby/Node que os passos seguintes executam (backdoor trivial no binário → lê o env do passo com secrets) mantêm a exfiltração viável. Severidade medium é adequada: exige comprometimento upstream de uma action popular (probabilidade baixa, precedente real em mar/2025), mas o impacto é alto (escrita total na banca via Postgres + service_role bypassa RLS + token de deploy CF) em repo público.

</details>


### [infra-workflows] closing-odds-capture sem nenhum healthcheck/alerta — falha vermelha é perda de dado irrecuperável e ninguém é avisado

**Onde:** `.github/workflows/closing-odds-capture.yml:23-49`


Todos os outros jobs de dados têm ping Healthchecks.io (scrape-daily.yml:57-67, ai-reco.yml:79-84 + ciclo interno do Ruby, calibracao-weekly.yml:104-114), mas o closing-odds-capture não tem nenhum step de ping success/fail nem URL de healthcheck. É justamente o job cuja falha é irrecuperável: odds de fechamento só existem na janela ao redor do KO — um run vermelho (token choistats revogado, DB indisponível, mudança no widget) perde o dado pra sempre, e CLV é declarada no CLAUDE.md como a única métrica que sobrevive a small-sample. A lição B40 já mostrou que ninguém olha esse cron por semanas (zero capturas desde 01/06 sem ninguém notar — aquele caso foi o kill switch e está documentado; o modo de falha 'workflow vermelho despercebido' é o mesmo buraco e segue aberto).


**Fix sugerido:** Criar um check no Healthchecks.io com período de 1 dia/grace adequado e adicionar os mesmos dois steps de ping (success após o capture; /fail em failure()/cancelled()) usados no scrape-daily, com secret `HEALTHCHECKS_CLOSING_ODDS_URL`. Bônus: logar no step summary 'n fixtures candidatas / n odds gravadas' pra distinguir 'verde mas capturando zero'.


<details><summary>Evidência do verificador</summary>

CONFIRMADO. .github/workflows/closing-odds-capture.yml (50 linhas) termina no step "capture closing odds" (linhas 45-49) sem nenhum ping Healthchecks — grep por healthcheck/hc-ping em .github/workflows/*.yml só encontra scrape-daily.yml:58-68 (success+fail), ai-reco.yml:75-79 (fail) e calibracao-weekly.yml:104-114 (success+fail); closing-odds-capture é o único cron de dados sem alerta. Não há secret HEALTHCHECKS_CLOSING_ODDS_URL em lugar nenhum (CLAUDE.md lista só HEALTHCHECKS_URL, HEALTHCHECKS_AI_RECO_URL, HEALTHCHECKS_CALIBRATE_URL). Não está documentado como aceito: docs/lessons.md:97 (B40) registra o modo de falha irmão (cron VERDE capturando zero por causa do kill switch, despercebido desde 01/06) mas não trata o run vermelho sem alerta como gap conhecido/aceito. A irrecuperabilidade procede: a janela de captura é [now+5min, now+4h] ao redor do KO (CLAUDE.md seção CLV + comentário do próprio workflow linhas 3-7). Atenuantes que mantêm medium (não high): as 4 waves (15/17/19/21 UTC, idempotentes) dão redundância parcial a um run vermelho isolado, e no estado atual (kill switch IA off) o capture processa zero recos de qualquer forma (B40) — o buraco fica crítico quando a IA religar.

</details>


### [infra-workflows] llm_request_logs e ui_telemetry crescem sem nenhuma retenção num Postgres free tier de 500MB

**Onde:** `scripts/scraper/lib/scraper/orchestrator.rb:31-43`


O único purge automatizado do sistema é o de `fixtures` (orchestrator.rb#purge_older_than, linhas 31-43). Grep no repo inteiro (*.ts/*.rb/*.sql, workflows) não encontra DELETE/cleanup pra `llm_request_logs` (uma linha por chamada LLM, com payloads de erro) nem pra `ui_telemetry` (uma linha por evento de UI, e aceita escrita anônima — crescimento não está totalmente sob controle do dono). Nenhum workflow tem step de housekeeping. No Supabase free tier (500MB), são as duas tabelas de log puro que só acumulam até degradar o projeto inteiro — e quando o limite bater, atinge a banca (dado financeiro) junto. (`model_predictions` e `closing_odds` são append-only POR DESIGN documentado — excluídas deste achado.)


**Fix sugerido:** Adicionar um step de retenção num cron existente (ex.: calibracao-weekly): `DELETE FROM ui_telemetry WHERE created_at < now() - interval '90 days'` e `DELETE FROM llm_request_logs WHERE created_at < now() - interval '180 days'` (ou agregar custo/latência por dia antes de deletar). Alternativa Postgres-nativa: pg_cron no próprio Supabase.


<details><summary>Evidência do verificador</summary>

CONFIRMADO. (1) Único purge de retenção do sistema é o de fixtures: scripts/scraper/lib/scraper/orchestrator.rb:34-43 (`DELETE FROM fixtures WHERE kickoff_utc < now() - N days`); o `DELETE FROM fixture_simulations` em orchestrator.rb:100 é dedup de upsert por chave, não retenção. (2) llm_request_logs não tem NENHUMA FK (supabase/migrations/0012_create_llm_request_logs.sql: `fixture_id bigint` sem REFERENCES) — logo o purge de fixtures NÃO cascateia; grep repo-wide (*.ts/*.rb/*.sql/.github/workflows) não acha DELETE/cleanup pra essa tabela. (3) ui_telemetry (migrations/0028) só tem FK para auth.users ON DELETE SET NULL; também sem nenhum DELETE no repo e nenhum step de housekeeping em workflow. (4) Escrita anônima confirmada: app/api/telemetry/route.ts declara "Auth: none required" e insere via createAdminClient (service_role, linha 135) — a migration 0038 fechou o anon-insert só no nível RLS, mas a rota bypassa RLS; os rate limits existem porém são fracos (session_id é escolhido pelo cliente; limite por IP é Map in-memory, per-isolate no Cloudflare Worker). (5) Não está documentado como aceito: docs/lessons.md e CLAUDE.md não mencionam retenção dessas tabelas; a única menção a "housekeeping futuro" é em 0015_alert_dismissals.sql (outra tabela). Atenuantes honestos que mantêm a severidade em medium (não high): crescimento orgânico single-user é lento (dezenas de MB/ano) e o kill switch de IA está OFF agora (llm_request_logs quase parado); mas a superfície anônima do /api/telemetry torna o crescimento não totalmente controlado pelo dono e o estouro do free tier (500MB) afeta o projeto inteiro, incluindo a banca.

</details>


### [reconcilers-ai] Silent-death detector está morto: falha total do LLM e até DB fora do ar terminam com healthcheck SUCCESS e exit 0

**Onde:** `scripts/scraper/lib/scraper/ai_recommender_job.rb:122`


Três furos combinados anulam o detector que o B18 motivou: (1) `detect_silent_death` só dispara com `inserted_recos == 0`, mas desde a Parte 1 (skip-coverage) o runner persiste skips de graça (persist_skip → increment_inserted!, runner:621) E persiste fallback-skip quando o R1 falha (`insert_reco` é chamado mesmo com `result[:ok] == false`, runner:651-657 — decision nil vira verdict 'skip' "Análise indisponível") — ou seja, um replay exato do B18 (50 chamadas com 401/400) hoje insere ~50 skips, inserted>0, ping :success; o campo `errors` nunca é consultado. (2) `count_eligible` faz `rescue → 0` (job:140-145): se o DB está fora do ar, `runner.run` levanta (capturado em job:85, reco_stats fica 0/0), o COUNT também falha → pending=0 → `[false, 0]` → ping(:success). Outage total de banco = healthcheck VERDE. (3) `bin/run_ai_recommender` é `exit 0` sempre (documentado no --help), então o workflow ai-reco.yml também fica verde. Não há nenhum canal que sinalize a falha — exatamente a classe "quebra silenciosa em cascata" que o B40 já pegou no CLV.


**Fix sugerido:** (a) detectar silent-death também por taxa de falha do LLM: o runner já sabe `@llm_calls_made` e quantos results vieram `ok:false` — expor no hash de retorno (ex.: `llm_calls:, llm_failures:`) e pingar /fail quando `llm_calls > 0 && llm_failures == llm_calls`; (b) em `count_eligible`, exceção deve resultar em ping /fail (DB inacessível é falha, não 'sem pendência'); (c) considerar não persistir verdict 'skip' permanente quando o motivo é erro de LLM (usar reduction_reason='llm_error' e deixar elegível pra retry).


<details><summary>Evidência do verificador</summary>

CONFIRMADO nos 3 furos. (1) scripts/scraper/lib/scraper/ai_recommender_job.rb:122 — detect_silent_death só dispara com inserted_recos==0 e nunca lê `errors`; ai_recommender_runner.rb:621 (persist_skip → increment_inserted!) e runner:651-679 (insert_reco chamado mesmo com result[:ok]==false: decision nil vira verdict 'skip' "Análise indisponível agora" e incrementa inserted) — ai_reco/openrouter_client.rb:48/57/65/77 retorna {ok:false, decision:nil} em qualquer erro, nunca levanta. Replay do B18 (400/401 em todas as chamadas) hoje insere fallback-skips → inserted>0 → ping :success. O comentário do runner (linhas 162-164) admite que skip conta como "escreveu algo". (2) job:140-145 — count_eligible rescue→0; com DB fora do ar runner.run levanta (rescue job:85-87, stats 0/0), COUNT falha → pending=0 → [false,0] → ping(:success) em job:90. (3) bin/run_ai_recommender:30,35-36 — exit 0 incondicional; o step /fail do ai-reco.yml só roda em failure()/cancelled(), nunca atingido. NÃO documentado como aceito: CLAUDE.md descreve o detector sem o furo; docs/lessons.md B18 não registra a regressão; B40 reforça a classe "quebra silenciosa". Severidade ajustada high→medium: detector não é 100% morto (falha pré-escrita com DB sadio ainda dispara — 0 inserts + COUNT>10), outage de DB já alarmaria no scrape-daily das 10:00 (healthcheck próprio), e prod está com ai_enabled=false desde 01/06 (runner nem executa hoje). Impacto real: cegueira de monitoramento + recos do dia viram skips permanentes + custo de chamadas falhas, sem corrupção de dados.

</details>


### [reconcilers-ai] bet_won? grada o lado DESCONHECIDO como aposta no lado oposto (over25/btts) e o runner não valida market/side do LLM — bet com odd_captured NULL ganha e recebe PL negativo

**Onde:** `scripts/scraper/lib/scraper/ai_recommendation_reconciler.rb:197`


A defensividade tri-state só existe no nível do MARKET ("mercados não reconhecidos → nil"), não do SIDE: em `over25`, `side == 'over' ? ... : (hg+ag) <= 2` — qualquer side não-canônico ('sim', 'yes', typo do LLM) é gradado como UNDER; em `btts`, `side == 'sim' ? both : !both` — um 'yes' vira aposta em 'nao'. A cadeia que torna isso alcançável: `parse_decision` (openrouter_client.rb:128-135) só exige a chave 'verdict'; `insert_reco` (ai_recommender_runner.rb:658-664) procura `chosen` por match exato de market+side mas, se não acha, persiste o 'bet' assim mesmo com `odd_captured` NULL. Aí no reconciler `compute_pl` (linha 223-229) faz `row['odd_captured'].to_f` → 0.0, e uma aposta GANHA recebe `(0.0 - 1.0) * units = -units` — vitória contabilizada como derrota no ROI. O prompt enumera os sides válidos (prompt_builder.rb:36), o que reduz mas não elimina o risco com modelo de reasoning não-determinístico (já há histórico de JSON truncado do R1 — follow-up aberto).


**Fix sugerido:** No reconciler: trocar os ternários por case com whitelist de sides, retornando nil pra side desconhecido (mesmo contrato do market). No runner: se `d[:verdict]=='bet'` e `chosen.nil?`, rebaixar pra 'skip' com `reduction_reason: 'llm_market_side_mismatch'` em vez de persistir bet sem odd. Em compute_pl, tratar odd nula/<=1 como irresolvível (nil) em vez de 0.0.


<details><summary>Evidência do verificador</summary>

CONFIRMADO em todos os elos da cadeia. (1) Reconciler — scripts/scraper/lib/scraper/ai_recommendation_reconciler.rb: linha 197 `side == 'over' ? (hg + ag) > 2 : (hg + ag) <= 2` (over25: qualquer side desconhecido vira aposta UNDER) e linhas 199-200 `side == 'sim' ? both : !both` (btts: 'yes' vira aposta 'nao'). Contraste interno prova a inconsistência: o 1x2 (linhas 191-195) usa `case` sem else → side desconhecido retorna nil (defensivo), e o comentário das linhas 179-182 promete defensividade só pra "mercados não reconhecidos" — o contrato tri-state da Lição B19 ("nil quando stat ausente ⇒ NUNCA false-loss") não cobre side. (2) Runner — ai_recommender_runner.rb:658-660: `chosen = all_candidates.find { |c| c[:market]==d[:market] && c[:side]==d[:side] }`; se nil, o insert (666-678) persiste o verdict 'bet' assim mesmo com `chosen&.dig(:odd)` → odd_captured NULL; o `apply_sanity_guard` (linha 417: `return decision unless chosen_candidate.is_a?(Hash)`) passa direto quando chosen é nil, não rebaixa pra skip. (3) parse_decision — ai_reco/openrouter_client.rb:128-135 (`try_parse`) só exige a chave 'verdict'; market/side não são validados contra whitelist em lugar nenhum do caminho Ruby. (4) compute_pl — reconciler linhas 223-228: `row['odd_captured'].to_f` → 0.0 quando NULL; `won ? (0.0-1.0)*units : -units` = -units nos DOIS casos → vitória contabilizada como derrota se units_final>0 (enforce_caps permite até 1.0u). Nota que FORTALECE o achado: o caminho odd-NULL é alcançável até com valores 100% canônicos — basta o R1 escolher uma combinação market+side válida no schema (prompt_builder.rb:36) mas ausente da lista de candidates daquele fixture (ex.: linha '95' quando só '85' foi oferecida) → chosen=nil → bet persiste com odd NULL → over_under grada normal → win vira -units. Sem spec cobrindo side desconhecido no reconciler_spec. NÃO documentado como conhecido/aceito: docs/lessons.md B19 cobre só o tri-state de MARKET/stat ausente; nada sobre side nem sobre persistir bet com chosen nil. Severidade: medium é honesta — likelihood baixa-média (prompt enumera valores, temperature 0.4, sem ocorrência confirmada em prod), mas impacto real é poluição silenciosa de ROI/calibração (a métrica que dirige decisões do projeto) e há histórico de output malformado do R1 (follow-up r1-json-robustness aberto).

</details>


### [reconcilers-ai] Closing odds: primeira captura vence (até 4h antes do KO) e nunca é atualizada — a 'odd de fechamento' não é de fechamento, enviesando o CLV pra 0

**Onde:** `scripts/scraper/lib/scraper/closing_odds_capture.rb:31`


O ELIGIBLE_QUERY exclui qualquer reco cuja fixture já tenha QUALQUER linha em closing_odds (`NOT EXISTS ... c.fixture_id = r.fixture_id AND c.source = 'choistats'`), e o INSERT usa `ON CONFLICT ... DO NOTHING` (linha 44). Com a janela `[now+5min, now+4h]` e crons às 15/17/19/21 UTC, um jogo com KO 19:00 UTC é capturado na rodada das 15:00 (4h antes do KO) e NUNCA recapturado às 17:00/18:xx — a odd persistida como 'close' é a mais DISTANTE possível do fechamento dentro da janela. Isso corrompe sistematicamente a metodologia do CLV (`odd_taken/odd_close − 1`): a linha não teve tempo de incorporar informação, então o CLV colapsa pra ~0 — consistente com o achado do B40 (~70% dos pares com `odd_close ≡ odd_captured`, mediana 0.0%), que documenta outras 3 limitações estruturais mas NÃO esta. O comentário do próprio arquivo (linha 7: 'captura ~30min antes do KO') descreve um comportamento que o código não implementa.


**Fix sugerido:** Inverter pra last-write-wins: trocar `DO NOTHING` por `DO UPDATE SET odd_close = EXCLUDED.odd_close, captured_at = now()` e remover (ou restringir a 'mesma rodada') o NOT EXISTS — assim cada onda do cron refresca e a última captura antes do KO prevalece. Alternativa conservadora: manter histórico com uma coluna de wave e o consumidor pegar a captura mais próxima do KO.


<details><summary>Evidência do verificador</summary>

CONFIRMADO no código real. (1) scripts/scraper/lib/scraper/closing_odds_capture.rb:29-35 — ELIGIBLE_QUERY usa janela `kickoff_utc BETWEEN now()+'5 minutes' AND now()+'4 hours'` e `NOT EXISTS (SELECT 1 FROM closing_odds c WHERE c.fixture_id = r.fixture_id AND c.source = 'choistats')` — qualquer linha prévia da fixture×fonte exclui a reco de TODAS as ondas seguintes. (2) Linha 44: `ON CONFLICT (fixture_id, market, side, source) DO NOTHING` — mesmo que reentrasse, a primeira escrita venceria. (3) .github/workflows/closing-odds-capture.yml:10 confirma cron `0 15,17,19,21 * * *`: jogo com KO 19:00 UTC entra na janela da rodada das 15:00 (4h antes do KO), é capturado ali e nunca recapturado às 17:00 — first-capture-wins, e a captura tende ao extremo mais distante do KO (a janela de 4h é maior que o intervalo de 2h entre crons, então quase toda fixture é pega na primeira onda em que entra na janela). (4) O comentário das linhas 7 e 14-15 ('captura ~30min antes do KO' / 'captured perto do kick-off, depois do mercado processar todas as informações') descreve comportamento que o código não implementa — divergência doc-código confirmada. (5) NÃO está documentado como conhecido/aceito: docs/lessons.md B40 (linha 97) lista exatamente 3 limitações estruturais do CLV (cobertura de mercado do widget; linha que não se move em liga pequena; kill switch IA cegando o capture) e NENHUMA é esta — B40 atribui os ~70% de pares `odd_close ≡ odd_captured` a 'liga pequena a linha não se move', sem mencionar que a 'close' é capturada até 4h antes do KO e nunca refrescada (causa concorrente plausível pro mesmo sintoma). CLAUDE.md descreve a janela `[now+5min, now+4h]` factualmente mas não reconhece o viés first-capture-wins. Severidade: medium é honesta — corrompe a metodologia da métrica que o próprio CLAUDE.md chama de 'única que sobrevive a small-sample' (target Wave C +1.5%), mas o impacto prático hoje é amortecido por n=26, IA desligada (zero capturas desde 01/06) e odd_taken sendo de ~10:00 UTC (ainda há horas de movimento entre captura e close mesmo com o viés).

</details>


### [scraper-core] Falha total de widgets vira skeleton vazio NÃO-nil que sobrescreve detail_json bom (quebra o invariante A5) — e sem nenhum log

**Onde:** `scripts/scraper/lib/scraper/choistats_api_fetcher.rb:16`


A lição A5 documenta o invariante: 'fixture sem detail passa nil ao persister; COALESCE(EXCLUDED.detail_json, fixtures.detail_json) preserva o detail anterior'. O caminho HTTP-direct quebra isso: `ChoistatsApiClient#fetch_all` (choistats_api_client.rb:82-92) faz rescue StandardError POR widget e devolve nil naquela chave — inclusive AuthError (token rotacionado → 401 em TODOS os widgets) e RateLimitError. `ChoistatsApiFetcher#fetch` então retorna `{html:'', widgets:{recent_results:nil,...}}` sem nunca levantar exceção, `DetailParser.parse_detail('', widgets: all-nil)` produz `MatchDetail.empty.to_h` (hash skeleton NÃO-nil, match_detail.rb:30-50), e o persister serializa esse skeleton (`detail.nil? ? nil : JSON.generate(detail)`, persister.rb:66) → o COALESCE do upsert (persister.rb:22) vê valor não-NULL e SOBRESCREVE o detail_json bom anterior com casca vazia. Agravante: o orchestrator chama `detail_fetcher.fetch(abs_url)` sem passar logger (orchestrator.rb:555 e :583), e o default do fetcher/client é no-op `->(_) {}` (choistats_api_fetcher.rb:16, choistats_api_client.rb:82) — as falhas de widget são 100% silenciosas no CI log. Num dia de 401/429 generalizado o scrape termina 'OK', pinga healthcheck success, apaga detail bom e a simulação degrada pra 'unsimulable' sem nenhum sinal.


**Fix sugerido:** (1) Em `ChoistatsApiFetcher#fetch`, se TODOS os widgets canônicos vierem nil, retornar nil (ou levantar) em vez de `{html:'', widgets:{...}}` — assim o detail não entra no map e o COALESCE preserva o anterior, restaurando o invariante A5. (2) Propagar o `logger:` do orchestrator nas chamadas `detail_fetcher.fetch(abs_url, logger: logger)` em collect_details_serial/threaded. (3) Contar widgets falhos por rodada e logar no FINAL JSON; se a taxa global passar de um threshold (ex.: >50%), pingar /fail.


<details><summary>Evidência do verificador</summary>

CONFIRMADO no código real, cadeia completa: (1) choistats_api_client.rb:82-92 — fetch_all faz rescue StandardError POR widget (cobre AuthError/RateLimitError, linhas 13-22) e devolve nil na chave, nunca levanta; (2) choistats_api_fetcher.rb:16-31 — fetch retorna {html:'', widgets: all-nil} sem exceção; (3) detail_parser.rb:19-29 + widget_merger.rb (todos os builders nil-guarded: linhas 71, 105, 140, 181, 240, 287, 312...) produzem o skeleton MatchDetail.empty (match_detail.rb:30-50) — hash NÃO-nil, sem raise, então o rescue do orchestrator (collect_details_serial/threaded) nunca dispara; (4) persister.rb:66 serializa o skeleton não-nil e o COALESCE em persister.rb:22 SOBRESCREVE o detail_json bom anterior — invariante A5 (docs/lessons.md:7) quebrado no caminho HTTP-direct default (orchestrator.rb:347 usa ChoistatsApiFetcher.new); (5) logger não é propagado em orchestrator.rb:555, :583 e :615 — defaults no-op em choistats_api_fetcher.rb:16/35 e choistats_api_client.rb:82 ⇒ falhas de widget 100% silenciosas. NÃO documentado como conhecido/aceito em docs/lessons.md nem CLAUDE.md (A5 só cobre o caso nil/Playwright). ATENUANTES que rebaixam de high p/ medium: (a) o sub-cenário "token rotacionado/401 global" do achado em geral NÃO chega ao overwrite — a listagem usa o mesmo token e api_list_fetcher.rb:71-79 engole falhas por data retornando [] ⇒ parsed vazio ⇒ sem persist/overwrite; o cenário real é 429/5xx parcial APÓS a listagem (plausível: listagem ~8 reqs vs fan-out de centenas); (b) o dano se auto-cura no próximo scrape saudável (re-scrape diário, retenção 3-4 dias); (c) "nenhum sinal" é levemente exagerado — o silent-death detector do ai-reco (HEALTHCHECKS_AI_RECO_URL, ping /fail com 0 recos) pode disparar a jusante se o wipe for total. Ainda assim: no dia do jogo, sim+IA-2 consomem o detail apagado com healthcheck success — bug real de correção+observabilidade no caminho de produção.

</details>


### [scraper-core] Outage total da listagem (ou token morto) produz scrape 'OK' + ping de SUCESSO no healthcheck com 0 fixtures

**Onde:** `scripts/scraper/lib/scraper/api_list_fetcher.rb:76`


`ApiListFetcher#fetch_date` faz `rescue StandardError → []` por data (api_list_fetcher.rb:76-79). Se a api.choistats.com estiver fora ou o token for invalidado, TODAS as 7 datas falham, `fetch_list` devolve `[]`, e o orchestrator segue normal: `parsed.any?` é false → `stats = Stats.new(inserted:0, ...)` (orchestrator.rb:414), roda os reconcilers, executa `repo.purge_older_than(retention_days)` (orchestrator.rb:449) e **pinga `healthcheck.ping_success` incondicionalmente** (orchestrator.rb:485). Resultado: com retenção de 3 dias, um outage de poucos dias esvazia a plataforma silenciosamente enquanto o Healthchecks.io fica verde — exatamente o cenário que o healthcheck existe pra detectar. O 'silent-death detector' existente cobre só o recomendador IA, não a coleta. Não há nenhuma menção em docs/lessons.md a esse gap (grep por listing/0 fixtures/ping_success).


**Fix sugerido:** Guard de sanidade antes do ping de sucesso: se `parsed.size == 0` (ou se todas as datas do range falharam — distinguir 'API caiu' de 'dia genuinamente sem jogos' contando exceções vs respostas vazias legítimas), logar `[scrape] FAILED: empty listing` e pingar `fail_url` (ou levantar) em vez de success. Opcional: pular o purge quando a listagem falhou por completo, pra não encolher a base durante o outage.


<details><summary>Evidência do verificador</summary>

CONFIRMADO. (1) api_list_fetcher.rb:76-79: `fetch_date` faz `rescue StandardError => e; []` — token morto vira AuthError (choistats_api_client.rb:141) e outage vira ServerError (:146), ambos StandardError, ambos engolidos; 7 datas falhando ⇒ `fetch_list` retorna []. (2) orchestrator.rb:392/414: `parsed.any?` false ⇒ `Stats.new(inserted:0,...)`; reconcilers rodam (:419-447); `repo.purge_older_than(retention_days)` roda incondicionalmente (:449); `healthcheck.ping_success` em :485 — o rescue→ping_failure (:487-489) só dispara com exceção levantada, que nunca ocorre nesse caminho. bin/scrape sai 0 e scrape-daily.yml só pinga /fail em failure()||cancelled() (linhas 64-68). (3) Único sinal é o log `fixtures_listed:0` (:475-482), sem alerta; o silent-death detector da IA-2 não cobre (com 0 fixtures não há pendentes ⇒ não dispara). (4) Não documentado: grep em docs/lessons.md (outage/empty/silent/healthcheck/token) só acha lições não relacionadas (B7/B12/B18/B22); CLAUDE.md descreve HEALTHCHECKS_URL sem caveat. Severidade ajustada de high→medium: gap real que derrota exatamente o alerting da coleta e o purge encolhe a base durante o outage, MAS plataforma single-user com uso diário (detecção humana em ~1 dia), dados efêmeros por design (retenção 3-4 dias, nada permanente se perde) e token estático desde 2021 — atraso de detecção é limitado, não unbounded. Fix barato: fail/raise quando parsed vazio distinguindo exceções de dia sem jogos.

</details>


### [scraper-core] Persister: transação única pro batch inteiro — 1 fixture inválida zera a persistência do dia; campo `failed` do Stats nunca é usado

**Onde:** `scripts/scraper/lib/scraper/persister.rb:35`


`Persister.persist` envolve TODAS as fixtures (~300-400/dia) num único BEGIN/COMMIT (persister.rb:36-47). Qualquer erro em UMA linha (ex.: string estourando limite, NULL inesperado vindo do parser, violação de constraint) faz ROLLBACK do batch inteiro e `raise PersistError, e.message` → o rescue top-level do Orchestrator (orchestrator.rb:487-490) derruba o scrape COMPLETO, perdendo também simulação, reconcilers e baseline daquele dia. Isso contradiz a filosofia de isolamento por-fixture usada em todo o resto do pipeline (Lição A5/#11), e a própria struct `Stats = Data.define(:inserted, :updated, :failed)` (persister.rb:9) tem o campo `failed` que é SEMPRE 0 (persister.rb:50) — evidência de que a isolação por linha era intenção original. Bônus: `raise PersistError, e.message` descarta a classe e o backtrace originais, dificultando o diagnóstico no log do CI (só a message sobrevive).


**Fix sugerido:** Isolar por fixture: ou um upsert auto-commit por linha contando `failed += 1` no rescue (aceitável — o upsert é idempotente entre rodadas), ou SAVEPOINT por fixture dentro da transação. Preencher `failed` no Stats e logá-lo no FINAL JSON. No re-raise, preservar contexto: `raise PersistError, "#{e.class}: #{e.message}"` (o `cause` já encadeia automático em Ruby).


<details><summary>Evidência do verificador</summary>

CONFIRMADO em todos os pontos. (1) persister.rb:35-48: BEGIN único → loop sobre todas as fixtures → COMMIT; rescue StandardError → ROLLBACK do batch inteiro + `raise PersistError, e.message` (linha 46). (2) orchestrator.rb:407 chama persister.persist SEM rescue local — diferente dos reconcilers (419-447) e do simulation_hook (410-412, comentado como "failure-isolated por fixture E globalmente, Lição #11"), o que prova que o persister contradiz a filosofia de isolamento do resto do pipeline; o PersistError propaga pro rescue top-level (orchestrator.rb:487-490) que re-raise, pulando simulação (412), 3 reconcilers (420/431/443), purge (449) e baseline (453) — efeito descrito é exato. (3) `failed` sempre 0: persister.rb:9 define o campo, persister.rb:50 hardcoda 0, orchestrator.rb:414 idem, e persister_spec.rb:49 cristaliza `expect(stats.failed).to eq(0)` — nenhum código incrementa. (4) Bônus confirmado: o log do CI (orchestrator.rb:488) imprime só `PersistError: <message>` — classe/backtrace originais ficam só no `cause`, não no log. (5) NÃO documentado como aceito: grep em docs/lessons.md e CLAUDE.md não acha nada sobre transação única do persister; a Lição A5 (lessons.md:7) estabelece isolamento por-fixture como filosofia. Severidade mantida em medium: mitigantes reais (healthcheck /fail pinga — não é silencioso; upsert idempotente, dia seguinte re-tenta; superfície de erro por linha estreita: colunas text/jsonb), mas quando dispara perde o dia inteiro de fixtures+sim+recos (ai-reco.yml 10:45 fica sem dados).

</details>


### [scraper-core] Retry do ChoistatsApiClient ignora 429 (Retry-After capturado e nunca usado) e 503

**Onde:** `scripts/scraper/lib/scraper/choistats_api_client.rb:50`


O middleware faraday-retry está configurado com `retry_statuses: [502, 504]` apenas (choistats_api_client.rb:50-54). 503 (indisponibilidade transitória clássica) e 429 não são retentados. A classe `RateLimitError` até carrega `retry_after` lido do header (choistats_api_client.rb:143-144), mas NENHUM call-site usa: `fetch_all` rescue-a e devolve nil pro widget (choistats_api_client.rb:87-90). Com `collect_details_threaded` rodando 4 threads concorrentes × 5-6 requests por fixture × centenas de fixtures (orchestrator.rb:568-594), um rate-limit do choistats vira degradação silenciosa em massa de widgets (alimentando o achado do skeleton vazio) em vez de um backoff. Um retry barato com o Retry-After honrado recuperaria a maioria dos casos.


**Fix sugerido:** Adicionar `429` e `503` a `retry_statuses` — o faraday-retry honra o header `Retry-After` automaticamente para statuses retentados. Opcionalmente subir `max` para 3 nesses statuses e/ou reduzir a concorrência quando RateLimitError começar a aparecer (contador compartilhado simples).


<details><summary>Evidência do verificador</summary>

CONFIRMADO ponto a ponto. (1) `scripts/scraper/lib/scraper/choistats_api_client.rb:50-54`: middleware faraday-retry com `retry_statuses: [502, 504]` apenas — 429 e 503 não são retentados (503 cai em `ServerError` via `when 500..599`, linha 145-146, sem retry). (2) `choistats_api_client.rb:16-22` e 143-144: `RateLimitError` carrega `retry_after` lido do header, mas `grep -rn retry_after` no scraper mostra que os ÚNICOS consumidores fora da própria classe são specs (`choistats_api_client_spec.rb:57,137`) — nenhum call-site de produção usa o valor; é dead payload. (3) `choistats_api_client.rb:82-92`: `fetch_all` rescue-a `StandardError` (inclui RateLimitError) e devolve `nil` por widget, só logando — a run segue "verde". (4) `orchestrator.rb:319` (`DEFAULT_DETAIL_CONCURRENCY = 4`), confirmado em prod por `.github/workflows/scrape-daily.yml:51` (`SCRAPER_DETAIL_CONCURRENCY: "4"`); `collect_details_threaded` (orchestrator.rb:568-594) dispara 4 threads, cada fixture puxando 5 widgets (`WIDGET_PATHS`, client linhas 29-35 — achado disse 5-6, são 5; detalhe irrelevante). Ou seja: num evento de rate-limit, centenas de fixtures viram detail_json degradado em massa, com healthcheck reportando sucesso. (5) `fetch_all` é chamado por `choistats_api_fetcher.rb:20`, o caminho default de produção (HTTP-direct, Lesson A6). (6) Não documentado como conhecido/aceito: grep por 429/rate-limit/retry-after/503 em docs/lessons.md e CLAUDE.md não retorna nada relacionado. A sugestão é tecnicamente correta: faraday-retry honra `Retry-After` automaticamente para statuses em `retry_statuses`. Severidade mantida em medium: é gap real de resiliência no caminho crítico diário com degradação efetivamente silenciosa no nível de monitoramento (só aparece em log), mas condicional a um evento de rate-limit/503 do choistats — não há evidência de que já tenha ocorrido em produção.

</details>


### [security] POST /api/fixtures/[id]/refresh sem autenticação — escrita via service_role + fan-out de 6 requests ao choistats acionável por qualquer um

**Onde:** `app/api/fixtures/[id]/refresh/route.ts:25`


O handler POST não tem nenhum gate de auth (zero ocorrências de getUser/getClaims/createClient no arquivo; usa só `createAdminClient`, linha 55) e o middleware exclui `/api/*` (middleware.ts:21). Qualquer cliente anônimo pode iterar IDs e disparar `fetchFixtureDetail` — 6 requests upstream ao choistats com o token do projeto por chamada — e UPDATE em `fixtures.detail_json`/`scraped_at`/`status` via service_role (linhas 88-96). O lockdown de 2026-05-27 protegeu feedback/compute/telemetry, mas este endpoint ficou de fora (o comentário em ai-reco/compute/route.ts:60-61 ainda o cita como 'sem session gate' — referência stale, pois o compute ganhou gate). Abuso sustentado pode queimar o rate-limit/banir o token choistats (fonte única do domínio fixtures) e consumir subrequests do Worker free tier.


**Fix sugerido:** Adicionar o mesmo auth gate do `/api/ai-reco/compute` (createClient + getUser → 401) no início do POST. Opcionalmente um rate-limit simples por fixture (ex.: recusar refresh se `scraped_at` < 60s atrás) como defesa em profundidade.


<details><summary>Evidência do verificador</summary>

CONFIRMADO em todos os pontos. (1) app/api/fixtures/[id]/refresh/route.ts: o POST (linha 24) não tem nenhum gate de auth — o arquivo inteiro (105 linhas) não contém getUser/getClaims/createClient; usa apenas createAdminClient() na linha 54 (service_role, comentário na linha 87: "Service-role client bypasses RLS") e faz UPDATE em fixtures.detail_json/scraped_at/status nas linhas 88-95. (2) middleware.ts:21: o matcher exclui explicitamente "api" ("/((?!api|_next/static|...)"), com comentário nas linhas 17-19 dizendo que route handlers usam createClient() "independently when they need auth" — este não usa. (3) lib/fixtures/choistats-api.ts: fetchFixtureDetail de fato faz fan-out de 6 requests upstream (comentário linha 6 "we fan-out 6 widget requests in parallel" + 6 widgets nas linhas 39-46) com o token do projeto. (4) A referência stale também confere: app/api/ai-reco/compute/route.ts:54-55 ainda diz "Auth: matches sibling routes (/api/fixtures/[id]/refresh) — ... no per-request session gate (single-user app)", mas o próprio compute GANHOU gate (linhas 131-142: createClient + getUser → 401). O lockdown de 2026-05-27 cobriu feedback (getUser em ai-reco/feedback/route.ts:60) e telemetry (rate limit IP 200/min em telemetry/route.ts:45-92), mas o refresh ficou de fora. (5) Não está documentado como conhecido/aceito: grep em docs/lessons.md e CLAUDE.md não acha nenhuma menção ao refresh sem auth — a única "documentação" é o comentário stale no compute route (código, não docs, e pré-lockdown). Mitigantes honestos que mantêm a severidade em medium (não high): o id precisa existir na tabela (404 caso contrário), o UPDATE grava dados legítimos frescos do choistats (não payload do atacante), e o ADAMCHOI_API_TOKEN já é público/estático embutido na SPA (CLAUDE.md) — o dano marginal é abuso de quota de subrequests do Worker free tier e tráfego abusivo ao choistats atribuído à infra do projeto, mais a escrita anônima via service_role como classe de bug. A sugestão (gate igual ao do compute + throttle por scraped_at) é correta e barata.

</details>


### [security] GET /api/calibracao/secondary-metrics público apesar do próprio doc dizer 'Requires service-role auth' — query de 5000 linhas acionável anonimamente

**Onde:** `app/api/calibracao/secondary-metrics/route.ts:63`


O docblock (linha 20) afirma 'Requires service-role auth (server-only)', mas o handler GET não tem nenhuma verificação de sessão — vai direto de `createAdminClient()` para um SELECT de até 5000 linhas de `fixture_simulations` com `force-dynamic` (sem cache) e computa 4 métricas (Brier + 3 CRPS) por request. `fixture_simulations` tem RLS service-role-only justamente por não ser exposta a `authenticated`, mas este endpoint a expõe a QUALQUER um, sem auth. Além do vazamento (dados não-sensíveis, mas deliberadamente fechados no RLS), é um amplificador barato de CPU/egress contra o Worker free tier (limite de 10ms CPU — classe B23) e o Supabase free tier.


**Fix sugerido:** Adicionar auth gate (createClient + getUser → 401) no início do GET, alinhando o código ao próprio comentário. Os consumidores são os painéis de /calibracao, todos atrás de login — zero impacto funcional.


<details><summary>Evidência do verificador</summary>

CONFIRMADO. app/api/calibracao/secondary-metrics/route.ts:53-70 — GET sem nenhum gate de auth: vai direto de createAdminClient() (service role, bypassa RLS) pra SELECT de 18 colunas em fixture_simulations com .limit(5000) e força recompute por request (force-dynamic, linha 30; Brier+3 CRPS linhas 82-85). O docblock na linha 17 (não 20) diz literalmente "Requires service-role auth (server-only)" — contradito pelo código. middleware.ts:21 exclui api/* do matcher, então nada protege a rota — anonimamente acessível. É anomalia, não convenção: rotas irmãs têm gate explícito getUser→401 (ai-reco/compute/route.ts:136-141, ai-reco/feedback/route.ts:60-65, ai-reco/apostei/route.ts:111-122, bets/export/route.ts:56-61). RLS service-role-only de fixture_simulations confirmado em supabase/migrations/0018_fixture_simulations.sql:85-91 (sem policy authenticated em nenhuma migration posterior, inclusive 0038). NÃO documentado como conhecido/aceito em docs/lessons.md nem CLAUDE.md. Nuance: o response retorna só AGREGADOS (n, brier, crps — linhas 95-110), não as 5000 linhas cruas, então o "vazamento" é mais fraco que o título sugere; o efeito plenamente confirmado é o amplificador anônimo de CPU/DB/egress (scan de 5000 linhas por request contra Worker free 10ms CPU — classe B23 — e Supabase free ~5GB egress/mês). Bônus: grep não achou nenhum consumidor do endpoint na UI (só CLAUDE.md e a própria rota) — gate ou remoção tem zero impacto funcional, como a sugestão afirma.

</details>


### [security] Rate limits do /api/telemetry são contornáveis → flood ilimitado do Postgres via service_role

**Onde:** `app/api/telemetry/route.ts:56`


Duas falhas combinadas no endpoint anônimo de telemetria: (1) o limite de 200 req/min/IP usa um `Map` em memória do módulo (linhas 56-67) — em Cloudflare Workers cada isolate tem seu próprio Map e isolates são criados/destruídos constantemente entre POPs, então o contador reseta na prática e o limite não é aplicado de forma confiável; (2) o limite de 1000 eventos/min é por `session_id` fornecido PELO CLIENTE (linha 104-117) — basta rotacionar o session_id a cada request para nunca atingir o teto (e a checagem ainda é fail-open, linha 119-121). Como o insert é feito via `createAdminClient()` (bypassa o RLS que a 0038 fechou para anon — 0038_rls_explicit_policies.sql:38-44), um atacante grava 50 eventos × ~2KB por request, ilimitado → enche os 500MB do Supabase free tier e derruba o banco INTEIRO, incluindo o domínio banca (dinheiro). O lockdown de 2026-05-27 adicionou esses limites, mas a inefetividade do limiter em memória no runtime Workers não está documentada como aceita.


**Fix sugerido:** Trocar o rate limit por algo que sobreviva a isolates: contagem no próprio Postgres por IP (índice em payload/coluna ip + janela), Cloudflare WAF rate-limiting rule no path /api/telemetry (free tier tem 1 regra), ou KV/Durable Object. No mínimo, validar session_id contra um formato/HMAC emitido pelo app para impedir rotação trivial.


<details><summary>Evidência do verificador</summary>

Achado CONFIRMADO no código real. app/api/telemetry/route.ts: (1) IP limiter usa `const ipMap = new Map()` no escopo do módulo (linhas 54-65) — em CF Workers/OpenNext cada isolate tem o próprio Map, isolates são efêmeros e distribuídos por POPs, logo o limite de 200 req/min/IP não é global nem confiável (anti-pattern legítimo). (2) O limite primário de 1000 eventos/min é por `session_id` fornecido pelo cliente (`eventSchema.session_id = z.string().min(1)`, sem HMAC/formato), checado em DB nas linhas 96-115; rotacionar o session_id zera o contador; e a checagem é fail-open (linhas 116-118: `catch {}` com comentário 'allow insert (fail open, not closed)'). (3) Insert via `createAdminClient()` service_role (linhas 99/134) bypassa o RLS que a 0038_rls_explicit_policies.sql:38-44 fechou pra anon (`ui_telemetry_insert_auth` exige auth.uid()=user_id). Endpoint público (linha 20 'Auth: none required'). bodySchema permite 50 eventos × <2048 bytes por request, ilimitado. Confirmei ausência de retenção/prune de ui_telemetry (nenhum delete/cron/cleanup em migrations, scripts ou workflows) → inserts acumulam no free tier de 500MB compartilhado com a banca (dinheiro). NÃO documentado como aceito: a memória auto-pos-brainstorm registra que o IP limit 200/min e o uso de createAdminClient existem, mas não a inefetividade do limiter em memória no runtime Workers nem o bypass por rotação de session_id+fail-open; CLAUDE.md e docs/lessons.md (B22/B23 tratam de outras coisas) não cobrem isto. Pequeno drift nas linhas citadas pelo auditor (IP fn é 56-65, session 102-115, fail-open 116-118) mas a substância confere. Severidade medium é honesta: DoS por exaustão de storage, não exfiltração/RCE; app pessoal single-user (baixa probabilidade de alvo), porém raio de impacto real (DB compartilhado com domínio dinheiro) e agravado pela falta de retenção.

</details>


### [sim-engine] Cards: dispersão NB estimada em booking points mas aplicada a média em contagem de cartões (+ fallback silencioso que troca a unidade da média)

**Onde:** `scripts/scraper/lib/scraper/simulation/runner.rb:212`


`card_cfg` monta `mean = val(block,'cardsFor') || val(block,'bookingPointsFor')` e `dispersion: SecondaryStats.dispersion_from(recent.map { |m| m[field] })` com `field = 'homeBookingPoints'/'awayBookingPoints'` (runner.rb:163-164, 212-219). Dois problemas de unidade: (a) a dispersão NB `r = μ²/(Var−μ)` (secondary_stats.rb:34-44) é estimada na série de BOOKING POINTS (escala ~10-45/jogo, variância dominada pelos pesos 10/25 e saltos de vermelho ⇒ r pequeno) mas aplicada a uma média em CONTAGEM de cartões (~2.3) — infla artificialmente a variância da distribuição de cards (Var ≈ 2.3 + 2.3²/r_bp), distorcendo os p10/p90 persistidos em `sim_stats` que alimentam UI, reconciliação (B19 confirma: cards é count, p50≈2/time) e a calibração de distribuição. A série correta existe no payload: `homeYellows`+`homeReds` por jogo (confirmado em docs/pesquisas/choistats-amostra-real.json). (b) o `||` faz fallback da MÉDIA pra `bookingPointsFor` (~24.5): se `cardsFor` faltar numa liga, a métrica vira booking points silenciosamente, `sim_cards_total_mean` (~45) entra no edge-calculator contra linhas de 3.5/4.5 cartões (edge_calculator.rb:148-156) e gera 'over' com p≈1.0 — edge falso enorme num caminho que recomenda aposta real.


**Fix sugerido:** Em `card_cfg`, estimar a dispersão da série `homeYellows+homeReds` (mesma unidade da média) em vez de `homeBookingPoints`; e remover o fallback `|| val(block,'bookingPointsFor')` (ou converter explicitamente BP→cards com fator documentado, nunca trocar unidade em silêncio). Teste de regressão: cfg de cards com cardsFor ausente NÃO pode emitir mean em BP.


<details><summary>Evidência do verificador</summary>

CONFIRMADO. (a) runner.rb:163-164 chama card_cfg com field 'homeBookingPoints'/'awayBookingPoints'; runner.rb:212-219 estima dispersion NB via SecondaryStats.dispersion_from sobre essa série de BOOKING POINTS (valores 10-65/jogo na amostra real docs/pesquisas/choistats-amostra-real.json) e aplica à mean em CONTAGEM (cardsFor≈2.7). secondary_stats.rb:34-44 (r=μ²/(Var−μ)) é scale-dependent: r_bp≈3.3 ⇒ Var(cards)≈2.7+2.7²/3.3≈4.9 vs ~2.7 Poisson — variância inflada como o achado afirma. A série correta (homeYellows+homeReds) existe no payload e é a unidade do reconciler (docs/lessons.md B19: "sim_stats.cards é count, p50≈2/time"), mas grep confirma que lib/scraper/simulation/ nunca usa homeYellows. (b) runner.rb:213 tem o fallback silencioso `|| val(block,'bookingPointsFor')` (presente desde o commit original d36f1b2); se disparar, sim_cards_total_mean ~45-50 entra em edge_calculator.rb (bloco cards, linhas 3.5/4.5/5.5, poisson_prob_over) com p≈1.0, e os sanity guards NÃO cobrem liga calibrada (ai_recommender_runner.rb:307 pre-filter e :416 `return decision if league_calibrated` só bloqueiam edge>50% em liga NÃO-calibrada) — caminho até aposta real existe. Não documentado como conhecido: B19/B34/B35/B36/B37 tratam dispersão de cartões (NB/CMP) mas nunca mencionam o mismatch de unidade nem o fallback; nada no CLAUDE.md. AJUSTE DE SEVERIDADE high→medium: (i) NB preserva a média, então o item (a) NÃO afeta sim_cards_total_mean nem as probabilidades do edge-calculator (que usa Poisson analítico da média) nem o dist_k (fit sobre médias) — distorce só p10/p90/forma em sim_stats (UI); (ii) o item (b), de impacto alto, é condicional a cardsFor ausente com bookingPointsFor presente — cardsFor aparece consistentemente no catálogo da API (docs/external-apis/choistats/choistats-api.md:144,187) e ambos vêm do mesmo bloco avgs, sem evidência de disparo em prod. Bug real e não-documentado, mas efeito observado limitado a forma de distribuição + bomba latente condicional.

</details>


### [sim-engine] Runner.simulate engole QUALQUER StandardError sem nenhum log; orchestrator nem conta os 'unsimulable'

**Onde:** `scripts/scraper/lib/scraper/simulation/runner.rb:98`


`rescue StandardError; unsimulable; end` (runner.rb:98-101) converte qualquer bug interno (NoMethodError de refactor, shape novo do choistats, nil inesperado) em `{status:'unsimulable'}` sem classe/mensagem/backtrace. No orchestrator, `next if sim.nil? || sim[:status] == 'unsimulable'` (orchestrator.rb:208) também não incrementa contador nem loga — o resumo só reporta 'N simulated, M skipped'. Uma regressão que torne 100% das fixtures unsimulable apareceria apenas como '0 simulated' sem causa, e ninguém é alertado (o healthcheck do scrape pinga success). É exatamente a classe 'clamp silencioso que esconde bug' — a degradação honesta (Lição #11) exige não-raise, não exige cegueira.


**Fix sugerido:** No rescue do Runner, capturar `e` e devolver `unsimulable` com `reason: "#{e.class}: #{e.message}"` (ou aceitar um logger injetado); no orchestrator, contar e logar os unsimulable no resumo do hook (ex.: 'X simulated, Y skipped, Z unsimulable') e alertar/failar healthcheck se Z/total exceder um threshold.


<details><summary>Evidência do verificador</summary>

CONFIRMADO. (1) runner.rb:98-101: `rescue StandardError` sem capturar `e`; `unsimulable` (l.103-105) devolve só {status, model_version} — zero classe/mensagem/backtrace, sem logger no módulo. (2) orchestrator.rb:207-208: `next if sim.nil? || sim[:status] == 'unsimulable'` sem contador/log; resumo (l.225) só reporta simulated/skipped (skipped = pre-check incremental) — unsimulable some de ambos os buckets. Agravante: o rescue por-fixture do orchestrator (l.~221) ATÉ logaria e.class/e.message, mas nunca dispara porque o Runner engole tudo antes. (3) Hook é non-fatal (rescue global) e scrape-daily.yml:59-62 pinga healthcheck success em `if: success()` — 0 simulated pinga success. Mitigação parcial que NÃO refuta: pipeline-health-card.tsx (l.9,42) mostra simsToday com semáforo (vermelho <10, verde ≥50) — regressão 100% ficaria vermelha passivamente em /calibracao, mas sem causa; e com ~285 fixtures/dia uma regressão parcial de até ~70% ainda dá ≥50 sims = VERDE (invisível). Nenhum alerta ativo (lib/alerts/ só tem is-high-signal). Não documentado como aceito: "Lição #11" do comentário é a A5 de docs/lessons.md:7 (isolamento de thread Playwright, não-raise por fixture) e a spec §6.5 manda degradar sem raise — nenhuma aceita a ausência de razão/contagem; "não-raise ≠ cegueira" procede.

</details>


### [tests-ci] Job E2E fica verde com a suíte inteira skipada — incluindo o fluxo OCR→commit, que está skipado em TODO run desde 03/06 por depender de estado mutável de prod

**Onde:** `tests/e2e/bet-slip-photo.spec.ts:277`


Todos os specs E2E começam com `test.skip(!hasE2ECredentials(), ...)` (landing.spec.ts:5, fixture-detail.spec.ts:17, etc.) e o CI não tem failsafe — se as secrets E2E_USER_* forem rotacionadas/removidas, o job `e2e` (ci.yml:89-100) passa verde com 0 testes executados. Caso concreto já em vigor: bet-slip-photo.spec.ts:277 skipa quando `app_settings.ai_enabled=false` no banco de PROD — que é o estado operacional desde 03/06 (kill switch desligado). Ou seja, o único E2E do fluxo upload→confirmação→commitSlip (caminho de dinheiro, com mock OpenRouter montado exatamente pra não depender de IA real) não roda no CI há semanas e nada sinaliza isso. Idem fixtures-browser.spec.ts:39 (skipa sem jogos no dia).


**Fix sugerido:** (1) Failsafe no job e2e: falhar se `expected === 0` testes executados (parsear o JSON reporter do Playwright ou usar um reporter custom que falha quando tudo foi skipped). (2) Pro fluxo OCR stub, desacoplar do kill switch de prod: permitir override por env no webServer de teste (ex.: AI_ENABLED_OVERRIDE=1 lido só quando NODE_ENV de teste) pra que o mock OpenRouter volte a ser exercitado.


<details><summary>Evidência do verificador</summary>

CONFIRMADO. (1) ci.yml:89-100 roda `playwright test --grep-invert "live OCR"` sem nenhum check de testes executados; playwright.config.ts:45-47 só tem reporters github+html — Playwright sai 0 com tudo skipado, então rotação/remoção das secrets E2E_USER_*/SUPABASE_SERVICE_ROLE_KEY deixaria o job verde com 0 testes. (2) Guards confirmados: landing.spec.ts:5, fixture-detail.spec.ts:17, fixtures-browser.spec.ts:13, stats-page.spec.ts:6 (`hasE2ECredentials`), bet-slip-photo.spec.ts:271 (`authReady`), fixtures-browser.spec.ts:39 (cardCount===0). (3) Caso concreto confirmado: bet-slip-photo.spec.ts:277-280 skipa via isAiEnabledInDb() (linhas 51-63), que lê app_settings.ai_enabled do banco apontado por NEXT_PUBLIC_SUPABASE_URL — que no CI é o projeto de PRODUÇÃO por design (ci.yml:77-79). Prod está ai_enabled=false desde 03/06 (memória kill-switch-ia.md; lesson B40 de 09/06 confirma IA ainda off), logo o único E2E do fluxo upload→confirmação→commitSlip (com mock OpenRouter montado em tests/e2e/support/mock-openrouter.mjs justamente pra não depender de IA real) não roda desde 03/06 — ressalva: ~6 dias, não "semanas". (4) Não está documentado como aceito: o skip individual é deliberado (comentário "pré-condição operacional, não bug" no spec; CLAUDE.md menciona write-tests skip-guardados), mas o meta-problema — job verde sem sinal de cobertura zerada e ausência de failsafe — não consta em docs/lessons.md nem CLAUDE.md; a B40 lista os consumidores downstream do kill switch (CLV, calibração) e NÃO inclui este E2E, e a B17 declara smoke E2E "OBRIGATÓRIO", o que torna o gap inconsistente com a política do projeto. Severidade medium mantida: é gap de integridade de CI (perda silenciosa de cobertura do caminho de dinheiro + suíte inteira pode zerar verde), não bug de prod.

</details>


## 🔵 LOW (15)


### [app-api] Telemetry: rate limit por IP é in-memory per-isolate no Workers (inócuo) e o limite por sessão é bypassável com session_id aleatório

**Onde:** `app/api/telemetry/route.ts:54`


O `ipMap` (linha 54) vive na memória do isolate: no Cloudflare Workers cada PoP/isolate tem seu próprio Map e isolates são reciclados, então o limite de 200 req/min/IP praticamente não limita um atacante distribuído — e o Map nunca expurga entradas expiradas (só sobrescreve no retorno do mesmo IP), crescendo sem bound com IPs únicos. O limite por sessão (linhas 96-115) conta rows por `session_id`, que é string arbitrária do cliente — basta um `session_id` aleatório por request pra nunca atingir 1000/min, e o check é fail-open (linha 116-118). Endpoint anônimo com insert via service_role de até 50 eventos × 2KB por request = write amplification barata no Postgres free tier.


**Fix sugerido:** Mover o rate limit pra camada que enxerga todas as requests: regra de rate limiting do Cloudflare WAF na rota /api/telemetry (free tier tem 1 regra), ou limiter em KV/Durable Object. No mínimo: evict de entradas expiradas no ipMap e usar SÓ `cf-connecting-ip` (o fallback `x-forwarded-for` é spoofável quando o header CF faltar).


<details><summary>Evidência do verificador</summary>

CONFIRMADO em app/api/telemetry/route.ts: (1) ipMap módulo-scope na linha 54 — em CF Workers/OpenNext (ADR-002) é per-isolate, então o limite 200 req/min/IP não enxerga tráfego cross-PoP/cross-isolate; (2) checkIpRateLimit (linhas 56-65) só sobrescreve a entrada quando o MESMO IP volta após resetAt — nunca deleta entradas de IPs únicos, crescendo até o isolate reciclar; (3) limite por sessão (linhas 96-115) conta rows de ui_telemetry por session_id, string arbitrária do cliente (z.string().min(1), linha 25) — session_id aleatório por request ⇒ count=0, nunca atinge 1000; (4) fail-open explícito nas linhas 116-118 ("allow insert (fail open, not closed)"); (5) endpoint anônimo (linha 20 "Auth: none required") insere via createAdminClient/service_role (linha 134), max 50 eventos (linha 40) × payload <2048 bytes (linha 33). Fallback x-forwarded-for na linha 88 confirmado, mas marginal (atrás do CF o cf-connecting-ip está sempre presente). NÃO está documentado como conhecido/aceito: docs/lessons.md não tem lição sobre per-isolate nem sobre o bypass de session_id (o lockdown de 2026-05-27 adicionou o rate limit mas não registrou as limitações); CLAUDE.md só nota "anon OK" na tabela ui_telemetry. Severidade "low" é justa: app pessoal single-user, pior caso realista é encher a tabela ui_telemetry no Postgres free tier (incômodo recuperável, sem impacto em integridade/dinheiro), e exige atacante motivado contra alvo de perfil baixíssimo.

</details>


### [app-api] /api/fixtures vaza mensagem de erro interno (PostgREST) pra clientes anônimos

**Onde:** `app/api/fixtures/route.ts:38`


No catch, `err.message` é serializado direto pro corpo da resposta 500 (`return jsonResponse({ error: message }, 500)`), e `fixturesForBrtDay` propaga a mensagem crua do PostgREST (`throw new Error(error.message ...)`, lib/fixtures/repository.ts:195). Como a rota é pública (sem auth) e usa admin client, qualquer erro de banco (nomes de tabela/coluna, detalhes de schema, hints do Postgres) vaza pra qualquer um. O mesmo padrão `details: String(err)`/`error.message` aparece nas rotas ai-reco, mas lá atrás de auth gate — aqui é a única exposição anônima.


**Fix sugerido:** Responder 500 com mensagem genérica ('internal error') e logar `err` server-side (console.error → observabilidade do Worker), como já faz /api/calibracao/secondary-metrics (linhas 73-74).


<details><summary>Evidência do verificador</summary>

CONFIRMADO. (1) app/api/fixtures/route.ts:37-39 — catch faz `const message = err instanceof Error ? err.message : "internal error"` e retorna `jsonResponse({ error: message }, 500)`, sem console.error server-side. (2) lib/fixtures/repository.ts:194-196 — `fixturesForBrtDay` propaga a mensagem crua do PostgREST: `throw new Error(error.message ?? "supabase query failed")`. (3) Rota é anônima de fato: middleware.ts:21 exclui `api/*` do matcher, a rota não importa nenhum guard de auth (grep por requireAuth/getUser/getClaims em app/api/ só acha ai-reco/*, bets/export e telemetry — fixtures NÃO está na lista dos endpoints lockados em 2026-05-27), e usa `createAdminClient()` (service_role, bypassa RLS). (4) O contraste sugerido procede: app/api/calibracao/secondary-metrics/route.ts:72-74 loga via console.error e responde genérico "DB query failed". (5) Não está documentado como conhecido/aceito — docs/lessons.md menciona a rota só em B12/B21 (payload/perf), nada sobre vazamento de erro; CLAUDE.md idem. Atenuantes que mantêm a severidade em low: só `error.message` vaza (não `details`/`hint` do PostgREST, que ficam pra trás no `new Error(error.message)`), e o repo é público no GitHub (CLAUDE.md: "repo público ⇒ minutos gratuitos"), então nomes de tabela/coluna/schema já são informação pública — o vazamento residual é principalmente de estado runtime do banco, valor ofensivo baixo. Fix barato e alinhado ao padrão já existente no próprio codebase.

</details>


### [calibracao] fit-scoreline-cal: validação held-out é só log — persiste (T, δ) fitados full-sample mesmo quando 'piora out-of-sample', em cron semanal não-assistido

**Onde:** `scripts/calibracao/fit-scoreline-cal.ts:131`


O script computa a validação held-out 70/30 (linhas 124-134) mas o resultado vira apenas string de console (`heldOut = '… ⚠️ piora out-of-sample'`, linha 134) — o fluxo segue pro persist incondicional (linhas 164-175) dos params fitados em 100% da amostra. A validação que ancorou o ship do B33 ("validado held-out 1.6841→1.6802") foi manual e única; agora o script roda todo domingo via calibracao-weekly.yml (linha 75) sem ninguém lendo o log. Um refit futuro que NÃO generalize (grade T até 6.0 + δ até 0.5 dá bastante espaço pra overfit em janelas pequenas/regimes novos) será persistido e aplicado em produção via apply-on-read (simulation-repository#applyCalibration) — exatamente a classe walk-forward-bomb que o B24 tenta prevenir, só que aqui o gate existe e não está ligado.


**Fix sugerido:** Transformar o held-out em gate: se `trainFit` existe e `llCalTest > llRawTest` (com margem), pular o persist (manter os params ativos anteriores) e logar/pingar o healthcheck com aviso. Persistir o resultado held-out no payload pra auditoria no painel.


<details><summary>Evidência do verificador</summary>

CONFIRMADO. (1) fit-scoreline-cal.ts:123-135 computa o held-out 70/30 mas o resultado vira só a string `heldOut` (linha 134) impressa no console (linha 142) — nenhum branch a lê. (2) O único gate antes do persist é `if (DRY) continue;` (linha 144); linhas 164-177 inserem em `model_calibration` os (T, δ) fitados em 100% da amostra, incondicionalmente. Agravante: com n entre 30 e ~66, `test.length >= 20` falha (linha 131) e NÃO há validação nenhuma (`heldOut = "n/d"`), mas persiste mesmo assim. (3) calibracao-weekly.yml:75 roda o script sem `--dry` todo domingo, não-assistido. (4) Grade confirmada: scoreline-calibration.ts:92-93 — T_GRID 1.0…6.0, D_GRID 0.50…1.00. (5) Apply-on-read confirmado: simulation-repository.ts:267-275 (getScorelineCal → calibrateScorelines). (6) Não documentado como aceito: docs/lessons.md B33 (linha 85) cita o held-out manual único como âncora do ship, sem reconhecer que o refit semanal não tem gate. AJUSTE DE SEVERIDADE medium→low: o blast radius é menor do que a classe walk-forward-bomb sugere — a calibração é display-only (B33): reordena top_scorelines no painel; NÃO toca p_home/draw/away, isotônicas, edge calculator nem IA-2 (o runner Ruby lê top_scorelines CRU do banco em ai_recommender_runner.rb:555, fora do apply-on-read TS). Um refit ruim degrada um display consultado pelo Pilot, não um caminho automatizado de dinheiro. A sugestão de transformar o held-out em gate é válida e barata.

</details>


### [calibracao] Refit walk-forward é O(n²) com fit caro (CMP: 31 ν × bisseção de 100 iterações por jogo) — custo do cron semanal cresce quadraticamente

**Onde:** `lib/calibracao/walk-forward.ts:36`


`walkForwardParams` chama `fit(games.slice(0, i))` pra CADA i ≥ warmup — O(n²) avaliações do treino. No challenger CMP (seed-challenger-cards-cmp.ts:145 + fitNu:52-62), cada avaliação de `cmpLogLoss` refaz `findLambda` (cmp.ts:50-67: bisseção de 100 iterações, cada uma um `cmpStats` O(kmax=40)) sem nenhum cache — nada é memoizado entre os ~250 fits da janela expansiva nem entre os 31 pontos da grade de ν. Hoje (n=300 cards resolvidos) roda; mas o cron semanal acumula resolvidos continuamente — a n≈2-3k o custo multiplica ~50-100×, e o mesmo padrão existe no champion (seed-model-predictions.ts:452, 3 stats × O(n²) fits NB). Risco real de estourar o tempo do job calibracao-weekly silenciosamente nos próximos meses.


**Fix sugerido:** Refitar em passos (a cada B=25-50 jogos novos em vez de a cada jogo — mantém a propriedade out-of-sample e derruba pra O(n²/B)); pré-computar `lnFactorials` uma vez e memoizar `findLambda` por (μ arredondado, ν) dentro do fit; alternativamente limitar a janela de treino (rolling window).


<details><summary>Evidência do verificador</summary>

CONFIRMADO em todos os pontos. (1) lib/calibracao/walk-forward.ts:36 — `fit(games.slice(0, i))` pra cada i ≥ warmup dentro do for ⇒ O(n²) fits em janela expansiva. (2) scripts/calibracao/seed-challenger-cards-cmp.ts:145 chama walkForwardParams com fitNu (linhas 52-62): grade de 31 pontos de ν (0.5→2.0 passo 0.05), cada avaliação chamando cmpLogLoss por jogo de treino. (3) lib/calibracao/cmp.ts: cmpLogLoss→cmpProb→cmpPmf (linha 73-78) reconstrói lnFactorials(40) a CADA chamada e roda findLambda (linhas 50-67: guard + exatamente 100 iterações de bisseção, cada uma um cmpStats O(kmax=41)) — zero memoização entre fits, entre pontos de ν ou pra (μ,ν) repetidos. (4) Champion idem: seed-model-predictions.ts:452 (walkForwardParams+fitR, grade de 11 r via nbLogLoss) × 3 stats nas linhas 491-493 (cards/corners/sot). (5) Ambos os scripts rodam toda semana no .github/workflows/calibracao-weekly.yml (steps 'Seed champion predictions' e 'Seed challenger (cards CMP)'), timeout-minutes: 20; o dataset acumula de fato (model_predictions é forward-only por design ADR-011; fixture_simulations sem FK cascade — migration 0018/ADR-006; n já foi 90→300). A n≈2-3k o custo do CMP escala ~50-100× e pode colidir com o timeout de 20min em meses. (6) NÃO está documentado como conhecido/aceito: docs/lessons.md B35/B37 documentam a metodologia walk-forward (fairness/leakage), nunca o custo computacional; nada no CLAUDE.md. Mitigantes que justificam manter severidade low: job semanal fora do caminho de usuário, healthcheck fail-ping opcional existe, bump de model_version reseta n, checkpoint da arena em 17/06 pode remover o step do CMP rejeitado (B37), e os fixes sugeridos são baratos.

</details>


### [calibracao] Linhas de champion antigo permanecem em model_predictions após bump de model_version — comparador assume champion único

**Onde:** `scripts/calibracao/compare-models.ts:181`


`seed-model-predictions` semeia só a versão ativa (`activeChampionVersion`, linha 478-485) mas nunca remove/desmarca linhas antigas com `is_champion=true` de versões anteriores (upsert é keyed por fixture_id+model_version+market — um bump de v7→v8 deixa as linhas v7 intactas). Os consumidores assumem champion único: compare-models.ts:181 `champRows[0]!.model_version` e page.tsx:568-569 `champVersions[0]` rotulam com a primeira versão que aparecer, e o `champMap` (compare-models.ts:214, page.tsx:580) mistura log_loss de versões diferentes no pareamento e no log-loss médio do baseline. Hoje é benigno (só v7 existe), mas detona na primeira evolução generativa já planejada ("bump gols NegBin" citado em B33) — o baseline da arena viraria uma quimera v7+v8, violando a regra B36 de que o baseline tem que ser o modelo de produção real.


**Fix sugerido:** No seed, após determinar o champion ativo, desativar as linhas órfãs (`UPDATE model_predictions SET is_champion=false WHERE is_champion AND model_version != champion`), ou filtrar nos consumidores por uma única model_version ativa e logar warning se houver mais de uma com is_champion=true.


<details><summary>Evidência do verificador</summary>

CONFIRMADO. (1) seed-model-predictions.ts:478-485 semeia só a versão ativa, com is_champion:true hardcoded (linhas 85/143) e upsert keyed em fixture_id+model_version+market (linha 364) — não existe DELETE nem UPDATE is_champion=false em nenhum script de calibração (grep vazio), então um bump v7→v8 deixa as linhas v7 com is_champion=true intactas. (2) Consumidores assumem champion único exatamente como descrito: compare-models.ts:181 (champRows[0]!.model_version como rótulo), :182 (champLL média mistura versões), :213-214 (champMap keyed só por fixture:market — mistura versões no pareamento, last-write-wins em colisão); page.tsx:568-569 (champVersions[0]) e :580 (champMap idêntico). Nenhum warning se houver >1 versão champion. (3) Caminho vivo: calibracao-weekly.yml:85 e :99 rodam seed+compare toda semana — a quimera materializaria automaticamente no primeiro bump. (4) Não documentado como conhecido/aceito: docs/lessons.md B34-B39 e CLAUDE.md não mencionam o gap; o comentário do seed (linhas 475-477) trata versões antigas em fixture_simulations, não linhas já persistidas em model_predictions. B36 exige baseline = modelo de produção real e B39 já agenda o trigger (challenger gols-NegBin → eventual promoção/bump). Latente hoje (só v7 existe), fix trivial → severidade low se sustenta.

</details>


### [frontend-rsc] Bilhete: input de stake dispara uma Server Action (auth + write + revalidatePath) a cada keystroke

**Onde:** `app/(dashboard)/bilhete/_components/bet-slip-page-client.tsx:118`


`handleStakeChange` está ligado direto ao `onChange` do `<input type="number">` (:255) e, para cada caractere digitado com valor parseável, chama `await updateSlipStake(slip.id, value)` (:134-136). A action (lib/bet-slip/actions.ts:218-238) faz `auth.getUser()` (round-trip de Auth), `_recalculateSlip` (UPDATE no Postgres) e `revalidatePath("/bilhete")` — tudo isso por tecla. Digitar "150.50" gera até 5 mutações seriais no Worker+Supabase, persistindo estados intermediários (stake=1, 15, 150…) no draft. Funciona (Next serializa actions por cliente e o estado final converge), mas é write amplification desnecessária no fluxo de aposta e adiciona latência perceptível em conexão móvel.


**Fix sugerido:** Persistir no `onBlur` (ou debounce de ~500ms) mantendo o cálculo de retorno potencial 100% local no `onChange` — o estado otimista local já existe (`setSlip`), então a única mudança é mover a chamada `updateSlipStake` para o commit do campo. Remover o `revalidatePath` por digitação (o commitSlip já revalida).


<details><summary>Evidência do verificador</summary>

CONFIRMADO linha a linha. (1) app/(dashboard)/bilhete/_components/bet-slip-page-client.tsx:255 — o `<input type="number">` de stake tem `onChange={handleStakeChange}` direto, sem debounce/onBlur. (2) handleStakeChange (linhas 118-137) faz o update otimista local via `setSlip` e, em seguida (linhas 134-136), `if (slip && value != null) { await updateSlipStake(slip.id, value); }` — ou seja, toda alteração com valor parseável >0 dispara a Server Action; digitar "150.50" gera de fato chamadas para 1, 15, 150, 150.5 (o "." sozinho não muda o parse). (3) lib/bet-slip/actions.ts:218-238 — `updateSlipStake` faz `supabaseRaw.auth.getUser()` (round-trip de Auth — coerente com a regra B22 de que Server Actions de escrita mantêm getUser), `_recalculateSlip(...)` (UPDATE em bet_slips) e `revalidatePath("/bilhete")`, tudo por tecla. Não há mitigação em lugar nenhum: `grep -rn "debounce|onBlur"` no diretório do bilhete retorna vazio. Não está documentado como conhecido/aceito: docs/lessons.md não menciona o padrão (B22/B32/B39 são outros assuntos) e a única referência a `updateSlipStake` em docs é a listagem da action no plano docs/superpowers/plans/2026-05-26-ux-overhaul.md:123, sem discutir frequência de chamada. O achado também é honesto sobre o impacto: estado final converge (actions serializadas por cliente + último valor vence), app é single-user, e a rota /bilhete é de baixa frequência — é write amplification + latência em mobile, não corrupção de dados nem custo material. Severidade "low" é a correta.

</details>


### [reconcilers-ai] Reconciler descarta gols JÁ conhecidos ao marcar unresolvable (stale com stat secundário ausente)

**Onde:** `scripts/scraper/lib/scraper/ai_recommendation_reconciler.rb:127`


Quando uma reco 'bet' de mercado secundário tem actuals de GOLS disponíveis mas o stat secundário sumiu da janela de recent_results (`won.nil?` na linha 127) e a linha já está stale, `mark_stale` → `mark_unresolvable` (linhas 136-146) seta APENAS `status='unresolvable'` — os `actual_home_goals/away_goals` que acabaram de ser buscados na API são jogados fora. O mesmo vale pro branch da linha 107. Essas linhas viram os "~38 travados reais" do B27 sem nem o placar registrado, empobrecendo qualquer análise posterior (ex.: re-resolve via bin/reresolve_secondary_markets, auditorias de cobertura) que poderia ao menos usar os gols.


**Fix sugerido:** Em `mark_unresolvable`/`mark_stale`, quando `actuals` existir, persistir `actual_home_goals`, `actual_away_goals` e `actual_resolved_at` junto com o status 'unresolvable' (bet_won/pl_units seguem NULL). Mudança pequena, idempotente, e deixa o dado recuperável pra reprocessamento futuro.


<details><summary>Evidência do verificador</summary>

CONFIRMADO no núcleo, com uma ressalva. Evidência em scripts/scraper/lib/scraper/ai_recommendation_reconciler.rb: na linha 102-103 o widget é buscado e `actuals` montado; nas linhas 111-112 `home_goals`/`away_goals` já estão em mãos; quando `won.nil?` (linha 126, mercado secundário sem stat) e a linha está stale, o fluxo cai em `mark_stale` (136-139) → `mark_unresolvable` (141-146), cujo UPDATE seta APENAS `status='unresolvable'` — os gols recém-buscados são descartados (contraste com `mark_resolved_skip`/`mark_resolved_bet`, linhas 148-177, que persistem `actual_home_goals/away_goals/actual_resolved_at`). RESSALVA que enfraquece parte do achado: o branch da linha 107 NÃO descarta nada — ali `actuals.nil?` (linha 105), ou seja, não há gols conhecidos pra perder; só o branch da 127 tem o efeito descrito. Não está documentado como aceito: docs/lessons.md B27 (linha 73) menciona os "~38 travados reais" como lacuna de cobertura de actuals (follow-up aberto), mas não menciona/aceita o descarte dos gols no caminho unresolvable. O impacto é real porém pequeno: linhas unresolvable são dead-end (bet_won/pl_units NULL, fora de ROI/Brier), e o próprio `bin/reresolve_secondary_markets` só re-processa linhas `status='resolved'` (não unresolvable), então os gols perdidos só empobrecem auditorias futuras — agravado pela retenção ~3-4 dias de fixtures, que torna o dado dificilmente recuperável depois. Severidade low é honesta.

</details>


### [security] place_bet não valida ownership do house_id — FK bypassa RLS e permite referência cross-tenant

**Onde:** `supabase/migrations/0006_bet_rpcs.sql:56`


O RPC `place_bet` (e a versão vigente em 0041_place_bet_free_bet.sql:39-68) só checa `house_id is not null` (0006:67-68); nunca verifica que a casa pertence a `auth.uid()`. O RPC é `security invoker`, mas validação de FK no Postgres roda com privilégio do dono da tabela e NÃO passa pelo RLS de `houses` — então um usuário autenticado pode inserir `bets` e `transactions` apontando para o `house_id` de OUTRO usuário (UUID adivinhado/vazado), poluindo a integridade referencial multi-tenant do ledger. No MVP single-user o impacto prático é nulo, mas o projeto declara multi-tenant via RLS como invariante, e o endpoint /api/ai-reco/apostei já faz essa checagem corretamente no app layer ('404 ... casa de outro user'), confirmando que a regra existe mas não está no RPC — o único lugar que a garante transacionalmente.


**Fix sugerido:** Na próxima migration NNNN, recriar place_bet adicionando após o null-check: `perform 1 from public.houses where id = v_house_id and user_id = v_user; if not found then raise exception 'house not found' using errcode = 'P0002'; end if;` (mesma classe de guard que resolve_bet já faz com `where id = p_bet_id and user_id = v_user`).


<details><summary>Evidência do verificador</summary>

CONFIRMADO em todas as versões do RPC. Evidência: (1) supabase/migrations/0041_place_bet_free_bet.sql:49-51 (versão vigente) e 0006_bet_rpcs.sql:67-69 — único guard sobre house é `IF v_house_id IS NULL THEN raise 'house_id is required'`; nenhuma das 4 definições (0006, 0027, 0040, 0041) verifica `houses.user_id = auth.uid()` (grep por ownership em 0027/0040 vazio). (2) O RPC insere bets (0041:82-91) e transactions (0041:114-122) com user_id = v_user, então o RLS WITH CHECK `auth.uid() = user_id` (0001_init.sql:283-313) passa; a única amarração ao house é a FK `references public.houses(id)` (0001:105, 0001:169), e validação de FK no Postgres roda com privilégio do dono da tabela, não passando pelo RLS de houses — logo um authenticated pode referenciar house_id de outro tenant se souber o UUID. (3) O contraste citado existe: resolve_bet faz o guard correto `where id = p_bet_id and user_id = v_user` (0006:184-191), e /api/ai-reco/apostei valida ownership no app layer (app/api/ai-reco/apostei/route.ts:157-178, comentário explícito "must belong to the user (RLS already enforces...)" e doc ":36 404 ... casa de outro user") — confirmando que a regra é reconhecida mas ausente no único caminho transacional. (4) NÃO está documentado como conhecido/aceito: grep por house_id/place_bet em docs/lessons.md sem matches; CLAUDE.md e MEMORY.md não mencionam (a pendência CRO de "balance CHECK + UNIQUE tx" é outra coisa). Severidade: low é honesta — exige usuário autenticado (hoje só Pilot + e2e@rnobre.dev), UUID v4 da casa alheia adivinhado/vazado, e o efeito é poluição referencial nos PRÓPRIOS rows do atacante (não lê nem altera dados da vítima; on delete restrict da FK pode no máximo impedir a vítima de deletar a casa).

</details>


### [security] Nenhum header de segurança HTTP no app (CSP, HSTS, X-Frame-Options, nosniff)

**Onde:** `next.config.ts:13`


O `nextConfig` não define `headers()` (next.config.ts:13-23) e o `public/_headers` do CF Workers Assets só contém o Cache-Control do favicon (B21). Não há Content-Security-Policy, Strict-Transport-Security, X-Frame-Options/frame-ancestors nem X-Content-Type-Options em lugar nenhum do repo. Para um app que gerencia dinheiro com sessão em cookies do @supabase/ssr (que são legíveis por JS — não httpOnly), a ausência de CSP significa que qualquer XSS futuro (ex.: render de dados do choistats/LLM) rouba a sessão inteira; sem frame-ancestors o app é clickjackable; HSTS depende só do default do Cloudflare.


**Fix sugerido:** Adicionar `headers()` no next.config.ts com `Strict-Transport-Security`, `X-Frame-Options: DENY` (ou CSP frame-ancestors 'none'), `X-Content-Type-Options: nosniff` e uma CSP inicial em Report-Only para calibrar antes de enforce (atenção ao inline do Next — usar nonce ou 'unsafe-inline' documentado). Lembrar que para static assets vale o `public/_headers`, não o headers() (lição B21).


<details><summary>Evidência do verificador</summary>

Confirmado. next.config.ts:13-23 não define headers() (só reactStrictMode + optimizePackageImports); public/_headers contém apenas Cache-Control do /favicon.ico (B21); grep repo-wide por content-security-policy|strict-transport|x-frame-options|frame-ancestors|nosniff = zero ocorrências em código/config; middleware.ts e lib/supabase/middleware.ts não setam nenhum header de segurança (só refresh de sessão). Não está documentado como conhecido/aceito em docs/lessons.md, CLAUDE.md ou docs/adrs/ (grep vazio). A premissa dos cookies @supabase/ssr legíveis por JS (não httpOnly, por design do browser client) é correta, então a ausência de CSP de fato deixa qualquer XSS futuro com acesso à sessão, e sem frame-ancestors/X-Frame-Options o app é frameable. Severidade "low" é adequada: app single-user atrás de auth, HTTPS via Cloudflare mesmo sem HSTS explícito, e trata-se de defesa-em-profundidade ausente, não vulnerabilidade diretamente explorável hoje.

</details>


### [sim-engine] λ extremo produz matriz toda-zero que vira p_away=1.0 'confiante' persistido (sem clamp de λ nem guarda pós-normalização)

**Onde:** `scripts/scraper/lib/scraper/simulation/score_model.rb:53`


`normalize!` faz `return matrix if total.zero?` devolvendo a matriz toda-zero em vez de sinalizar erro (score_model.rb:53-58). Com λ grande o bastante pra `Math.exp(-lambda)` underflow (λ≳745, possível com avgs lixo do choistats — `Rates.lambdas` só checa `finite_positive?`, sem teto, rates.rb:58-60), a PMF inteira zera. O CDF do Monte Carlo fica todo 0.0 e `sample_scoreline` cai sempre no fallback `cdf.last` ⇒ (10,10) em 100% das iterações (monte_carlo.rb:91-96) ⇒ persiste `p_away=1.0, p_over_25=1.0, top_scoreline '10-10' prob 1.0` com status 'pending' — lixo com cara de certeza absoluta, que entra no edge-calculator e na calibração. Mesmo sem underflow, λ>8-10 perde massa real de cauda no truncamento MAX_GOALS=10 e a renormalização redistribui silenciosamente.


**Fix sugerido:** Clampar λ em `Rates.lambdas` a um teto sanitário (ex.: 6.0, registrável) e/ou em `ScoreModel.matrix` retornar nil/raise quando `total` ficar abaixo de um epsilon, fazendo o Runner degradar pra 'unsimulable' em vez de persistir certeza fabricada.


<details><summary>Evidência do verificador</summary>

CONFIRMADO no código com 1 correção factual. (1) score_model.rb:53-58: `normalize!` retorna a matriz toda-zero quando `total.zero?` — sem erro/sinalização. (2) rates.rb:60+78-80: `lambdas` só checa `finite_positive?` (finito, >0), sem teto de λ. (3) score_model.rb:43: `Math.exp(-lambda)` underflowa pra 0.0 com λ≥~746 e a PMF inteira zera (construção iterativa multiplica a partir de pmf[0]). (4) monte_carlo.rb:91-96: CDF todo 0.0 ⇒ fallback `cdf.last` = (10,10) em ~100% das iterações (r=rng.rand∈[0,1) quase nunca é ≤0.0). (5) runner.rb:80-101: nenhuma exceção ocorre, o `rescue StandardError→unsimulable` não captura; persiste `status:'pending'`. CORREÇÃO: (10,10) é EMPATE — persiste p_draw=1.0 (+p_btts=1.0, p_over_25=1.0, top '10-10' prob 1.0), NÃO p_away=1.0 como diz o título (monte_carlo.rb:46-49: hg==ag ⇒ draws). Não documentado como conhecido: grep em docs/lessons.md e CLAUDE.md por lambda/clamp/underflow não acha nada relacionado. SEVERIDADE ajustada medium→low: gatilho exige λ≥~746 ⇒ avgs choistats na casa de CENTENAS de gols/jogo (fonte real produz ~1-4; shrinkage rates.rb:66-75 atenua small-n ainda mais); o ponto secundário (truncamento MAX_GOALS=10 com λ>8-10) também exige avgs ≥~7 gols/jogo. Defeito latente real (clamp sanitário em Rates e/ou guarda epsilon em normalize! são fixes baratos e corretos), mas probabilidade prática de disparo ~nula.

</details>


### [sim-engine] Sorteios por tempo (h1/h2) usam a dispersão de jogo inteiro e são independentes do total — p_both_2corners_both_halves e percentis _1h/_2h inconsistentes

**Onde:** `scripts/scraper/lib/scraper/simulation/monte_carlo.rb:128`


`sample_secondary` sorteia `total`, `h1` e `h2` como três NB independentes, reutilizando o MESMO `cfg[:dispersion]` (r ajustado na série de TOTAIS de jogo) para as médias de meio-tempo (monte_carlo.rb:131-135; cfg montado em runner.rb:200-206). Consequências: (1) dentro de uma iteração h1+h2 não soma o total sorteado, então os percentis `p10/p50/p90` vs `*_1h/*_2h` persistidos no mesmo sim_stats podem ser conjuntamente impossíveis; (2) aplicar r de jogo-inteiro à média de meio-tempo deturpa a overdispersão por tempo; (3) `compute_both_2corners_both_halves` (monte_carlo.rb:396-417) — escalar que rankeia o scan 'escanteios-ambos-tempos' shipado — herda essas duas distorções e ainda assume independência entre tempos (ignora correlação de ritmo de jogo), enviesando a probabilidade conjunta.


**Fix sugerido:** Sortear h1 e h2 e derivar total = h1 + h2 (consistência interna de graça), estimando dispersão por tempo quando houver série (ou r/2 como aproximação documentada). Validar o impacto comparando p_both_2corners_both_halves antes/depois nos actuals já reconciliados.


<details><summary>Evidência do verificador</summary>

CONFIRMADO no código real, com uma ressalva de enquadramento. (1) Mecanismo exato confirmado: `scripts/scraper/lib/scraper/simulation/monte_carlo.rb:131-135` — `sample_secondary` faz TRÊS draws NB independentes (`:total`, `:h1`, `:h2`) reutilizando o mesmo `cfg[:dispersion]`; e `runner.rb:192-209` (`corner_cfg`) monta `mean_1h`/`mean_2h` com UMA única `dispersion` estimada da série de totais de jogo (`SecondaryStats.dispersion_from(recent.map { |m| m[field] })`, linha 198). Como Var=μ+μ²/r (secondary_stats.rb:7), aplicar o r de jogo-inteiro às médias de meio-tempo de fato altera a razão de overdispersão por tempo, e a soma h1+h2 tem distribuição diferente do draw de total (variância menor) — inconsistência interna real. (2) `compute_both_2corners_both_halves` (monte_carlo.rb:396-417) conta a interseção por iteração sobre esses draws independentes, então a "probabilidade conjunta" é na prática produto de marginais — sem correlação tempo×tempo nem casa×fora — confirmado. (3) NÃO está documentado como conhecido nos pontos específicos: a pesquisa (docs/pesquisas/simulacao-pre-jogo-fixtures.md §122 e limitação 7/§247-248) documenta e aceita como YAGNI a independência ENTRE métricas (cópula como melhoria futura), mas não cobre explicitamente o total≠h1+h2 dentro da iteração nem o reuso do r de jogo-inteiro pros meios-tempos; docs/lessons.md e CLAUDE.md não mencionam. Ressalvas que mantêm a severidade em low: (a) a frase "percentis conjuntamente impossíveis" é exagerada — percentis são estatísticas marginais e nem com total=h1+h2 eles somariam; o problema real é coerência de modelo, não contradição lógica dura; (b) o impacto é contido por design documentado: `p_both_2corners_both_halves` e os percentis _1h/_2h são ranking/display-only, explicitamente FORA de calibração/ROI/Brier (docs/tasks/pre-match-scans/00-plan.md linhas 14-15 e 27 — a fórmula implementada é exatamente a spec aprovada pelo Pilot), e os p_* primários (1x2/over/btts) vêm do score model, não desses draws. Achado se sustenta como dívida de modelo de baixa severidade; a sugestão (h1+h2→total, dispersão por tempo) é tecnicamente correta.

</details>


### [sim-engine] Acumulador de player_events chaveado só pelo nome — jogadores homônimos (inclusive em times opostos) são fundidos num único registro

**Onde:** `scripts/scraper/lib/scraper/simulation/monte_carlo.rb:203`


`init_player_acc` e `allocate_players` usam `acc[name]` com o nome como chave global única (monte_carlo.rb:203-238), e `aggregate_players` (241-265) emite um item por nome com `provavel_titular`/`confidence` do ÚLTIMO lado enumerado. Dois jogadores com o mesmo display name ('Danilo', 'Rodri' — comum em futebol) nos dois XIs têm goals/cards/sot somados num registro só, inflando p_goal/expected_goals e atribuindo eventos do time errado. O F10 agrava: `odds_by_player` em runner.rb:287-295 também é Hash por nome, então a odd anytime-scorer de um homônimo vaza pro outro.


**Fix sugerido:** Chavear o acumulador por `[side, name]` (e o `odds_by_player` idem), mantendo o nome só no output. Spec de regressão: dois players 'Danilo' em home e away devem gerar duas entradas distintas em player_events.


<details><summary>Evidência do verificador</summary>

CONFIRMADO. scripts/scraper/lib/scraper/simulation/monte_carlo.rb: init_player_acc (203-213) itera each_player sobre home E away e chaveia `acc[name]` pelo nome puro — homônimos cross-team colidem num registro só. allocate_players (215-238) incrementa `acc[name]` por side, fundindo goals/cards/sot dos dois times; como scored_this_iter é por-side (222-230), o registro fundido pode somar scored_iter 2×/iteração, podendo até produzir p_goal>1.0. aggregate_players (241-265) emite 1 item por nome e conf[name] (linha 250) fica com o último lado enumerado (away), como o achado afirma. F10: runner.rb extract_anytime_scorer_odds (287-295) é Hash global por nome e build_players (270-274) passa o mesmo hash pros dois lados (side_players 322-324 anexa por nome) — vazamento cross-side real, com atenuante de que o payload choistats outcome_odds_by_player já é keyed por nome. NÃO documentado: grep por homônimo/colisão em docs/lessons.md, CLAUDE.md e docs/pesquisas/simulacao-pre-jogo-fixtures.md vazio; a lição conhecida de "player-name keying" é sobre símbolo/string, outra classe. Severidade low mantida: player_events só alimenta a camada display de provável escalação no sim_stats (monte_carlo.rb:69); mercados apostáveis usam Poisson time-level e a odd anytime-scorer é âncora de validação, não input (ADR-006); homônimo exato cross-XI é raro.

</details>


### [sim-engine] expected_minutes trata super-sub como titular de 90min: apps aproximado por `started` com piso 1 explode minutos/jogo de quem nunca foi titular

**Onde:** `scripts/scraper/lib/scraper/simulation/player_allocation.rb:96`


`expected_minutes` calcula `per_game = minutes / max(started, 1)` (player_allocation.rb:96-103). Para um suplente com started=0 e, ex., 300 minutos somados em 15 entradas, per_game = 300/1 = 300, clampado pra 90 — o cap silencioso esconde o erro e o jogador recebe peso de titular full-match em `event_weight` (rate × expected_minutes, linha 77), inflando p_goal/p_card/p_sot de super-subs versus titulares reais. O comentário admite a aproximação ('subs add little volume'), mas com started=0 a divisão não aproxima nada — degenera, e o clamp para FULL_MATCH_MINUTES mascara o caso.


**Fix sugerido:** Usar o número real de aparições se o payload tiver (apps/appearances); senão, pelo menos `apps = max(started, minutes/90.0, 1)` pra impedir per_game>90 vindo de started=0, em vez de depender do clamp pra esconder o degenerate case.


<details><summary>Evidência do verificador</summary>

CONFIRMADO. scripts/scraper/lib/scraper/simulation/player_allocation.rb:96-102: `apps = [numf(get(p,'started')), 1.0].max; per_game = minutes / apps; [per_game, FULL_MATCH_MINUTES].min`. Com started=0 e minutes=300, per_game=300 → clamp pra 90, dando a um sub (~20 min/jogo reais) expected_minutes de titular; event_weight (linha 77, rate × expected_minutes) infla ~4.5× nesse exemplo. O clamp mascara o caso degenerado exatamente como descrito. Não há spec cobrindo started=0 com minutes>0 (player_allocation_spec.rb usa started≥1 nos subs) e o caso NÃO está documentado em docs/lessons.md nem CLAUDE.md (ADR-006 só descreve a projeção em geral). Atenuantes que sustentam severidade low: (1) allocate_event só roda sobre o probable_xi (monte_carlo.rb:224-235; runner.rb:327), e um started=0 tem titularity_score = minutes/90 apenas (linha 61, ex. 3.33 vs 15-30 de titulares), então raramente entra no XI — o bug só se manifesta em roster fino/dados esparsos; (2) o efeito atinge apenas a camada por-jogador do sim_stats (projeção display "provável escalação"), não os p_* de time nem o edge calc da IA-2/mercados apostáveis. Achado correto em mecânica, exposição condicional — low é honesto.

</details>


### [tests-ci] Seed E2E escreve no banco de PROD sem cleanup resiliente — falha no meio do teste vaza bet_slip_legs

**Onde:** `tests/e2e/bet-slip-photo.spec.ts:336`


O teste de fluxo cria um draft slip + seed leg no Supabase de produção via service role (`seedDraftSlip`, linha 289) e só remove a leg na última linha do corpo do teste (`await cleanupSeedLeg(seedResult!.legId)`, linha 336). Qualquer `expect` que falhe entre os passos 3 e o final (há ~10 asserts no caminho) aborta o teste antes do cleanup — a leg órfã fica no bet_slip do usuário E2E em prod e contamina os runs seguintes (o FAB/contador de legs passa a refletir lixo acumulado, gerando flakiness e falsos positivos no próprio assert de visibilidade do FAB).


**Fix sugerido:** Mover o cleanup pra um `test.afterEach` (ou try/finally) que delete todas as legs/slips criadas, trackeando os IDs num array no escopo do describe; alternativamente deletar por marcador (note/label "e2e-seed") pra varrer órfãs de runs anteriores no beforeEach.


<details><summary>Evidência do verificador</summary>

CONFIRMADO no mecanismo central: tests/e2e/bet-slip-photo.spec.ts:289 insere leg real em bet_slip_legs no Supabase de prod via service role, e o cleanup (linha 336, cleanupSeedLeg) é a última linha do corpo do teste, sem try/finally nem test.afterEach — qualquer expect falho entre as linhas 294-333 (~10 asserts) vaza a leg órfã. Não está documentado como aceito em docs/lessons.md (sem menção) nem no CLAUDE.md (só diz que write-tests são skip-guardados, o que não impede a escrita quando as secrets existem); o comentário no header do próprio spec (linhas 21-22, "legs em draft não afetam outros testes") é nota de intenção, não aceite canônico. PORÉM o efeito descrito é exagerado: (a) o usuário E2E é dedicado e RLS-isolado (e2e@rnobre.dev) — órfãs só sujam o draft slip dele; (b) só este spec usa bet_slip_legs/FAB (grep em tests/e2e/), sem contaminação cross-spec; (c) o "falso positivo no assert do FAB" é improvável — o assert (linha 298) só roda após seed fresco bem-sucedido (test.skip(!seedResult), linha 290) e o teste nunca asserta contagem de legs; (d) hoje o teste skipa inteiro em CI (kill switch ai_enabled=false em prod, guard linhas 277-280). Agravante não citado: até em run VERDE as 2 mock legs commitadas no passo 11 nunca são limpas (só a seed leg) — o .first() da linha 321 já é cicatriz de acúmulo. Defeito real de higiene de teste, impacto contido → low.

</details>


### [tests-ci] Gate de cobertura prometido pelas regras do projeto não existe em lugar nenhum

**Onde:** `vitest.config.ts:7`


As regras do projeto (CLAUDE.md/akita-xp: 'Bloquear merge se qualquer teste falhar ou cobertura cair abaixo do threshold definido') prometem gate de cobertura, mas vitest.config.ts não tem bloco `coverage` algum e o ci.yml roda `pnpm test` sem `--coverage` (linha 40). Não é nitpick de número: sem medição, gaps como o do achado 3 (ledger SQL) e módulos novos sem teste entram silenciosamente — o gate declarado simplesmente não bloqueia o que diz bloquear.


**Fix sugerido:** Habilitar `coverage: { provider: "v8", thresholds: {...} }` no vitest.config.ts com thresholds realistas e escopados aos diretórios de dinheiro/calibração (lib/banca, lib/bets, lib/bet-slip, lib/calibracao, lib/ai-reco), e rodar `pnpm test -- --coverage` no job build do CI.


<details><summary>Evidência do verificador</summary>

Confirmado: vitest.config.ts:5-23 não tem bloco `coverage`; .github/workflows/ci.yml:40 roda `pnpm test` (= `vitest run`, package.json:11) sem `--coverage`; pnpm-lock.yaml não contém nenhum provider @vitest/coverage-*; nenhum workflow mede cobertura; o scraper Ruby não tem SimpleCov. A promessa existe nas regras do projeto (~/.claude/CLAUDE.md, Regra 2 item 8: "Bloquear merge se ... cobertura cair abaixo do threshold definido", referenciada pelo CLAUDE.md do projeto via skill akita-xp-rules). Não está documentado como conhecido/aceito: grep por cobertura/coverage em docs/lessons.md e CLAUDE.md só retorna usos não relacionados (skip-coverage da IA, cobertura de árbitro/actuals). Nuance: nenhum threshold foi "definido", mas tampouco há medição alguma — o gate declarado não existe. Severidade low mantida: gap de processo, não bug de runtime; os demais gates (lint, typecheck, testes, build, E2E) existem e bloqueiam merge.

</details>


---

## Refutados pelo crivo adversarial (não são problemas reais)


- **[scraper-core] Mudança de horário do jogo (kickoff_utc) órfã a linha antiga de fixture_simulations em status pending pra sempre** — O MECANISMO de duplicação existe, mas o EFEITO central do achado ("pending pra sempre", inflando o silent-death detector indefinidamente) é falso — o SimulationReconciler dá fim à linha antiga em ≤4 dias. Evidência: (1) Mecanismo confirmado: PRECHECK_SQL/DELETE_PRIOR_SQL incluem `kickoff_utc IS NOT DISTINCT FROM $4` no predicado de identidade (scripts/scraper/lib/scraper/orchestrator.rb:99-148), e o kickoff é recomputado a cada scrape (orchestrator.rb `build_params`/`skip_simulation?` via `UkTimeHelper.to_utc_or_noon`); se o horário muda entre scrapes, o precheck não acha a linha antiga, o DEL


- **[calibracao] Walk-forward ordenado por actual_resolved_at (timestamp do reconciler em batch), não por kickoff — leakage intra-lote e params não-determinísticos** — O achado erra o mecanismo central. (1) A ordem intra-lote NÃO é arbitrária: o reconciler seleciona pendentes com ORDER BY kickoff_utc ASC (scripts/scraper/lib/scraper/simulation_reconciler.rb:71-80) e processa sequencialmente (`pending_rows.each`, linha 47). (2) Os timestamps NÃO são (quase) idênticos: DB.with_connection (scripts/scraper/lib/scraper/db.rb) usa PG.connect sem transação envolvente — cada UPDATE é autocommit, logo `now()` (transaction timestamp) é distinto por linha, e ainda há um fetch HTTP por linha entre updates (simulation_reconciler.rb:122) espaçando-os por segundos. Resulta


- **[security] Server Action de OCR sem auth gate e que BYPASSA o kill switch de IA para chamadas anônimas** — Fatos parciais conferem, mas o efeito central alegado — "atacante NÃO autenticado pode invocar Gemini Vision ignorando o kill switch" — não se sustenta no caminho descrito. (1) É verdade que `parseBetSlipPhoto` (lib/bet-slip-ocr/parse-photo-action.ts:53) não chama `auth.getUser()`, e que `isAiEnabled` falha-aberto (lib/settings/ai-toggle.ts:41 `if (error || !data) return true`) com RLS `to authenticated` (supabase/migrations/0050_app_settings.sql:31-32). (2) Porém um anônimo não consegue EXECUTAR a action: Server Actions só são executáveis via POST a uma página cujo manifest registra aquele ac


- **[tests-ci] Lógica SQL do ledger (place_bet/resolve_bet, payout de free bet) sem nenhum teste executável — todos os testes mockam o RPC** — O fato técnico confirma: supabase/migrations/0042_resolve_bet_free_bet.sql:63-82 tem o payout de free bet (won = ROUND(stake*(odds-1),2), void/lost = 0); tests/unit/free-bet-place-action.test.ts:13-27 mocka o rpc inteiro; 17/19 arquivos de tests/integration/ fazem vi.mock("@/lib/supabase/server") em happy-dom; não há pgTAP/testcontainers/supabase db start em workflows nem package.json; E2E write-tests são skip-guardados (tests/e2e/disciplina-stop-loss.spec.ts:35,56). PORÉM a lacuna já está documentada como conhecida/aceita: docs/lessons.md:43 (Lição B13, 2026-05-18) registra "Harness SQL para 


- **[infra-workflows] Race de cron: ai-reco (10:45) pode rodar antes do scrape-daily (10:00) terminar — e o silent-death detector fica cego nesse cenário** — A parte factual básica confere (acoplamento só por relógio: ai-reco.yml:13 `45 10 * * *`, scrape-daily.yml:8 `0 10 * * *`, timeout 20min em scrape-daily.yml:21), mas a consequência central do achado — "as sims ainda não existem porque o scrape não as gravou, o detector fica cego e o dia perde o batch inteiro silenciosamente" — não se sustenta no código real. (1) O scrape coleta 7 dias à frente, não só o dia corrente: `DEFAULT_DAYS_AHEAD = 7` em scripts/scraper/lib/scraper/api_list_fetcher.rb:16, usado pelo orchestrator (orchestrator.rb:372) sem filtro de liga em prod; o SimulationHook simula t
