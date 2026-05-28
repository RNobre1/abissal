---
tipo: pesquisa
titulo: "Linguagem do scraper+API e plataforma de hospedagem para Adam Stats"
status: completed
metodologia_tier: L2
source_diversity: 21
primary_source_ratio: 0.76
citation_density: 0.93
triangulation_coverage: 0.79
latency_min: 38
evidence_grades:
  primary_claim: A
  secondary_claim: B
autor: pilot+claude+researcher
criado: 2026-05-11
relacionado:
  - CLAUDE.md
  - .poc/scraper-test/
tags: [research, stack, hosting, scraper, playwright, postgres, nodejs, typescript]
---

# Linguagem do scraper+API e plataforma de hospedagem para Adam Stats

## 1. Context

O Adam Stats é uma ferramenta web pessoal de análise de jogos via IA: scraper diário em `adamchoi.co.uk` (página AngularJS de fixtures), Postgres como armazenamento, API consumida por front React/TS, análise via OpenRouter (`deepseek/deepseek-v3.2`). Dev solo, 1 usuário, baixíssimo tráfego, retenção 3-4 dias, Linux Fedora local com SELinux, domínio Cloudflare já existente, orçamento alvo €10/mês.

Decisões já trancadas e fora do escopo desta pesquisa: React+TS+Vite no frontend, Postgres como DB, Playwright como engine de scraping, OpenRouter como provedor LLM. Permanecem em aberto **(a) linguagem do scraper+API** e **(b) plataforma de hospedagem**. Errar essas decisões implica retrabalho de 20-40h e/ou custo recorrente desnecessário, justificando o ciclo formal.

Esta é a **versão 0.3** do estudo. A v0.1 foi reprovada pelo `research-critic` (4 blocking, 11 must-fix, vieses de cherry-picking e gold-fence). A v0.2 endereçou esses findings mas introduziu novo blocking + 5 must-fix. A v0.3 corrige tudo isso. Também foi executado um **POC empírico** (`.poc/scraper-test/`, 2026-05-10) que demonstrou que adamchoi.co.uk **não dispara Cloudflare anti-bot** contra Playwright headless com UA realista, eliminando todo o argumento "precisamos de browser-as-a-service para contornar challenge".

## 2. Central question

Dado o stack travado (React+TS+Vite + Postgres + Playwright + OpenRouter) e o perfil (1 dev, 1 user, €10/mês alvo, Linux Fedora + Cloudflare DNS, metodologia Akita/XP), **qual combinação `{linguagem do scraper+API} × {plataforma de hospedagem}` minimiza custo total (financeiro + cognitivo + operacional) e maximiza alinhamento com YAGNI/TDD, considerando que o site-alvo não exige bypass anti-bot e que o workload diário é de 1-4 minutos de scrape?**

## 3. Sub-questions

| # | Sub-question | Search scope |
|---|---|---|
| 3.1 | Node/TS, Python ou Go como linguagem do scraper+API, dado que o frontend é TS e Playwright é nativo Node? | Docs oficiais Playwright; código-fonte playwright-python (módulos `_transport` e `_driver`); GitHub microsoft/playwright |
| 3.2 | Qual plataforma de hospedagem entrega o workload (scrape diário + Postgres + API leve + scheduler) com menor custo+fricção: VPS (Hetzner/DO/Contabo), serverless/free-tier (Netlify+Supabase), edge (Cloudflare Workers+D1+Browser Rendering), ou Oracle Always Free? | Páginas oficiais Hetzner, DigitalOcean, Contabo, Netlify docs, Supabase pricing, Cloudflare D1+Workers+Browser Rendering, Oracle docs, repo `hitrov/oci-arm-host-capacity` |
| 3.3 | Postgres self-host em VPS vs gerenciado (Neon/Supabase): qual aderência ao workload e ao orçamento? | Pricing pages Neon, Supabase, ferramentas de backup nativas Postgres |
| 3.4 | Scheduler: crontab sistema, systemd timer, GitHub Actions, ou cron nativo do PaaS? | Docs systemd, GitHub Actions schedule, comparativos de reliability |
| 3.5 | Browser-as-a-service (Browserless self-host, BrightData, Apify, Cloudflare Browser Rendering) ainda faz sentido após o POC mostrar zero anti-bot? | Browserless GitHub + pricing, Cloudflare Browser Rendering limits |
| 3.6 | A "premissa Postgres trancada" é restrição revisável dado que D1/SQLite cobriria o workload tecnicamente? | Cloudflare D1 limits + análise do schema implícito do Adam Stats |

## 4. Applied methodology

- **Tier**: L2 — decisão arquitetural fundadora; gera ADR; gate pro restante do roadmap. Não justifica L3 (custo ~15x).
- **Tools**: WebFetch (fontes primárias: docs oficiais Netlify, Hetzner, Cloudflare, Browserless, Oracle, código fonte `playwright-python`), WebSearch (Oracle capacity 2025-26, Hetzner pricing cross-check), Read local (POC `package.json`, `result.json`, `snapshot.html`), Grep sobre `snapshot.html`.
- **Subagents**: nenhum — single researcher por rodada (L2).
- **POC empírico** (`.poc/scraper-test/`, 2026-05-10): Playwright 1.59.1 headless Chromium contra `https://www.adamchoi.co.uk/fixtures`. Resultados: status 200, DOMContentLoaded 2.6s, `networkidle` timeout (analytics/ads em loop), HTML 1.29MB, **AngularJS** (`ng-binding`, `hc.fixtureService.*`). Cardinalidade: o seletor heurístico do POC retornou **549 matches** (over-selection — pega muitos containers que contêm "fixture" no className); inspeção manual posterior do `snapshot.html` via grep contou **183 fixtures reais** usando seletores específicos `.fixture-team-home` e `.fixture-ko-time` (cardinalidade 1:1 com fixture row). Seletor canônico para produção: `tr[data-ng-repeat="fixture in :refreshFixtures:league.fixtures"]`. Tempo estimado de scrape diário completo: 1-4 min (1 list page + 30-80 detail pages × 2-3s).
- **Cloudflare signals do POC**: `result.json` reporta `cloudflareSignals: ["html mentions cloudflare"]` — isso é menção textual do CDN no HTML (referência Cloudflare como provedor), **não challenge ativo**. Verificações específicas (`turnstile`, `cf-chl-bypass`, `"Checking your browser"`, `"Just a moment"`, redirect a `challenges.cloudflare.com`) deram negativo. Conclusão: site usa Cloudflare como CDN mas não como bot protection nesse momento.
- **Wall-clock time**: ~38 min total (v0.1 ~14min + v0.2 ~16min + v0.3 surgical pass ~8min).
- **Adversarial review**: sim — duas rodadas de `research-critic` (v0.1 → v0.2 → v0.3). Log completo em §12.
- **Disclaimer de métricas**: `source_diversity`, `primary_source_ratio`, `citation_density` e `triangulation_coverage` no frontmatter foram calculadas pelo próprio researcher contando entradas em §13 e citações inline. Auditor independente pode verificar com `grep -oE '\[[0-9]+\]' | sort -u | wc -l` contra §6 e §13.

## 5. Sources consulted

| # | URL | Type | Quality | Notes |
|---|---|---|---|---|
| 1 | POC local: `.poc/scraper-test/result.json` + `snapshot.html` (2026-05-10) | primary | high | Evidência empírica direta: target não usa Cloudflare anti-bot; AngularJS; 549 heurístico / 183 canônico; DOMContentLoaded 2.6s |
| 2 | https://playwright.dev/docs/languages | primary | high | Suporte oficial a JS/TS, Python, Java, .NET; "all core features supported in all languages" |
| 3 | https://github.com/microsoft/playwright-python/blob/main/playwright/_impl/_transport.py | primary | high | Módulo `_transport` implementa o pipe stdin/stdout entre Python e o subprocesso driver |
| 4 | https://raw.githubusercontent.com/microsoft/playwright-python/main/playwright/_impl/_driver.py | primary | high | Módulo `_driver` resolve o executável do driver como `node` (ou `node.exe` no Windows) + entrypoint `cli.js` — prova que o subprocesso é Node.js |
| 5 | https://playwright.dev/docs/api/class-playwright | primary | high | API Node de referência |
| 6 | https://playwright.dev/docs/intro#system-requirements | primary | high | Requisitos de runtime |
| 7 | https://github.com/microsoft/playwright | primary | high | Repo principal — matriz de bindings oficiais |
| 8 | https://www.hetzner.com/cloud | primary | high | CX22: 2 vCPU / 4 GB RAM / 40 GB NVMe / 20 TB tráfego, €3.79/mês |
| 9 | https://www.hetzner.com/news/preisanpassung-2026/ | primary | high | Anúncio reajuste 2026-04-01 — tabelas listam CX23/33/43/53; CX22 ausente |
| 10 | https://docs.netlify.com/build/functions/overview/ | primary | high | "60 second execution limit for synchronous functions" |
| 11 | https://docs.netlify.com/build/functions/background-functions/ | primary | high | Background Functions: 15min, Paid-only |
| 12 | https://developers.cloudflare.com/workers/platform/limits/ | primary | high | Limites Workers free e paid |
| 13 | https://developers.cloudflare.com/browser-rendering/ | primary | high | Browser Rendering overview + limites (10min/dia free, 60s/browser, 120 concurrent paid) |
| 14 | https://developers.cloudflare.com/d1/platform/pricing/ | primary | high | D1 Free: 5GB total, 5M reads/dia, 100k writes/dia |
| 15 | https://developers.cloudflare.com/workers/platform/pricing/ | primary | high | Workers Paid $5/mês mínimo |
| 16 | https://neon.tech/pricing | primary | high | Free 0.5GB; Hobby $19/mês |
| 17 | https://supabase.com/pricing | primary | high | Free 500MB + pausa após 7 dias inativos; Pro $25/mês |
| 18 | https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm | primary | high | Ampere A1: 4 OCPU + 24 GB RAM; menciona capacity issues + idle reclamation |
| 19 | https://github.com/hitrov/oci-arm-host-capacity | primary | high | Repo community canônico (>10k stars) com script de retry contra Oracle A1 "out of host capacity" |
| 20 | https://www.freedesktop.org/software/systemd/man/systemd.timer.html | primary | high | systemd timer man page: logs estruturados via journalctl, retry policies, on-boot activation |
| 21 | https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#schedule | primary | high | GHA schedule pode atrasar até ~1h em alta carga; 2k min/mês private |
| 22 | https://node-postgres.com/ | primary | high | Driver pg para Node — padrão de mercado |
| 23 | https://github.com/browserless/browserless | primary | high | Browserless: SSPL-1.0 OR Commercial; self-host Docker grátis para non-commercial |
| 24 | https://status.hetzner.com/ | primary | medium | Status page Hetzner; track record público |

## 6. Synthesis

> Regra absoluta: cada afirmação factual abaixo carrega `[N]` apontando para §13. Trechos sem `[N]` são contexto/opinião marcados como tal.

### 6.1 Resposta a 3.1 — Linguagem do scraper+API

**Suporte oficial Playwright**: o projeto suporta oficialmente JavaScript/TypeScript, Python, Java e .NET [2][7]. Go **não** tem binding oficial — apenas wrappers community (`playwright-community/playwright-go`) que dependem de tradução de protocolo e ficam atrás em releases [2][7]. Para um projeto solo com TDD, isso elimina Go: assumir dívida de manutenção de binding não-oficial viola YAGNI.

**Arquitetura interna do Playwright**: o driver principal é **Node.js**. Bindings em Python/Java/.NET sobem um processo Node filho e comunicam-se por protocolo JSON via stdin/stdout [3][4]. O módulo `_transport` implementa o pipe stdin/stdout com o subprocesso [3]; o módulo `_driver` identifica o executável — a função de resolução do executável retorna `node` (ou `node.exe` no Windows) mais o entrypoint `cli.js`, com fallback para a env var `PLAYWRIGHT_NODEJS_PATH` se ela existir [4]. Implicação prática: usar Python para Playwright significa **dois runtimes** no ambiente (CPython + Node.js distribuído com o pacote `playwright`); o overhead de IPC inter-process existe a cada chamada de API mas para um workload diário de 1-4 minutos raramente é gargalo prático — o argumento real é **complexidade operacional** (dois ecossistemas pra debugar, dois conjuntos de deps no container/VPS) [3][4][6].

**DX e ecossistema do projeto**: o frontend já é React+TS [decisão trancada]. Manter worker+API em **TypeScript** dá: (a) tipos compartilhados entre scraper, API e cliente via package interno (`Fixture`, `Match`, `Team` definidos uma vez); (b) toolchain única (pnpm + tsx + vitest + Vite); (c) `@playwright/test` como test runner de primeira classe — ausente nos bindings não-Node [2]; (d) o piloto não troca contexto cognitivo. Para uma operação solo, isso reduz fricção mensurável.

**Velocidade de scraping**: Playwright é I/O-bound em todos os bindings (espera resposta HTTP do site alvo). POC em Node/TS executou em ~67s wall-clock para scrape all-season [1]; reescrever em Python não tornaria sensivelmente mais rápido nem mais lento, mas adicionaria o subprocesso Node intermediário [3][4].

**Veredito 3.1**: **Node/TypeScript** é a escolha dominante. Python só faria sentido se a equipe já fosse Python-first ou se houvesse uso pesado de pandas/scikit no pipeline — não é o caso (análise é delegada a OpenRouter, LLM externo).

### 6.2 Resposta a 3.2 — Plataforma de hospedagem

**Workload real após POC** [1]: scrape diário 1-4 min; Postgres pequeno (3-4 dias de retenção, ~10-20MB HTML bruto/dia, ~1-2k rows/dia); API leve (1 user, leituras + chamadas a OpenRouter); scheduler diário.

#### 6.2.1 VPS

- **Hetzner CX22**: 2 vCPU AMD / 4 GB RAM / 40 GB NVMe / 20 TB tráfego, **€3.79/mês** [8]. CX22 **não aparece nas tabelas de reajuste de 2026-04-01** [9] — a ausência sugere que o tier não foi afetado, mas a exclusão não é declarada explicitamente (argumentum e silentio). Cautela: o preço atual pode ser revisto em ciclos futuros.
- **DigitalOcean Basic Droplet**: $6/mês (1 GB / 1 vCPU / 25 GB) e $12/mês (2 GB / 1 vCPU / 50 GB) — tier $12 equivalente ao CX22 é ~3x mais caro pela mesma capacidade.
- **Contabo Cloud VPS 10**: 4 vCPU / 8 GB RAM / 75 GB NVMe / tráfego ilimitado, sub-$5/mês (plano 12 meses). Melhor preço-bruto do mercado para essa faixa de RAM/CPU, mas trade-offs operacionais (provisionamento mais lento, disco potencialmente sobre-comissionado) não foram triangulados nesta pesquisa — registrados como hipótese em §9.

**Análise comparativa VPS**: os três cobrem o workload. CX22 oferece melhor combinação preço/reputação/regiões/track record [8][24]. Contabo é tecnicamente o melhor preço bruto mas com riscos não triangulados [§9]. DO custa ~3x mais.

#### 6.2.2 Serverless/free-tier (Netlify + GHA + Supabase Free)

**Timeout real Netlify Functions** [10]: 60s síncrono (não 10s como assumido inicialmente em rascunhos anteriores). Background Functions (15 min) são **feature paga** [11]. O scrape de 1-4 min [1] **não cabe** em function síncrona (60s), mas cabe folgado em Background Function — porém esse recurso é pago [11]. Alternativa free: scrape via **GitHub Actions schedule cron** (2.000 min/mês private; ilimitado em repos públicos) [21] — empurra o scrape pra fora da infra serverless. GHA pode atrasar até ~1h em alta carga [21]; pra scrape diário sem janela rígida, tolerável.

**Supabase Free**: 500 MB DB; **projetos free são pausados após 7 dias de inatividade** [17]. Modo de falha mais provável: scrape do GHA falha silenciosamente 7+ dias → DB pausa → UI quebra ao abrir.

**Resumo cenário B**: tecnicamente funciona ($0/mês em estado normal), mas tem dois pontos frágeis: (i) pause de DB após 7 dias [17] e (ii) cron silencioso (GHA falha sem alarme nativo) [21]. Custo de monitoramento adicional (healthchecks.io) e dependência cruzada de três provedores aumentam o footprint mental.

#### 6.2.3 Edge (Cloudflare Workers + D1 + Browser Rendering)

- **D1 Free**: 5 GB storage total, 10 databases, **500 MB por DB**, 5M reads/dia, 100k writes/dia [14]. **D1 Paid**: requer Workers Paid; 50k DBs, 10 GB por DB [14].
- **Workers Paid**: **$5/mês mínimo por conta** [15], inclui 10M reqs + 30M CPU-ms + Hyperdrive + Durable Objects.
- **Browser Rendering Free**: 10 min/dia, 3 concurrent, 60s/browser timeout [13]. Paid: medido por uso, 120 concurrent [13].
- **Limite crítico Workers**: 30s wall-clock por request no Paid plan, 15min em Durable Objects [12][13]. O POC mediu scrape all-season em ~67s [1] — passa do limite Worker simples, ficaria forçado a Durable Objects ou múltiplas invocações encadeadas. Complexidade desproporcional para um workload diário pessoal.
- **D1 não é Postgres**: D1 é SQLite-compatible serverless [14]. A decisão trancada do projeto é Postgres — usar D1 significaria reescrever migrations, queries, perder familiaridade com `psql`/`pg_dump`. Cloudflare oferece Hyperdrive como proxy pra Postgres externo, mas isso adiciona camada e ainda exige Postgres em outro provedor.

**Postgres trancado vs D1**: o schema implícito do Adam Stats (fixtures + detail pages, retenção 3-4 dias, 1 user) cabe folgado em 500 MB do D1 free [14]. **D1/SQLite seria tecnicamente suficiente**. A trava em Postgres é **escolha de DX/portabilidade**, não restrição técnica. Se o Pilot revisar essa premissa, abre cenário Cloudflare-nativo: Workers + D1 free + Browser Rendering free dentro dos 10 min/dia [13][14], potencialmente $0/mês. Esta pesquisa não recomenda revisar a premissa pelo argumento qualitativo de §10 (d).

**Lock-in**: sair de Cloudflare implica migrar D1 → Postgres + Browser Rendering → Playwright direto + Workers → Node API — três peças simultaneamente [12][13][14]. Reversibilidade qualitativa: menor que migrar entre VPS provedores.

#### 6.2.4 Oracle Cloud Always Free

Ampere A1 ARM: até **4 OCPU + 24 GB RAM** + 200 GB block storage + 10 TB tráfego mensal — **mais capacidade que qualquer plano pago neste estudo** [18]. **Capacity issues persistem em 2025-2026**: docs Oracle reconhecem "out of host capacity" como erro comum ao tentar provisionar A1 e sugerem "tentar outra availability domain ou esperar" [18]; a comunidade desenvolveu workarounds, sendo o repo `hitrov/oci-arm-host-capacity` a referência canônica (>10k stars) [19]. Adicionalmente, Oracle aplica **idle reclamation** — CPU/network/memory <20% por 7 dias derruba a instância [18]. Pra um worker que roda 1 min/dia, é risco real e exige keepalive artificial.

**Veredito Oracle**: spec brutal a $0, mas troca custo zero por risco de provisioning (capacity) + risco de reclaim (idle). Para dev solo que precisa de produto continuamente operável, não recomendado como default. Viável para quem topa o overhead inicial.

### 6.3 Resposta a 3.3 — Postgres self-host vs gerenciado

- **Neon Free**: 0.5 GB storage, 1 compute hour/dia, scale-to-zero [16]. Hobby pago $19/mês — estoura orçamento.
- **Supabase Free**: 500 MB DB, pausa 7 dias inativos [17]. Pro $25/mês — estoura orçamento.
- **Postgres self-host em CX22**: zero custo adicional além da VPS; backup diário via `pg_dump | gzip` para Hetzner Object Storage. Para 10-20 MB/dia projetados, sobra ordens de grandeza [8].

Para o volume real do projeto (~1-2k rows/dia, ~5 GB acumulável em anos), **self-host vence em custo e flexibilidade**. A perda em "managed" (backups automáticos, point-in-time recovery) é mitigável com script + storage Hetzner.

### 6.4 Resposta a 3.4 — Scheduler

- **crontab sistema**: simplicidade máxima, log em `/var/log/syslog`, sem dependência externa. Falha silenciosa se script crashar — precisa de monitor (healthchecks.io ou similar).
- **systemd timer**: alternativa moderna ao crontab em distros systemd; logs estruturados via `journalctl`, retry policies declarativas, dependências entre units, ativação on-boot [20]. **Recomendada** sobre crontab quando a VPS usa systemd (Ubuntu 22.04+, Debian 12, Fedora — todas as distros típicas).
- **GitHub Actions schedule**: 2k min/mês private grátis [21]; ilimitado em repos públicos. Delay até 1h em alta carga documentado [21] — tolerável pra scrape diário sem janela rígida.
- **PaaS cron nativo (Fly machines schedule, Railway cron)**: simples mas atrela scheduler ao provider — aumenta lock-in.

Para Hetzner + dev solo, **systemd timer + healthchecks.io ping** é o caminho de menor fricção e maior reliability [20].

### 6.5 Resposta a 3.5 — Browser-as-a-service

O POC [1] já respondeu a pergunta central: **adamchoi.co.uk não dispara Cloudflare challenge** contra Playwright headless com UA realista. Status 200, sem Turnstile, sem "Just a moment", sem redirect para `challenges.cloudflare.com` [1].

Implicações:
- **FlareSolverr, BrightData Scraping Browser, residential proxies, stealth plugins: descartados.** Argumento "precisamos resolver Cloudflare" não existe.
- **Browserless self-hosted** [23]: viável tecnicamente — Docker container expondo API HTTP de Chromium, evita reinventar pool/cleanup/healthcheck. License SSPL-1.0 OR Commercial — uso non-commercial é gratuito sob SSPL [23]; Adam Stats é projeto pessoal sem monetização — provavelmente qualifica, **mas o Pilot deve revisar termos SSPL** antes de adotar pra evitar surpresa. **Combinação CX22 + Browserless self-host no mesmo VPS** é arquitetonicamente limpa para quem prefere "Chromium gerenciado por outro serviço".
- **Browserless managed**: $25/mês entry sobrescreve orçamento. Descartado.
- **BrightData Scraping Browser, Apify**: feitos para resolver anti-bot em escala industrial; custo alto; descartados pelo POC [1].
- **Cloudflare Browser Rendering** [13]: free tier 10min/dia cobre Adam Stats teoricamente, mas timeout 60s/browser exige paginar o scrape. Faz sentido **apenas** se a stack inteira for Cloudflare (D1 + Workers); fora desse contexto não compensa.

### 6.6 Resposta a 3.6 — Postgres como escolha

Premissa "Postgres trancado" é decisão do Pilot, não restrição técnica:
- D1/SQLite: schema do Adam Stats cabe folgado em 500 MB do free tier [14].
- Postgres mantém vantagens de DX (extensions, full-text search, JSONB, ecossistema Drizzle/Prisma maduro), portabilidade (qualquer hosting tem Postgres), e familiaridade.
- Custo dessa escolha: descartar cenário Cloudflare-nativo ou pagar Postgres gerenciado em VPS/Supabase.

**Recomendação**: manter Postgres por padrão (vantagem futura supera custo presente), mas registrar como escolha consciente e revisável.

### 6.7 Matriz consolidada de combinações

| # | Lang | Hosting | DB | Browser | $/mês | Falha #1 provável 12m |
|---|---|---|---|---|---|---|
| A | Node/TS | Hetzner CX22 | Postgres self-host | Playwright direto | €3.79-5 | OOM em pico (mitigado por `--ipc=host`) ou disco cheio sem rotação |
| B | Node/TS | Netlify (API) + GHA cron (scrape) | Supabase Free | Playwright em GHA runner | $0 estado normal | DB pausa após 7 dias inativos [17] ou cron GHA falha silenciosamente [21] |
| C | Node/TS | Cloudflare Workers + Workers Paid | D1 | Browser Rendering | $5+ [15] | Timeout 60s/browser força chunking; lock-in se workload crescer [13][14] |
| D | Node/TS | Hetzner CX22 | Postgres self-host | Browserless self-host (Docker) | €3.79-5 | RAM apertada com Chromium pool + Postgres + Browserless [23] |
| E | Node/TS | Oracle Always Free ARM | Postgres self-host | Playwright direto | $0 | Provisionamento difícil; idle reclamation [18][19] |
| F | Node/TS | Contabo VPS 10 | Postgres self-host | Playwright direto | ~$5 (12-month) | Trade-offs operacionais não-triangulados [§9] |
| G | Python | qualquer hosting | qualquer DB | Playwright Python (subprocess Node) | similar a A | Dois ecossistemas para manter; sem ganho concreto na ausência de pandas [3][4] |

**Combinação A** é a recomendada por §10.

## 7. Triangulated claims

> Nota metodológica: nesta tabela, **single-A** significa "fonte primária única autoritativa (própria docs do produto/projeto) — apropriado para claims de pricing/feature do próprio produto". **partial-B** significa "múltiplas fontes mas derivam da mesma raiz, ou triangulação imperfeita". **triangulated-A** significa "≥2 fontes independentes (publishers ou repos distintos) convergem".

| # | Claim | Sources | Status | Grade |
|---|---|---|---|---|
| C1 | Playwright suporta oficialmente Node/TS, Python, Java, .NET com paridade core; Go é community | [2][7] | triangulated | A |
| C2 | playwright-python sobe um processo **Node.js** (`node` ou `node.exe`) executando `cli.js` via stdin/stdout; Python requer Node.js no ambiente | [3][4] | triangulated | A |
| C3 | Hetzner CX22: 2 vCPU / 4 GB RAM / 40 GB NVMe / 20 TB tráfego, €3.79/mês | [8] | single | A (fonte oficial direta) |
| C4 | Reajuste Hetzner 2026-04-01 não inclui CX22 nas tabelas — ausência sugere isenção mas não é declarada (argumentum e silentio) | [9] | single | B (rebaixado da v0.2 por ser argumento por silêncio) |
| C5 | Netlify Functions síncronas: 60s timeout; Background Functions: 15min, Paid-only | [10][11] | triangulated | A |
| C6 | Cloudflare Workers Paid: $5/mês mínimo | [15] | single | A (docs oficial Cloudflare) |
| C7 | Cloudflare D1 Free: 5 GB total, 500 MB por DB, 10 DBs, 5M reads/dia, 100k writes/dia | [14] | single | A |
| C8 | D1 é SQLite-compatible, não Postgres | [14] | single | A |
| C9 | Cloudflare Browser Rendering Free: 10 min/dia, 3 concurrent, 60s/browser; Workers request limit 30s wall-clock | [12][13] | triangulated | A |
| C10 | Oracle Always Free Ampere A1: 4 OCPU + 24 GB RAM + 200 GB + 10 TB | [18] | single | A |
| C11 | Oracle A1 capacity issues persistem em 2025-26; idle reclamation (<20% CPU/net/mem por 7d derruba instância) | [18][19] | triangulated | A (docs oficiais + repo community canônico) |
| C12 | Neon Hobby $19/mês; Supabase Pro $25/mês — ambos fora do orçamento alvo | [16][17] | triangulated | A |
| C13 | Supabase Free pausa projeto após 7 dias de inatividade | [17] | single | A |
| C14 | adamchoi.co.uk NÃO dispara Cloudflare anti-bot challenge contra Playwright headless com UA realista (verificações específicas Turnstile/cf-chl-bypass/checking-your-browser negativas; menção "cloudflare" no HTML é referência ao CDN, não challenge token) | [1] | single | A (POC reproduzível; única evidência possível para esse fato específico) |
| C15 | POC adamchoi.co.uk: 549 fixtures (heurístico over-selection) / 183 fixtures reais (canônico via grep `.fixture-team-home` e `.fixture-ko-time`); seletor canônico produção `tr[data-ng-repeat="fixture in :refreshFixtures:league.fixtures"]` | [1] | single | A (POC reproduzível) |
| C16 | systemd timer oferece logs estruturados (journalctl), retry policies declarativas, ativação on-boot — superior a crontab para ops | [20] | single | A |
| C17 | GitHub Actions schedule pode atrasar até ~1h em alta carga; free 2k min/mês private | [21] | single | A |
| C18 | Browserless: SSPL-1.0 OR Commercial; self-host Docker grátis para uso non-commercial | [23] | single | A |
| C19 | Sair de Cloudflare exige reescrever 3 peças simultaneamente (D1→Postgres + Browser Rendering→Playwright + Workers→Node API) | [12][13][14] | partial | B (fato técnico A; custo em horas é qualitativo) |

(Nota v0.2→v0.3: a inconsistência "partial-A" da v0.1 foi eliminada. Onde a evidência é single source autoritativa, marcada [single] com grade A. Onde múltiplas fontes derivam de raiz comum ou triangulação imperfeita, [partial] grade B. Onde 2+ fontes independentes convergem, [triangulated] grade A. O claim quantitativo "Playwright Docker = 2GB+ RAM" da v0.1 foi removido por falta de fonte primária — `--ipc=host` mantido como recomendação operacional documentada sem número.)

## 8. Alternatives considered

| Alternative | Why not chosen |
|---|---|
| Python + Playwright | Adiciona segundo ecossistema (Python + Node.js obrigatório [4]) sem ganho concreto; análise é delegada a OpenRouter, não há pandas/scikit-learn na stack. |
| Go + Playwright | Sem binding oficial Microsoft — apenas wrapper community volátil [2][7]. Risco de manutenção para dev solo. |
| Bun/Deno runtime | Playwright tem suporte oficial declarado a Node [2]; runtimes alternativos funcionam mas caminho exótico fora do path documentado. Viola YAGNI. |
| Java/.NET + Playwright | Ecossistema muito além do necessário para 1 dev / 1 user [2]. |
| BrightData Scraping Browser | Resolve anti-bot que **não existe** neste target [1]; custo alto. |
| Apify | Plataforma de scraping cloud; overkill para 1 user. |
| Browserless managed | $25/mês entry sobrescreve orçamento. |
| Browserless self-host (combinação D) | **Viável** — Docker no mesmo CX22 [23]. Não default por YAGNI (Playwright direto basta). Decisão do Pilot sobre SSPL antes de adotar. |
| Cloudflare Workers + D1 + Browser Rendering (combinação C) | Funciona, mas força chunking do scrape em segmentos ≤30s Workers ou 15min Durable Objects [12][13]; reescreve 3 peças se sair (§6.2.3); D1 ≠ Postgres [14] violando decisão trancada (revisável, ver §6.6). |
| Netlify + GHA + Supabase Free (combinação B) | Tecnicamente funciona com 60s timeout sync [10]; risco operacional alto: DB pausa em 7 dias [17] e cron silencioso [21]. Viável como POC, frágil como produção pessoal. |
| Oracle Always Free (combinação E) | Mais capacidade gratuita do mercado [18]; capacity issues persistem [18][19] + idle reclamation forçando keepalive artificial. Alto custo de operação inicial. Registrado como upside opcional. |
| DigitalOcean Basic Droplet | Funciona em $12/mo equivalente ao CX22 [8]; ~3x mais caro pelo mesmo workload. |
| Contabo Cloud VPS 10 (combinação F) | Tecnicamente o melhor preço-bruto; trade-offs operacionais não-triangulados [§9]. Alternativa viável se preço for crítico. |
| Neon / Supabase Pro como DB principal | $19-25/mês fora do orçamento; sem ganho concreto vs Postgres self-host no mesmo VPS [16][17]. |
| tRPC | Adiciona dependência que YAGNI não justifica para 1 user e poucas rotas. REST com Zod + tipos compartilhados via package interno cobre. |
| Crontab puro como scheduler | Funciona, mas systemd timer [20] entrega logs estruturados, retry e on-boot activation com mesma simplicidade. |

## 9. Known limitations

1. **POC é único snapshot temporal** [1]. Cloudflare pode ser ativado em adamchoi.co.uk no futuro; este report assume o estado atual (2026-05-10). Follow-up: monitoring de regressão (script semanal que verifica presença de "Just a moment" / Turnstile no HTML).
2. **Trade-offs operacionais de Contabo não-triangulados.** Disco potencialmente sobre-comissionado e provisionamento mais lento são relatos de mercado conhecidos; esta pesquisa não obteve fontes primárias que quantifiquem esses pontos. Marcado como hipótese.
3. **"Overhead de subprocess do binding Python" é fato arquitetural [3][4], mas o impacto em produção é workload-dependente.** Para scrape diário 1-4 min, esse overhead é provavelmente desprezível; não foi medido empiricamente nesta pesquisa.
4. **Custo de migração de saída de Cloudflare** foi mantido em modo qualitativo (§10 d), sem número de horas. Estimativa numérica da v0.2 foi removida por ser circular (usada como argumento de decisão sem base empírica).
5. **Métricas de frontmatter (`source_diversity`, `primary_source_ratio`, `citation_density`, `triangulation_coverage`) foram calculadas pelo próprio researcher.** Auditor independente deve verificar com `grep` sobre §6 e §13.
6. **Auto-revisão da v0.1 foi inadequada.** O `research-critic` externo encontrou 4 *blocking* + 11 *must-fix* na v0.1 e mais 1 blocking + 5 must-fix na v0.2 — evidência empírica direta de que auto-revisão por single agent não substitui adversarial review por agente independente. Esta v0.3 incorpora ambas as rodadas.
7. **POC observou networkidle timeout 30s** por causa de analytics/ads em loop [1]. Implicação prática para produção: usar `waitForSelector('.fixture-ko-time')`, **não** `waitForLoadState('networkidle')`. Não-óbvio para quem implementar.
8. **Backup story Postgres self-host (`pg_dump` → Hetzner Object Storage) documentada mas não testada end-to-end** em ambiente clean. Follow-up obrigatório antes do go-live.

## 10. Suggested decision

**Adotar Node/TS para scraper+API e hospedar em Hetzner CX22 (€3.79/mês) com Postgres self-hosted, Playwright direto (sem browser-as-a-service), agendamento via systemd timer + healthchecks.io ping.**

Custo estimado total: **~€5-6/mês** (CX22 + Hetzner Object Storage para backup + healthchecks.io free).

Justificativa:

(a) frontend já é TS+React+Vite; manter Node/TS no backend elimina segundo ecossistema, viabiliza tipos compartilhados sem overhead, e Playwright tem `@playwright/test` como test runner de primeira classe para Node [2][3][4][5][7];

(b) o POC empírico [1] elimina o argumento principal pró-browser-as-a-service (não há anti-bot a contornar), tornando Playwright direto a solução mais simples e barata;

(c) Hetzner CX22 entrega 4 GB RAM (suficiente para Chromium single-shot + Postgres pequeno) a €3.79/mês [8], dentro do orçamento alvo com folga; CX22 não aparece nas tabelas de reajuste 2026-04-01 [9] (argumentum e silentio — ver §6.2.1);

(d) **evita lock-in de plataforma** — sair de Cloudflare exigiria reescrever três peças simultaneamente (D1→Postgres, Browser Rendering→Playwright direto, Workers→Node API) [12][13][14], fricção maior que migrar entre VPS provedores; estimativa qualitativa, ver §9.4;

(e) **systemd timer** [20] sobre crontab pelo ganho de logs estruturados (journalctl), retry declarativo e ativação on-boot — mesma simplicidade de setup, melhor observabilidade.

**Decisões reversíveis e baratas registradas como upside**: se gestão direta do Chromium se mostrar dolorosa, adicionar Browserless self-host no mesmo VPS (combinação D, §6.7) é trivial via Docker compose [23]. Se o Pilot reabrir a premissa Postgres, D1 cobre o workload tecnicamente [14]. Se aceitar overhead de provisionamento Oracle, ARM Always Free dá 24 GB RAM grátis [18].

## 10.1 Pilot override (2026-05-11)

A recomendação técnica de §10 é **Node/TS**. O Pilot **sobrepôs** essa recomendação e escolheu **Ruby 4.0.3** para o scraper+API. A decisão de Hetzner CX22 + Postgres self-host + systemd timer foi mantida conforme §10.

**Razões da escolha:**
- Preferência pela ergonomia do **Nokogiri** (parsing HTML/XML) sobre Cheerio/JSDOM/`page.locator()`.
- Cultura histórica de Ruby em scraping (Mechanize, Watir, Nokogiri há 15+ anos).
- Interesse pessoal/aprendizado em Ruby.
- Escolha consciente do major **Ruby 4.0.3** (lançado 2026-04-21, ~3 semanas no momento da decisão) sobre Ruby 3.4.x — assume risco de ecossistema imaturo em troca de "começar greenfield no major novo" sem ter que migrar depois.

**POC empírico adicional** (`.poc/ruby-scraper-test/`, 2026-05-11):
- Ruby 4.0.3 instalado via `mise` (gerenciador moderno multi-linguagem; substituiu rbenv/asdf).
- Gems: `playwright-ruby-client` 1.59.1 + `nokogiri` 1.19.3 + `racc` 1.8.1 + `json` 2.19.5.
- Resultado contra `adamchoi.co.uk/fixtures`: status 200, sem CF challenge, **426 fixtures** parseadas (variação temporal vs 183 do POC Node — calendário do dia mais cheio), Nokogiri parseou 2.7 MB de HTML em **78 ms**, DOMContentLoaded 2.5 s, total load 11 s. **Ruby 4.0 acelerou startup do driver Node em ~3x vs Ruby 3.4.8.**
- Nenhum gem quebrou em Ruby 4.0; native extensions compilaram sem warnings.

**Trade-offs explicitamente aceitos pelo Pilot:**
1. **Perda de tipos compartilhados scraper↔frontend.** `Fixture` será definido em Ruby (struct/classe) E em TypeScript (interface), mantidos manualmente em sync. Mitigação: schema JSON gerado a partir do Ruby + validação no frontend via Zod.
2. **Dois ecossistemas no monorepo** (Bundler + pnpm). Trade-off documentado em §6.1 da pesquisa. Acelerar setup com `mise` que gerencia ambos.
3. **`@playwright/test`** (test runner de 1ª classe) **substituído por RSpec/Minitest** — sem auto-retry built-in, sem UI mode, sem trace viewer integrado. Mitigação: pra debug visual usar `headless: false` direto no script.
4. **Bug do `playwright-ruby-client` com path contendo espaços** (`Open3.popen3` tokeniza). Workaround conhecido: Playwright Node CLI em path ASCII-only (`/tmp/pw-ruby-driver/` local; `/opt/playwright/` em prod).
5. **Ruby 4.0 tem 3 semanas em produção pública.** Risco de algum gem futuro quebrar; mitigação: rodar `bundle outdated` regularmente nos primeiros 3-6 meses, e ter plano B de downgrade pra 3.4 documentado.

**Implicações arquiteturais que cascateiam:**
- Web framework da API: a decidir entre Sinatra, Roda ou Rails-API (não Express/Fastify). Saída em ADR futuro durante fase Foundation do módulo de API.
- Postgres driver: `pg` gem (não `node-postgres`). Possivelmente Sequel para query DSL se ergonomia justificar.
- Test runner: RSpec (default; revisitar se Pilot preferir Minitest).
- Backup script: shell + `pg_dump` (sem mudança vs §10).

**A recomendação técnica original (§10) permanece registrada como histórica e correta segundo os critérios da pesquisa.** O override é decisão de valor pessoal do Pilot, legítima sob a metodologia Akita/XP onde o Pilot é o Architect e o researcher é insumo, não autoridade.

## 11. Follow-ups

- [x] **ADR-001 (revisada): "Linguagem do scraper+API: Ruby 4.0.3"** — registrada em `CLAUDE.md#technical-decisions-adrs` em 2026-05-11. Pilot override sobre recomendação Node/TS (ver §10.1).
- [x] **ADR-002: "Hospedagem: Hetzner CX22 + Postgres self-host"** — registrada em `CLAUDE.md#technical-decisions-adrs` em 2026-05-11.
- [x] **ADR-003: "Scheduler: systemd timer + healthchecks.io"** — registrada em `CLAUDE.md#technical-decisions-adrs` em 2026-05-11.
- [x] **ADR-004: "Version manager: mise"** — registrada em `CLAUDE.md` em 2026-05-11 (decorrência da escolha Ruby 4.0).
- [x] **ADR-005: "DB: PostgreSQL self-host"** — registrada em `CLAUDE.md` em 2026-05-11.
- [ ] **Atualizar `CLAUDE.md`** raiz: preencher seções "Tech stack" (Node 20+, TS, pnpm workspaces, Postgres 16, Playwright, Docker Compose), "Environment variables" (`DATABASE_URL`, `OPENROUTER_API_KEY`, `HEALTHCHECKS_URL`), "Commands" (scripts de scrape + dev + test).
- [ ] **Abrir task** `docs/tasks/provisionamento-vps-hetzner/`: provisionar CX22, hardening SSH (key-only, UFW, fail2ban, unattended-upgrades), instalar Node 20 + Postgres 16, configurar systemd unit + timer pro scraper, backup script `pg_dump | gzip` → Hetzner Object Storage, healthchecks.io ping de saúde.
- [ ] **Decisão explícita do Pilot sobre SSPL do Browserless** — uso pessoal não-comercial aceitável? Registrar em `CLAUDE.md` para evitar reabrir depois.
- [ ] **Testar restore end-to-end do `pg_dump`** antes do go-live (cobertura faltante §9.8).
- [ ] **Pesquisa derivada**: `docs/pesquisas/scraper-defensive-patterns.md` — retry/backoff, seletores fallback, regressão Cloudflare check semanal (resposta direta a §9.1).
- [ ] **Validação fase 4**: após primeira semana em prod, medir tempo real de scrape e custo real de tráfego/storage. Comparar com estimativas desta pesquisa.

## 12. Adversarial review log

Duas rodadas de `research-critic` foram executadas. Cada finding está mapeado para a ação tomada e a seção onde foi endereçada.

### Rodada 1: v0.1 → v0.2

| # | Classification | Weakness | Action taken |
|---|---|---|---|
| 1 | blocking | Netlify Functions timeout: v0.1 usou 10s (incorreto); real é 60s síncrono e 15min Background [10][11] | Corrigido §6.2.2 e §6.7 matriz; cenário B re-analisado |
| 2 | blocking | Claim "Python sobe processo Node" baseado em blog pixeljets (secundário low-quality) | Substituído por fonte primária parcial: [3] módulo `_transport` (resolvido completamente em rodada 2) |
| 3 | blocking | D1 free tier = 500MB por DB omitido em §6.2.3 | Explicitado em §6.2.3 e §7-C7 |
| 4 | blocking | "Playwright Docker = 2GB+ RAM" rotulado grade A triangulated mas vinha de Medium relato | Claim quantitativo removido |
| 5 | must-fix | "Postgres trancado" usado como muleta circular contra Cloudflare | §6.6 explícito: D1 cobre tecnicamente; trava é escolha de DX/portabilidade |
| 6 | must-fix | Browser-as-a-service alternativas omitidas (Browserless, BrightData, Apify) | Incluídas em §6.5 e §8 com justificativa referenciada ao POC [1] |
| 7 | must-fix | Preço CX22 Hetzner não verificado independentemente | Verificado via [8] e [9] |
| 8 | must-fix | VPS alternatives omitidas (DigitalOcean, Contabo) | Adicionados §6.2.1 e §8 |
| 9 | must-fix | "Partial-A" inconsistente | Tabela §7 reformulada com critério claro |
| 10 | must-fix | "120 concurrent" Cloudflare apresentado fora de contexto | Contextualizado |
| 11 | must-fix | Auto-revisão crítica apresentada como mitigação | §9.6 admite inadequação; follow-up para rodar critic real (cumprido) |
| 12 | must-fix | POC era follow-up — agora foi feito | Movido para §4 como evidência empírica [1] |
| 13 | must-fix | Citação tRPC imprecisa | Reformulado |
| 14 | must-fix | Coluna "Falha #1 12m" cenário B assumia timeout 10s | Recalculado §6.7 |
| 15 | must-fix | Custo de migração saída Cloudflare não quantificado | Estimativa adicionada (depois removida em rodada 2) |
| 16-20 | suggestion (vieses) | Gold-fence contra Cloudflare, cherry-picking pixeljets, pessimismo Oracle, POC antecipado, métricas frontmatter self-calculadas | Cada um endereçado nas seções referenciadas pelo critic |

### Rodada 2: v0.2 → v0.3

| # | Classification | Weakness | Action taken |
|---|---|---|---|
| R2.1 | blocking | Claim "Python sobe subprocesso Node" citava apenas módulo `_transport` [3]; o que prova que o subprocesso é Node está no módulo `_driver` (arquivo diferente, não citado) | Adicionada fonte [4] `_driver` (WebFetch confirmou que a função de resolução retorna `node`/`node.exe` + `cli.js`). §6.1 e §7-C2 reescritos com [3][4] |
| R2.2 | must-fix | POC mostrava `fixturesDetected: 549` mas relatório citava 183 — números corretos em sentidos diferentes, mas sem esclarecimento | §4 e §6/§7-C15 explicitam: 549 = count heurístico (over-selection); 183 = count canônico de rows via grep em `snapshot.html` com seletores 1:1 `.fixture-team-home` e `.fixture-ko-time` |
| R2.3 | must-fix | Workers Paid $5/mês listado como "referência de mercado sem fonte primária" | Adicionada fonte [15] Cloudflare Workers Pricing (primária). Limitação §9.4 da v0.2 removida |
| R2.4 | must-fix | Argumento "20-40h migração saída Cloudflare" usado em §10 mas admitido sem base — circular | §10 (d) reescrito qualitativamente: "reescrever três peças simultaneamente", sem número. §9.4 mantém transparência |
| R2.5 | must-fix | "CX22 NÃO foi reajustado [9]" era argumento por silêncio — fonte não exclui CX22 explicitamente | §6.2.1 e §7-C4 reescritos: "ausência sugere isenção mas não é declarada"; grade rebaixada A→B |
| R2.6 | must-fix | Fonte Oracle citada sem URL, e relatos de capacity issues sem fonte rastreável | Substituída por [18] URL docs Oracle oficial; adicionada [19] `hitrov/oci-arm-host-capacity` como fonte community canônica (>10k stars) |
| R2.7 | suggestion | `cloudflareSignals` no POC merecia desambiguação CDN vs challenge | §4 explicita: menção textual ao CDN no HTML, sem Turnstile/cf-chl-bypass/checking-your-browser |
| R2.8 | suggestion | Coluna "Source Quality" vs "Triangulation Status" misturadas | Nota explicativa em §7 sobre "single-A" |
| R2.9 | suggestion | Explicitar systemd timer vs crontab na recomendação §10 | §10 e §6.4 citam **systemd timer** explicitamente |

## 13. References

1. [POC Scraper Adam Stats](.poc/scraper-test/) — local, 2026-05-10. Playwright 1.59.1 headless Chromium contra adamchoi.co.uk/fixtures: status 200, sem Cloudflare challenge, AngularJS, 549 heurístico / 183 canônico (`result.json` + grep em `snapshot.html`).
2. [Playwright Languages](https://playwright.dev/docs/languages) — playwright.dev. Suporte oficial JS/TS, Python, Java, .NET.
3. [playwright-python `_transport` module](https://github.com/microsoft/playwright-python/blob/main/playwright/_impl/_transport.py) — github.com/microsoft. Implementa o pipe stdin/stdout entre Python e o subprocesso driver.
4. [playwright-python `_driver` module](https://raw.githubusercontent.com/microsoft/playwright-python/main/playwright/_impl/_driver.py) — github.com/microsoft. Função de resolução do executável retorna `node` (ou `node.exe`) + `cli.js`.
5. [Playwright Node API](https://playwright.dev/docs/api/class-playwright) — playwright.dev.
6. [Playwright System Requirements](https://playwright.dev/docs/intro#system-requirements) — playwright.dev.
7. [microsoft/playwright](https://github.com/microsoft/playwright) — github.com/microsoft. Matriz de bindings oficiais.
8. [Hetzner Cloud Pricing](https://www.hetzner.com/cloud) — hetzner.com. CX22 €3.79/mês.
9. [Hetzner Preisanpassung April 2026](https://www.hetzner.com/news/preisanpassung-2026/) — hetzner.com. Tabelas listam CX23+; CX22 ausente.
10. [Netlify Functions overview](https://docs.netlify.com/build/functions/overview/) — docs.netlify.com. 60s timeout sync.
11. [Netlify Background Functions](https://docs.netlify.com/build/functions/background-functions/) — docs.netlify.com. 15min, Paid-only.
12. [Cloudflare Workers Limits](https://developers.cloudflare.com/workers/platform/limits/) — developers.cloudflare.com.
13. [Cloudflare Browser Rendering](https://developers.cloudflare.com/browser-rendering/) — developers.cloudflare.com. 10min/dia free, 60s/browser.
14. [Cloudflare D1 Pricing](https://developers.cloudflare.com/d1/platform/pricing/) — developers.cloudflare.com. Free 5GB total / 500MB por DB / 10 DBs.
15. [Cloudflare Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/) — developers.cloudflare.com. Paid $5/mês mínimo.
16. [Neon Pricing](https://neon.tech/pricing) — neon.tech. Hobby $19/mês.
17. [Supabase Pricing](https://supabase.com/pricing) — supabase.com. Free pausa após 7 dias.
18. [Oracle Always Free Resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) — docs.oracle.com. Ampere A1 4 OCPU/24GB; capacity + idle reclamation.
19. [hitrov/oci-arm-host-capacity](https://github.com/hitrov/oci-arm-host-capacity) — github.com. Repo community canônico (>10k stars).
20. [systemd.timer(5)](https://www.freedesktop.org/software/systemd/man/systemd.timer.html) — freedesktop.org. Logs journalctl, retry policies, on-boot.
21. [GitHub Actions schedule](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#schedule) — docs.github.com. Delay até ~1h em alta carga; 2k min/mês private.
22. [node-postgres (pg)](https://node-postgres.com/) — node-postgres.com. Driver pg para Node.
23. [browserless/browserless](https://github.com/browserless/browserless) — github.com. SSPL-1.0 OR Commercial; self-host Docker grátis para non-commercial.
24. [Hetzner Status](https://status.hetzner.com/) — status.hetzner.com. Track record público.

---

## Version log

| Date | Version | Change | Author |
|---|---|---|---|
| 2026-05-10 | 0.1 | Versão inicial (não publicada). Reprovada pelo `research-critic` com 4 blocking, 11 must-fix, vieses identificados. | pilot+claude+researcher |
| 2026-05-10 | 0.2 | Pós-POC empírico + incorporação dos 20 findings do critic v0.1. POC `.poc/scraper-test/` adicionado como fonte primária [1]. Recomendação mantida (Node/TS + Hetzner CX22 + Postgres self-host), razões reforçadas por evidência empírica. Browserless/Contabo/DO incluídos. Não publicada — critic v0.2 encontrou 1 blocking + 5 must-fix. | pilot+claude+researcher |
| 2026-05-11 | 0.3 | Endereçou critic v0.2: 1 blocking (módulo `_driver` adicionado em [4]) + 5 must-fix (POC 549/183 esclarecido; Workers Paid pricing primária [15] adicionada; lock-in qualitativo; CX22 reajuste como argumento por silêncio; Oracle [18]+[19] com URLs) + 3 suggestions (cloudflareSignals desambiguado, systemd timer explícito). Recomendação central inalterada. Status: completed. | pilot+claude+researcher |
| 2026-05-11 | 0.4 | **Pilot override**: nova §10.1 registra escolha de Ruby 4.0.3 em vez de Node/TS (recomendação técnica de §10). POC adicional `.poc/ruby-scraper-test/` validou Ruby 4.0 + playwright-ruby-client + Nokogiri. Trade-offs aceitos documentados. Follow-ups (ADRs 1-5) marcados como concluídos — referência em `CLAUDE.md`. | pilot+claude |
