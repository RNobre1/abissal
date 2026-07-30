# Revisão geral por 30 personas — 2026-07-30

Brainstorm multi-perspectiva sobre o sistema inteiro, com foco em **mobile
(412px)** e depois desktop. Cada persona leu o código e um briefing com números
medidos em produção no mesmo dia.

**Tudo que está marcado ✅ VERIFICADO foi conferido por mim no código depois da
resposta da persona** — o resto é opinião fundamentada, não fato confirmado.

---

## 1. Bugs confirmados (verificados no código, não são opinião)

Ordenados por gravidade.

### 1.1 ✅ O painel de acerto por liga mistura v7 e v8 — bug meu, de ontem

`lib/calibracao/league-accuracy-repository.ts#fetchRows` recebe `modelVersion`
como parâmetro, mas **só o usa para buscar o `distK`** — a query principal filtra
`status`, `league` e `sim_stats`, nunca `model_version`.

Consequência: o painel que deveria medir o motor v8 (consertado ontem, erro de
escanteios de +57% para +10%) está contaminado com linhas v7 antigas — exatamente
o motor quebrado que motivou o bump. Os números que o Pilot viu hoje na tela
("cartões 75%", "escanteios −22pp") são de uma mistura de duas versões.

Correção: uma linha, `.eq("model_version", modelVersion)`. Mas cuidado — hoje
existem 207 sims v8 resolvidas contra 2.358 v7. Filtrar corretamente derruba a
amostra e provavelmente esconde o painel em várias ligas (gate de 30 chamadas).
**A decisão de produto é do Pilot:** número certo com amostra pequena, ou
número contaminado com amostra grande? Recomendo o primeiro, com o aviso de
amostra que o painel já tem.

### 1.2 ✅ `balance_snapshots` nunca funcionou — e derruba `/forecast` junto

Cadeia completa, toda verificada:
- `0003_balance_snapshots.sql:86` — `grant execute … to service_role` apenas.
- `0005_security_hardening.sql:16` — `revoke execute … from public, anon, authenticated`.
- `0014_banca_loop.sql:22` — `resolve_bet` é **`security invoker`**.
- `0014_banca_loop.sql:111` — `resolve_bet` chama `PERFORM generate_balance_snapshots(...)`.
- `0014_banca_loop.sql:113` — o erro cai num `RAISE WARNING`, silencioso.

Ou seja: o app chama `resolve_bet` como usuário autenticado, que tenta executar
uma função para a qual esse papel **não tem permissão**, falha, e o erro é
engolido. `balance_snapshots` tem 0 linhas. `daily_pl_view` fica vazia.
`/forecast` mostra "ainda cedo demais" para sempre. Não é falta de cron — é
permissão, e falha desde a migration 0014.

Correção possível: `grant execute … to authenticated`, ou (melhor) tirar a
chamada de dentro do RPC do usuário e rodar por cron com `service_role`.

### 1.3 ✅ Os guards de disciplina são contornáveis e, num caminho, inexistentes

- `app/api/ai-reco/apostei/route.ts` — **zero** menções a `checkDisciplinaLimits`
  e **zero** a `thesis`. O caminho "✅ Apostei" direto da recomendação não checa
  stop-loss, nem limite diário, nem cooldown, e descarta a tese digitada.
- `place_bet` e `resolve_bet` (`0006_bet_rpcs.sql:34,164`) são **`security
  invoker`** com `grant … to authenticated`. Estão expostos via PostgREST: dá
  para chamá-los do console do navegador já logado e pular *todos* os guards,
  que vivem só na camada Next.js.
- `lib/disciplina/disciplina-guard.ts:63` — falha **aberto**: erro na query ou
  config ausente devolve `allowed: true`.

Isso explica de forma completa o fato de **0 das 20 apostas terem tese**: o
portão existe na tela, não no banco.

### 1.4 ✅ Sentry está configurado no ambiente mas não existe no código

`SENTRY_DSN` e `NEXT_PUBLIC_SENTRY_DSN` estão no `.env.example` e passam pelo
`deploy.yml`. Mas `@sentry/*` não está no `package.json`, e não há
`instrumentation.ts` nem `sentry.*.config.*`. **Zero rastreamento de erro em
produção.** Se o Worker quebrar num domingo, ninguém fica sabendo.

### 1.5 ✅ `analysis_cache` é cache morto — o arquivo nem existe

O `CLAUDE.md` lista `lib/fixtures/analysis-cache.ts` na estrutura de diretórios.
**O arquivo não existe.** Nenhuma rota lê ou grava por `content_hash`. Com p95 do
LLM em 153s, toda reabertura do mesmo jogo paga a análise inteira de novo.

### 1.6 ✅ Rotas sem autenticação

- `app/api/fixtures/route.ts` — GET público, sem auth, sem rate limit, usando
  `createAdminClient()` (que ignora RLS).
- `lib/bet-slip-ocr/parse-photo-action.ts` — Server Action sem `getUser()`,
  invocável por POST. Drena crédito de LLM.
- `app/api/telemetry/route.ts` — usa `createAdminClient()`, o que torna a
  política RLS da migration 0038 letra morta para essa rota. O único freio é
  rate limit em memória por IP e por `session_id`, que vem do próprio payload.
  **Já explorado:** 700 dos 873 eventos são lixo (`"xxxxx…"` ×500, `"spam"` ×200).

### 1.7 ✅ Tokens de cor que não existem

- `--color-positive` (usado em `simulation-panel.tsx`): **não existe** em `globals.css`.
- `--color-green` e `--color-amarelo` (~17 ocorrências em `components/calibracao/`):
  **não existem**.

Todos usam `var(--token, #hex)` — então o hex sempre vence. Os tokens corretos
(`--color-success: #38a870`, `--color-warning: #b87a1a`) existem e são usados
no resto do app. A tela de calibração roda numa paleta paralela acidental.

### 1.8 ✅ O B52 ficou pela metade

`lib/fixtures/stats/derive.test.ts:703` ainda tem
`it("treats nulls as zeros when populating series")` — a mesma classe de bug que
consertei ontem, no mesmo arquivo, num teste vizinho que não foi tocado.

### 1.9 ✅ `/fixtures/[id]/stats` é só um redirect

A rota que o ADR-005 descreve como o dashboard de 11 painéis hoje redireciona
para `/fixtures/[id]`. O `CLAUDE.md` está desatualizado nesse ponto.

### 1.10 ✅ `fit-temperature.ts` fita e persiste sem validação fora da amostra

`fit-isotonic.ts` ganhou em 29/07 um gate out-of-sample (5 cortes temporais,
decisão por maioria) depois que se descobriu curva ativa pior que a crua. O
`fit-temperature.ts` — que roda no mesmo cron semanal — calcula o log-loss na
**mesma** amostra do fit e grava se `n≥300`. É a assinatura exata do
walk-forward-bomb (B24).

### 1.11 ✅ Contraste abaixo do mínimo

`--color-ink-faint` (`#898782`) mede **4,45:1** sobre `--color-surface-3` —
abaixo do mínimo 4,5:1 da WCAG AA. É a cor da classe `.label` (10px), usada em
dezenas de lugares, incluindo os cabeçalhos da tabela de simulação. O axe não
pega porque testa combinações montadas, não essa em particular.

---

## 2. Convergências fortes (≥3 personas independentes)

### A. O laço "decidir → apostar → aprender" está aberto — 8 personas

IHC, Sharp Bettor, Systems Thinker, PO, Behavioral Economist, UX Researcher,
Power User e Devil's Advocate chegaram nisso por caminhos diferentes.

O fato: **0 de 20 apostas têm `ai_recommendation_id`; 0 têm tese.** A causa não
é indisciplina do usuário, é **affordance ausente** — `/bets/new` (o caminho
óbvio, pelo menu) não tem o campo, não aceita query param, e `bets/[id]` não
permite vincular depois. Quem registra pelo caminho natural perde o vínculo
irreversivelmente.

Consequência sistêmica: a calibração aprende só com a simulação contra o
resultado do jogo. **Nunca com a decisão.** Não há como responder "seguir a IA
teria sido melhor do que o que eu fiz?".

### B. As proteções anti-tilt são decorativas — 4 personas

Recovery, Adversary, CRO e Behavioral Economist. Ver 1.3. Some-se: o bot do
Telegram (`scripts/telegram/send-reco-alerts.ts`) manda até 25 sugestões por dia
**sem consultar `disciplina_settings`** — se o stop-loss estourou dentro do app,
o Telegram continua empurrando fora dele.

### C. A telemetria não mede nada — 5 personas

Time-on-Task, PO, SRE, Security e Performance. Além do lixo: o
`IntersectionTracker` (que preencheria `panel_id`) existe em `lib/telemetry/` e
**nunca é renderizado em lugar nenhum**. `reco_viewed` aparece 1× no banco e
**zero vezes no código** — é resíduo de teste manual.

### D. A espera de 153s é o maior vazamento de confiança — 4 personas

Motion, Content Designer, Mobile UX, Time-on-Task. O botão promete "até 1 min"
e o hint diz "~40s"; o p95 real é 153s. 49 cliques geraram 36 respostas — 13
sumiram. Proposta convergente: parar de prender a tela, confirmar "pedido
enviado, te aviso" e liberar a navegação.

### E. Cascata de awaits sequenciais na página do jogo — 2 personas, mas com evidência forte

Frontend e Performance contaram 8 a 10 round-trips em série antes do primeiro
byte, sendo que a maioria é independente. **A lição B23 já registrou exatamente
isso** ("6 awaits sequenciais → Promise.all") como follow-up — e não foi feito
nesta rota. Some-se: não existe `loading.tsx` nem `error.tsx` em lugar nenhum
do `app/`.

### F. Nenhum contrato com a fonte externa — 3 personas

QA, CDO e SRE. O fixture de teste do Choistats está congelado desde 12/05. Não
há validação de domínio na ingestão (nem Zod nem dry-schema). Foi exatamente
assim que o bug do `avgs` zerado passou 4 semanas.

### G. Domínio duplicado em TypeScript e Ruby, sem teste de paridade — CTO

`lib/ai-reco/edge-calculator.ts` e
`scripts/scraper/lib/scraper/ai_reco/edge_calculator.rb` implementam a **mesma
matemática** (edge, Kelly, tri-state de resultado) em duas linguagens, cada uma
com seus próprios testes — e **nenhum teste garante que as duas concordam**.

Essa é a classe de bug que já custou caro mais de uma vez no histórico: B25 (o
batch nunca aplicava a isotônica porque só o lado TS aplicava), B18 (variável de
ambiente vazia é *truthy* em Ruby e derrubou 43 chamadas), B19. Toda mudança de
calibração depende de alguém *lembrar* de portar para o outro lado — hoje isso é
vigilância humana, não teste.

Proposta do CTO, que acho a de melhor relação custo/benefício da lista inteira:
um *golden vector* — mesmo JSON de entrada, mesma saída esperada, rodado nas
duas suítes. Mata a classe toda.

O CTO explicitamente **não** recomenda unificar os runtimes: "o problema não é
ter dois runtimes, é não ter contrato entre eles".

---

## 3. Conflitos reais (onde as personas discordam)

**Densidade.** Neurodivergente quer um "modo decisão" com 4 painéis; Power User
quer mais poder e mais dados; Sharp Bettor quer menos ruído e mais rigor. Não
há resposta única — provavelmente é um toggle, não um default.

**O que fazer primeiro.** Devil's Advocate argumenta que consertar a fiação é
seguir cavando o mesmo buraco, e que a pergunta certa é se o sistema deveria
existir nessa forma. PO e UX Researcher argumentam que o loop quebrado é
justamente o que impede saber a resposta. Tensão legítima, e é do Pilot.

**Balance snapshots.** DB Engineer disse "falta wiring"; Bookkeeper disse "é bug
de grant". Verifiquei: o Bookkeeper está certo na causa (permissão), o DB
Engineer está certo no efeito (também não há cron). Os dois se somam.

---

## 4. A observação mais incômoda

O Devil's Advocate e o UX Researcher chegaram, independentes, ao mesmo ponto:

O que o usuário **mais faz** é clicar "pedir análise" (49 vezes) — recriando
manualmente, jogo a jogo, o que o cron já computou às 07:45. E o que ele
**ignora** são as 1.088 recomendações automáticas (1 visualização registrada).

A leitura do UX Researcher: o job real não é "me diga o que apostar"
(descoberta), é "me dá uma segunda opinião sobre o jogo que eu já escolhi"
(confirmação no momento do compromisso). O sistema foi construído para o
primeiro; o comportamento medido é o segundo.

Se isso estiver certo, a recomendação automática diária está resolvendo o
problema errado — e o lugar certo dela seria **dentro do builder do bilhete**,
no momento em que o Pilot monta a aposta, não numa lista separada de manhã.

É hipótese, não fato. Mas é testável.

---

## 5. Prioridade sugerida

**Consertar agora (bugs reais, escopo pequeno, alto retorno):**
1. Filtro de `model_version` no painel de liga (1.1) — o número está errado hoje.
2. `balance_snapshots` (1.2) — destrava `/forecast` e o histórico do ano.
3. Disciplina no caminho `apostei` + tese persistida (1.3).
4. Tokens de cor inexistentes (1.7) — find-replace.
5. `derive.test.ts:703` (1.8) — terminar o B52.

**Decisão de produto (do Pilot, não minha):**
6. Vincular aposta ↔ recomendação: onde entra o campo, e qual caminho de registro
   vira o oficial.
7. A recomendação automática deve migrar para dentro do fluxo do bilhete?

**Higiene com prazo:**
8. Sentry de verdade (1.4), auth nas 3 rotas abertas (1.6), limpar telemetria.
9. `Promise.all` na página do jogo + `loading.tsx` (convergência E).
10. Gate out-of-sample no `fit-temperature` (1.10) antes do cron de domingo.

**Não fazer agora:** particionamento de tabelas, Storybook, plataforma de
linhagem, A/B test (n=1), otimizar mais o bundle sem RUM medindo.
