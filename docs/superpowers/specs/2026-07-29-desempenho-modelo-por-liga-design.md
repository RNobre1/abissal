# Desempenho do modelo por liga, dentro do jogo

**Data:** 2026-07-29 · **Status:** desenho aprovado, pronto para plano de implementação

## Problema

`/calibracao` é completo e robusto, mas é uma tela de analista: quem está prestes a apostar
não vai até lá, e quando vai encontra Brier score e curvas de calibração — vocabulário que
não responde a pergunta prática.

A pergunta prática é: **"posso confiar no que a simulação está me dizendo neste jogo?"** E a
resposta depende da liga. O modelo não tem uma competência única; ele acerta bem escanteios
numa liga e mal em outra.

Falta a ponte entre a medição (que existe) e o momento da decisão (onde ela não aparece).

## Solução

Um painel dobrável em `/fixtures/[id]` que responde, em linguagem de apostador, quanto o
modelo acerta **naquela liga**, mercado por mercado — mais um símbolo `+`/`−` na tabela da
simulação que traduz cada projeção em lado de aposta.

Os dois são a mesma conta: o `−` diz "a simulação aponta menos de 9.5", e o painel diz
"nesta liga esse `−` acertou 61% das 52 vezes". Um dá sentido ao outro.

## Decisões

| # | Decisão | Motivo |
|---|---|---|
| 1 | Simulação recortada **por liga**; IA recortada **por mercado, global** | A IA tem 154 apostas resolvidas em 33 ligas — a liga com mais tem 15. Por liga seria ruído; por mercado global tem massa. |
| 2 | "Acerto" = **lado da linha de mercado, com convicção** | É a decisão de aposta real. 50% = zero skill, o que dá ao número uma régua honesta. |
| 3 | **Lib pura, derivada na leitura** — sem migration | O dado já existe; falta a função. Retroativo a 2.324 jogos e imune a mudança de critério. |
| 4 | **Painel dobrável** entre a reco e os painéis técnicos | Não rouba o topo nem se perde no rodapé. |
| 5 | Liga com n < 30 → **cai pro global, rotulado** | ~26 das 59 ligas. Esconder deixaria metade dos jogos sem informação. |
| 6 | Tendência recente: **cortada** | Backtest de 40 células mostrou 50-52% de acerto, lift negativo em 39. Ver `docs/pesquisas/tendencia-recente-poder-preditivo.md`. |

## O dado que já existe

Sondado em prod (2026-07-29):

- `fixture_simulations`: **3.531 jogos resolvidos**, janela 18/05 → 29/07, 75 ligas
- **2.324 plenamente mensuráveis** (têm `sim_stats` + os três actuals secundários), em 59 ligas
- mediana de **32 jogos por liga**; 33 ligas com n ≥ 30; 17 com n ≥ 50
- cobertura de actuals: **100% desde a semana 22** (o fix B19, 28/05). O déficit é dívida
  histórica de W20-W21, não pipeline quebrado.
- `ai_recommendations`: 154 apostas resolvidas (61 green / 93 red)

**Nenhuma migration é necessária.** `actual_corners_home/away`, `actual_cards_*`, `actual_sot_*`
e `actual_btts` já são populados pelo reconciler; `sim_stats` já traz p10/p50/p90 por time.

## Definição de acerto

O critério reusa exatamente o que a produção já usa para apostar — não inventa métrica.

**Linhas canônicas** (as mesmas de `lib/ai-reco/edge-calculator.ts`):

| mercado | linhas | origem da média |
|---|---|---|
| escanteios | 8.5 · 9.5 · 10.5 | `sim_stats.home.corners.p50 + away.corners.p50` |
| cartões | 3.5 · 4.5 · 5.5 | idem, `cards` |
| finalizações no alvo | 7.5 · 9.5 · 10.5 | idem, `shots_on_target` |
| gols (over/under) | 2.5 | `p_over_25` (escalar direto) |
| 1x2 | — | `p_home`/`p_draw`/`p_away` → `correct_winner` |
| BTTS | — | `p_btts` vs `actual_btts` |
| placar exato | — | já coberto por `lib/calibracao/scoreline-accuracy.ts` |

**Conversão média → probabilidade:** `poissonProbOver(mean, line)` de `lib/ai-reco/dist-helpers.ts`,
com a calibração de distribuição (`dist-k`) aplicada — a mesma composição que o recomendador usa.
Um número que aparece no painel de acerto é o mesmo que aparece no edge da reco.

**Chamada e acerto:**

- `P ≥ 0.55` → chama **over**; `P ≤ 0.45` → chama **under**; entre os dois → **sem chamada**,
  não conta no denominador
- acerto = o lado chamado bateu contra `actual_home + actual_away` vs a linha
- push (total exatamente na linha) é impossível: todas as linhas são meias

**Baseline obrigatório.** Cada percentual vem acompanhado da **taxa-base** — o acerto de
chutar sempre o lado majoritário naquela liga e mercado. Sem isso, um `−` enviesado para o
under parece competente sem ser: é a armadilha documentada em
`docs/pesquisas/tendencia-recente-poder-preditivo.md` e no walk-forward de 2026-05-25.

O que o painel destaca é o **lift**, não o acerto cru.

## Arquitetura

Três unidades, cada uma testável sozinha.

### 1. `lib/calibracao/market-accuracy.ts` — lib pura

```
marketCall(simStats, market, line, distK) → { side: 'over'|'under'|null, prob }
marketOutcome(actuals, market, line)      → boolean | null
leagueAccuracy(rows, opts)                → AccuracyByMarket[]
```

Sem I/O, sem Supabase, sem React. Entra `sim_stats` + `actual_*`, sai acertou/errou. Serve o
painel, `/calibracao` e qualquer backtest futuro com o mesmo código — nenhuma segunda
definição de acerto pode divergir dela.

`AccuracyByMarket` carrega: `market`, `line`, `calls`, `hits`, `rate`, `baseRate`, `lift`,
`ci95`, `sampleTier` (`'liga'` | `'global'`).

### 2. `lib/calibracao/league-accuracy-repository.ts` — acesso

Busca as linhas resolvidas **filtrando por liga no Postgres**, trazendo só as colunas
necessárias (`sim_stats`, `actual_*`, `league`). Uma liga mediana devolve ~32 linhas; a maior
(Primera B Nacional), 162.

**Restrição de plataforma:** o Worker Cloudflare é frágil com payload — as outages 1101 e 1102
do projeto vieram exatamente de arrastar dados demais (B12/B14/B21/B23). O agregado global
(fallback de amostra baixa) **não** pode varrer os 2.324 jogos por request: é computado uma vez
e memoizado por processo, com `revalidate` na rota. Se medir pesado em produção, o passo
seguinte é empurrar a agregação para SQL, no molde do `fixture_badges_view` (B14) — não
aumentar o payload.

### 3. `components/fixtures/model-performance-panel.tsx` — UI

Server Component, recolhido por padrão, entre a `DecisionZone` e os painéis técnicos em
`app/(dashboard)/fixtures/[id]/page.tsx`. Entra como um `PanelSlot` no `StatsLayout`
existente.

**Recolhido** — uma manchete em linguagem direta:

```
▸ desempenho do modelo nesta liga (Serie B · 104 jogos)
  acerta bem escanteios e cartões · fraco em finalizações
```

**Expandido** (números ilustrativos — o layout é o que está sendo especificado):

```
                        chamou    acertou           vs chutar
escanteios  menos 9.5      52       63%  ▓▓▓▓▓▓░░░░    +9pp
cartões     menos 4.5      48       71%  ▓▓▓▓▓▓▓░░░   +12pp
gols        menos 2.5      61       58%  ▓▓▓▓▓░░░░░    +2pp
finalizações menos 7.5     44       49%  ▓▓▓▓▓░░░░░    −6pp
1x2         favorito       104      54%  ▓▓▓▓▓░░░░░    +7pp
placar exato top-1         104      11%  ▓░░░░░░░░░     —

apostas da IA (todas as ligas · 154 resolvidas)
cartões                     30       57%                +4pp
escanteios                  66       41%                −9pp
```

Regras de exibição:

- **n < 30 na liga** → mostra o global com rótulo explícito: *"poucos jogos na Serie B (n=12) —
  mostrando o geral de todas as ligas"*
- **lift negativo** é mostrado, não escondido. "A simulação é ruim em finalizações nesta liga"
  é a informação mais valiosa da tela.
- sem Brier, sem log-loss, sem curva de calibração — isso continua em `/calibracao`
- IC95 (Wilson, via `lib/calibracao/wilson-ic.ts`) fica no tooltip, não no corpo

### 4. O `+`/`−` na tabela da simulação

Em `app/(dashboard)/fixtures/[id]/_components/simulation-panel.tsx`, na tabela `STAT_ROWS`
(linha 156), uma coluna à direita do total:

```
                      casa   fora   total
Gols                   1.4    1.1    2.5   −    menos de 2.5 · 57%
Escanteios             6      4      9.4   −    menos de 9.5 · 58%
Cartões                1      2      3.1   −−   menos de 4.5 · 79%
Finalizações no alvo   5      2      7.2   ≈    sem chamada · 52%
```

`−`/`+` = convicção ≥ 55% · `−−`/`++` = ≥ 70% · `≈` = sem chamada.

Vem de `marketCall()` — o mesmo `P` que o painel de acerto mede. Métricas sem linha canônica
(faltas, impedimentos, desarmes) não recebem símbolo.

## Estratégia de testes

TDD, testes antes da implementação.

**Unitários** (`lib/calibracao/market-accuracy.test.ts`) — o grosso da cobertura, porque a lib
é pura:

- chamada over/under/nenhuma nos limiares exatos (0.55, 0.45) e nas bordas
- acerto e erro contra a linha, incluindo total exatamente adjacente (9 e 10 contra 9.5)
- `sim_stats` faltando, malformado, ou com um dos lados nulo → `null`, nunca exceção
- `actual_*` nulo → fora do denominador (não conta como erro)
- taxa-base calculada sobre o universo, não sobre as chamadas
- Wilson com n=0, n=1, e acerto 100%

**Contra o produtor real** (`lib/calibracao/market-accuracy.integration.test.ts`) — lição dura
do projeto: quatro bugs da mesma classe vieram de testar contra um shape inventado em vez do
shape real. A fixture vem de uma linha real de `fixture_simulations`, congelada no repo.

**Componente** — painel com n alto, com n baixo (fallback global), com liga sem dado nenhum,
e com lift negativo (tem que aparecer, não sumir).

**E2E** (`tests/e2e/`) — o painel abre e fecha; um jogo real mostra número coerente. Read-only,
sem escrita na banca.

## Fora de escopo

- Migration ou coluna nova — nada aqui precisa
- Símbolo de tendência recente, e persistir a inclinação — podado por evidência
- Recorte de IA por liga — volta quando houver n ≥ 30 em alguma
- Backfill dos 1.172 jogos de W20-W21 sem actuals — dívida velha, não bloqueia
- Brier/log-loss no painel do jogo — continua em `/calibracao`
- Linhas de escanteio por time (só total do jogo, que é o que tem linha canônica)

## Riscos

| Risco | Mitigação |
|---|---|
| Usuário lê 63% como promessa | Taxa-base e lift sempre ao lado; o número sozinho nunca aparece |
| Amostra pequena vira ruído confiante | Corte em n=30 com fallback global rotulado |
| Payload/CPU no Worker (1101/1102) | Filtro por liga no Postgres; global memoizado; pushdown SQL se medir pesado |
| Definição de acerto divergir do edge da reco | Mesmas linhas, mesmo `poissonProbOver`, mesmo `dist-k` — uma definição só |
| Janela de 2,5 meses vira "verdade eterna" | Painel declara a janela e o n no cabeçalho |
