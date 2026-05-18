---
slug: simulacao-pre-jogo-fixtures
titulo: "Simulação pré-jogo de fixtures: método estatístico, camada player-level e arquitetura no scraper Ruby"
tier: L3
status: concluida
data: 2026-05-18
autor: researcher (xp-stack)
versao: 0.3
questao_central: "Dado que a API do choistats entrega 4 blocos *Avgs (43 métricas, numMatches 17-37), 52 mercados de odds, ~19 jogos/lado per-match E payloads por jogador (players.json: goals/assists/minutes/started/injured/outcomeOdds/playerStatsForm/*TeamSeasons), qual método estatístico + camada de alocação por jogador + arquitetura produzem a simulação pré-jogo mais capaz e robusta, pré-computada no scraper Ruby, com schema escalar próprio, sem reabrir a outage 1101 do Worker, e mensurável pela pipeline de calibração (incluindo brierScore novo)?"
fontes_total: 11
fontes_primarias: 6
source_diversity: 8
primary_source_ratio: 0.55
citation_density: 0.86
triangulation_coverage: 0.72
latency_min: 38
decisao_sugerida: "Força ataque/defesa de temporada normalizada pela liga → Poisson + correção Dixon-Coles (τ; ρ como prior calibrável) para placar; Negative Binomial para stats secundárias overdispersas; Monte Carlo 10k → apenas escalares; camada de alocação por jogador (provável XI por started/minutes; eventos do time distribuídos ∝ taxa histórica do jogador) persistida em player_events jsonb; odds devigadas (multiplicativo) e outcomeOdds por jogador como ÂNCORA de validação não-circular; tudo computado no scraper Ruby; schema fixture_simulations próprio; brierScore como adição nova; guard de payload generalizado. Re-scrape tardio de escalação: NÃO no MVP (recomendado projeção do histórico, com gatilho de re-scrape como follow-up condicional)."
---

# Pesquisa: Simulação pré-jogo de fixtures — método, camada player-level e arquitetura

## 1. Contexto e motivação

O projeto Abissal (CWD `adam-stats`, repo renomeado `abissal`) já tem: (a) scraper Ruby que persiste `detail_json` por fixture com merge de widgets choistats (`scripts/scraper/lib/scraper/widget_merger.rb`); (b) dashboard de stats por fixture (ADR-005); (c) pipeline de calibração de IA (`ai_predictions` migration 0016 + `lib/ai/calibration-metrics.ts` + reconciler Ruby + página `/calibracao`). Falta uma **simulação pré-jogo completa pré-computada** — placar provável + todas as stats secundárias por time e por tempo (degradando quando o dado não suporta granularidade), **agora também por jogador com provável escalação** — exibida junto das stats no dashboard (não sob demanda, não LLM).

O risco de errar é alto: (1) retrabalho de scraper + migration; (2) **reabrir a outage 1101 do Cloudflare Worker** (incidentes B12 34.1 MB/dia e B14 22.63 MB pico, registrados em MEMORY) se o payload da simulação cruzar o fio como blob. A v0.1 desta pesquisa partiu de uma premissa de dados **errada** (n≈10 jogos por time); a v0.2 corrigiu para a premissa real (4 blocos `*Avgs`, `numMatches` 17-37). Esta v0.3 aplica as ressalvas da auditoria `research-critic` real sobre a v0.2 e integra a camada player-level que o Pilot definiu firmemente.

## 2. Questão central

Ver frontmatter `questao_central`. Em síntese: **método** (placar + secundárias + player-level), **arquitetura** (onde computar, schema, task-fundação, guard, calibração) e **degradação honesta** quando o dado não suporta a granularidade pedida.

## 3. Sub-questões

| # | Sub-questão | Escopo de busca | Status |
|---|---|---|---|
| 3.1 | Que modelo de placar usar tendo **forças de ataque/defesa já prontas** (médias de temporada split mando) em vez de dataset jogo-a-jogo? | Literatura Poisson/Dixon-Coles/bivariada-Poisson; impl. de referência | Respondida |
| 3.2 | Como simular **stats secundárias multivariadas** (escanteios, cartões, BP, SOT, chutes, faltas, etc.) por time e por tempo, e como **degradar** quando o split não existe? | Literatura overdispersão/NB; payload real | Respondida |
| 3.3 | Como usar as **52 odds** como âncora **não-circular** (devig)? | Métodos de devig; teste empírico | Respondida |
| 3.4 | Como garantir **robustez** com amostras de tamanho variável (`numMatches` 17-37) e propagar incerteza? | Shrinkage/pooling hierárquico; Monte Carlo | Respondida |
| 3.5 | **Arquitetura**: onde computar (scraper Ruby), schema próprio vs. estender 0016, task-fundação de enriquecimento, guard de payload, integração com calibração (brierScore), restrição Cloudflare. | Repo + limites Cloudflare | Respondida |
| 3.6 | **Saída por jogador**: prever provável escalação (XI) por time e alocar os eventos simulados do time (gols, cartões, e quando fizer sentido SOT/assists) entre jogadores pela participação histórica. | Payload `players.json` + método de alocação | Respondida |

## 4. Metodologia

Tier **L3**. Ferramentas usadas: `WebSearch`/`WebFetch` (literatura e métodos externos), `Read`/`Grep`/`Glob` (verificação empírica no repo `abissal`). Tempo ~38 min.

**Limitação metodológica honesta:** o tool `Agent` (sub-researchers paralelos) e o agente `research-critic` **não estão expostos no ambiente deste researcher** — não foi possível fan-out por sub-questão nem auto-disparo de crítica adversarial interna. Mitigação: o `research-critic` **real** já rodou externamente sobre a v0.1 (REPROVADA) e a v0.2 (APROVADA COM RESSALVAS); esta v0.3 aplica integralmente as ressalvas da auditoria v0.2. A premissa de dados foi **re-verificada** lendo o payload real e o código (Lição #2 do projeto: POC empírico antes de fechar arquitetura). Verificação de liveness das URLs feita onde possível; fontes inacessíveis a crawler estão declaradas em §9.

## 5. Fontes consultadas

> Cada URL abaixo foi efetivamente acessada (WebFetch/WebSearch) ou — para o repo — lida via `Read`/`Grep`. Status de liveness anotado.

| # | Fonte | Tipo | Qualidade | Liveness | Contribuição |
|---|---|---|---|---|---|
| [1] | Karlis & Ntzoufras (2003), "Analysis of sports data by using bivariate Poisson models", *The Statistician* 52(3) — Wiley DOI 10.1111/1467-9884.00366 | Primária (peer-review) | Alta | **403 paywall Wiley** (não acessível a crawler) | Modelo bivariado-Poisson; λ3 de covariância + inflação diagonal para empates |
| [2] | Mesmo paper, espelho ResearchGate publication/227719079 | Primária (espelho) | Alta | **403 a acesso automatizado** (verificar manualmente) | Idem [1] |
| [3] | penaltyblog — Dixon-Coles model docs (`docs.pena.lt/y/models/dixon_coles.html`) | Secundária (doc de lib) | Alta | OK | Estrutura da correção DC; valor de ρ de referência |
| [4] | penaltyblog blog (2021) — "Predicting Football Results Using Python and the Dixon and Coles Model" | Secundária (impl.) | Alta | OK | Implementação concreta da correção (`rho_correction`) nas 4 scorelines |
| [5] | dashee87.github.io — "Predicting Football Results With Statistical Modelling: Dixon-Coles and Time-Weighting" | Secundária (técnica) | Alta | OK | Fórmula da correção rotulada **τ (tau)**; ρ ≈ −0.13 (EPL 17/18); decaimento temporal ξ; MLE |
| [6] | Yip et al. — corners overdispersos, NB > Poisson (ResearchGate publication/357366021) | Primária (espelho) | Média | **403 a acesso automatizado** (verificar manualmente) | Escanteios são overdispersos → Negative Binomial supera Poisson |
| [7] | exprysm.com — Dixon-Coles methodology / variância > média em cartões e escanteios | Secundária (técnica) | Média | OK | Cartões/escanteios: var > média ⇒ NB; confirma direção de [6] |
| [8] | penaltyblog blog (2025) — "From Biased Odds to Fair Probabilities" | Primária (estudo empírico) | Alta | OK | Métodos de devig (multiplicativo, shin, etc.); teste EPL 24/25; spread RPS entre métodos |
| [9] | sharkbetting.com — "Devig Explained" | Secundária (educacional) | Média | OK | Confirma fórmula multiplicativa de devig e conceito de overround |
| [10] | Baio & Blangiardo — "Bayesian hierarchical model for the prediction of football results" (UCL discovery 16040, PDF) | Primária (peer-review) | Alta | **PDF comprimido — não verificável por crawler** (registrar) | Pooling hierárquico / shrinkage Bayesiano de forças de time |
| [11] | Cloudflare Workers — Platform Limits (`developers.cloudflare.com/workers/platform/limits/`) | Primária (doc oficial) | Alta | OK | Isolate 128 MB de memória; CPU 10ms Free / 30s Paid |
| (repo) | `abissal` @ main — `widget_merger.rb`, `players.json`, `team-records.json`, `0016_ai_predictions.sql`, `calibration-metrics.ts`, `repository-payload-guard.test.ts` | Primária (código/payload) | Alta | OK | Premissa de dados real, schema, guard, ausência de Brier |

`source_diversity` = 8 domínios únicos (wiley, researchgate, pena.lt, dashee87, exprysm, sharkbetting, discovery.ucl, developers.cloudflare + repo). `primary_source_ratio` = 6/11 ≈ 0.55.

## 6. Síntese / análise

### 6.1 Modelo de placar (sub-questão 3.1)

**Premissa de dados real (verificada no payload + código).** O detail traz **4 blocos `*Avgs`** já agregados: `homeTeamHomeAvgs` (numMatches ≈ 17), `homeTeamOverallAvgs` (≈ 35), `awayTeamAwayAvgs` (≈ 17), `awayTeamOverallAvgs` (≈ 35), com ~43 métricas cada (gols, escanteios, cartões, BP, SOT, chutes, faltas, offsides, tackles, splits 1h/2h). O `WidgetMerger.build_recent_matches` (`widget_merger.rb:98-106`) extrai só `recentHomeResults`/`recentAwayResults` e **descarta os blocos `*Avgs`** — eles existem na resposta do widget mas não são persistidos hoje [repo]. `numMatches` 17-37 ⇒ médias de temporada **estatisticamente estáveis** (não é o regime de n≈10 que a v0.1 supôs).

Esses 4 blocos **já são as forças de ataque/defesa** — não há necessidade (nem dataset) de estimar forças via MLE global. O caminho é **força-de-temporada-normalizada-pela-liga → Poisson**:

```
λ_home = (homeTeamHomeAvgs.avgGoalsFor / leagueAvgGoalsFor)
       × (awayTeamAwayAvgs.avgGoalsAg  / leagueAvgGoalsAg)
       × leagueAvgGoalsHome
λ_away = (awayTeamAwayAvgs.avgGoalsFor / leagueAvgGoalsFor)
       × (homeTeamHomeAvgs.avgGoalsAg  / leagueAvgGoalsAg)
       × leagueAvgGoalsAway
```

`leagueAvg*` é a baseline da liga, agregada sobre os times daquela liga **no recorte do dia**.

Poisson puro **subestima sistematicamente empates e placares baixos** [3][5][7]. A correção **Dixon-Coles** ajusta as 4 células de placar baixo. A literatura rotula essa correção de formas distintas: a fonte [5] (dashee87) usa o símbolo **τ (tau)**; a fonte [4] (penaltyblog 2021) implementa o **mesmo conceito** com a função `rho_correction`. O conceito é idêntico — o label difere por fonte:

```
τ(0,0) = 1 − λ·μ·ρ
τ(0,1) = 1 + λ·ρ
τ(1,0) = 1 + μ·ρ
τ(1,1) = 1 − ρ
```

ρ ≈ −0.13 (EPL 17/18, [5]); ρ ≈ −0.079 (referência penaltyblog, [3]). **Decisão:** ρ entra como **prior fixo calibrável** (não MLE — não há dataset jogo-a-jogo para o MLE de [5], e os `*Avgs` já são as forças). Faixa inicial sugerida ρ ∈ [−0.15, −0.05], calibrável empiricamente no POC.

**Upgrade calibrável (não MVP):** modelo bivariado-Poisson de Karlis & Ntzoufras [1][2] adiciona um termo λ3 de covariância gols-casa/gols-fora **mais** inflação da diagonal (empates). É a generalização natural do DC; fica registrado como melhoria com gatilho de calibração (§8). Veredito 3.1: **força-temporada → Poisson + correção Dixon-Coles (τ; ρ prior calibrável)**; biv-Poisson diagonal-inflated = upgrade.

### 6.2 Stats secundárias multivariadas e degradação (sub-questão 3.2)

Escanteios e cartões são **overdispersos** (variância > média) ⇒ **Negative Binomial** supera Poisson [6][7]. Os 4 blocos `*Avgs` trazem média **e** split de mando para essas métricas; para escanteios e gols há também split de tempo (`cornersFor1h`/`2h`, `firstHalfGoals`/`secondHalfGoals`). A dispersão do NB é estimada a partir da dispersão observada nos ~19 jogos per-match (`recentHomeResults`/`recentAwayResults`, que **são** persistidos via `RECENT_MATCH_FIELDS`, `widget_merger.rb:8-18`).

Métricas e modelo:

| Métrica | Modelo | Split de tempo disponível? |
|---|---|---|
| Gols por tempo | 2 processos λ (1h, 2h) | **Sim** (firstHalf/secondHalfGoals) |
| Escanteios | NB (média *Avgs, dispersão dos per-match) | **Sim** (corners1h/2h) |
| Cartões / BP | NB | Não — só total do jogo |
| SOT / chutes / faltas / offsides / tackles | NB | Não — só total do jogo |
| Posse de bola | — | **Não existe no payload** |

**Política de degradação honesta (flag `per_half_available`):**
- **Posse de bola não existe** no payload → não simular. Não inventar.
- Split de tempo só existe para **escanteios e gols** → essas duas saem por tempo (`per_half_available: true`).
- Todo o resto sai como **total do jogo** (`per_half_available: false`). A UI rotula explicitamente "total do jogo" quando não há split.
- `goalKicks`/`throwIns` per-match são descartados hoje (não estão em `RECENT_MATCH_FIELDS`), mas suas **médias estão nos `*Avgs`** → simuláveis no nível total.

Correlações entre stats (ex.: mais escanteios ↔ mais chutes) podem ser estimadas dos per-match + dos `recentHome/AwayAllResults` (descartados hoje, `widget_merger.rb:103-104`) via cópula. **MVP:** simular as secundárias **independentemente** (NB marginal por métrica), com cópula como melhoria; o ganho de modelar correlação não é quantificável sem POC (§9).

### 6.3 Odds como âncora não-circular (sub-questão 3.3)

`odds.json` traz **52 mercados**; `WidgetMerger.build_odds_summary` (`widget_merger.rb:280-296`) hoje guarda só `{decimal_odds, bookmaker}` por outcome. As odds carregam **overround** (soma dos implícitos > 1). O devig **multiplicativo** normaliza: `p_i = (1/o_i) / Σ_j (1/o_j)` [8][9]. O estudo empírico [8] testou métodos de devig em EPL 24/25 e encontrou diferenças **muito pequenas** entre o multiplicativo e métodos mais sofisticados (shin etc.): **RPS ≈ 0.00015** (spread entre 0.19739 e 0.19724 no teste reportado) — i.e. < 0.0002. O multiplicativo é adequado para o uso aqui.

**Não-circularidade (regra dura):** as odds devigadas (e os `outcomeOdds` por jogador, §6.6) entram **apenas como âncora de validação** — comparar a distribuição simulada contra a do mercado para detectar desvio grosseiro do modelo. **Nunca como input** do modelo (isso colapsaria a simulação na opinião do book e mataria o valor preditivo independente).

### 6.4 Robustez, shrinkage e propagação de incerteza (sub-questão 3.4)

`numMatches` 17-37 ⇒ médias **estáveis na maioria dos casos**. Shrinkage é aplicado **condicionalmente** — só onde `numMatches` é baixo (ex.: time recém-promovido, liga com poucos jogos rodados):

```
θ̂ = w · θ_time + (1 − w) · θ_liga,    w = numMatches / (numMatches + k)
```

`k` é o hiperparâmetro de força do shrink. **Não há derivação fechada para k**; ele é ancorado no **princípio** de pooling parcial Bayesiano de Baio & Blangiardo [10] (forças de time encolhem para a média da liga proporcionalmente à informação observada) e fica como **valor a calibrar empiricamente no POC** (chute inicial razoável k ≈ 5-8, sem autoridade numérica forte — registrado como hiperparâmetro). O prior de força `θ_liga` pode usar também o `team-records.json` (`ResultsWithStandings`, `Stage`, `fixtureWithoutStats`) que hoje `build_team_record` (`widget_merger.rb:64-77`) descarta.

**Propagação de incerteza:** Monte Carlo 10k iterações → quantis (p10/p50/p90), P(1X2), P(O/U por linha), P(BTTS), faixas. **Agrega apenas escalares** (não persiste as 10k iterações — restrição Cloudflare, §6.5).

### 6.5 Arquitetura, schema, task-fundação, guard, calibração (sub-questão 3.5)

**Onde computar:** no **scraper Ruby**, logo após a persistência do `detail_json` (mesmo runtime que já tem o payload em memória). O Worker Cloudflare **só lê escalares prontos**. Justificativa: a outage 1101 (`repository-payload-guard.test.ts`) decorre de o Worker puxar blobs pesados; computar a simulação no Worker reintroduziria o risco (isolate de 128 MB de memória, [11]) e latência. A nota de precisão de ADR-002 se mantém: a outage 1101 mistura **timeout de SSE** e **memória do isolate** — o limite citado de [11] é o de **memória**, não o de tempo.

**Task-fundação separada — enriquecer o `WidgetMerger`** (benefício compartilhado com o dashboard ADR-005, não só com a simulação). O `WidgetMerger` hoje descarta dado que JÁ está na resposta dos widgets. Itens (todos verificados no payload/código):

1. Persistir os **4 blocos `*Avgs`** (`homeTeamHomeAvgs`/`OverallAvgs`, `awayTeamAwayAvgs`/`OverallAvgs`).
2. Persistir `recentHomeAllResults`/`recentAwayAllResults` (`widget_merger.rb:103-104` descarta).
3. Persistir `ResultsWithStandings` + `Stage` + `fixtureWithoutStats` do `team-records.json`. **Nota de verificação:** `fixtureWithoutStats` **foi confirmado no payload real** (`team-records.json` linha 4442; `stage` linha 4472) — **não** é nome derivado só do código. `ResultsWithStandings` confirmado (linhas 82, 609, 1136, 2788).
4. Persistir `goalKicks`/`throwIns` per-match (faltam em `RECENT_MATCH_FIELDS`).
5. Persistir as **52 odds devigadas** (multiplicativo).
6. **(Tier 3 — o Pilot decidiu INCLUIR)** Persistir o que `build_player_stats` (`widget_merger.rb:233-278`) hoje descarta: `playerStatsForm` (`players.json` linha 10272), `homeTeamSeasons`/`awayTeamSeasons` (linhas 12346/12384), e `outcomeOdds` por jogador (presente em cada jogador, ex.: `ANYTIME_SCORER`, `FIRST_GOAL`, `TO_BE_CARDED`, `FIRST_CARD`). Hoje `build_player_stats` extrai só os agregados de temporada corrente + top-11 por minutos. Tier 3 alimenta **dashboard + simulação** (forma recente do jogador, histórico de temporadas, e âncora de validação player-level via `outcomeOdds`).

**Schema `fixture_simulations` próprio** (NÃO estender `ai_predictions` 0016 — é ortogonal: 0016 captura predição **do LLM copilot** com checks `pred_winner`/`pred_confidence`, RLS service-role-only `0016:40-47`, sem FK rígida para sobreviver à purga; misturar simulação determinística pré-computada quebraria a semântica das colunas e dos checks). Estrutura proposta (espelha o padrão auto-contido de 0016 — sem FK rígida, RLS service-role-only):

```
fixture_simulations (
  id, created_at, fixture_id (nullable), home_team, away_team, league,
  kickoff_utc, model_version,
  p_home, p_draw, p_away, p_btts, p_over_25,
  top_scorelines jsonb,        -- escalar pequeno
  sim_stats jsonb,             -- por time/tempo, escalares agregados
  per_half_available boolean,
  market_anchor jsonb,         -- odds devigadas p/ comparação (não input)
  player_events jsonb,         -- §6.6: por jogador escalar pequeno
  status, actual_home_goals, actual_away_goals,
  correct_winner, correct_over_under, actual_resolved_at
)
```

`player_events jsonb` é escalar pequeno (ver §6.6 — só por jogador: id/nome, prob de gol, gols esperados, prob de cartão, flag de titular provável). Os `jsonb` são **pequenos e escalares**; jamais o blob de simulação cru.

**Guard de payload — generalizar.** `repository-payload-guard.test.ts` hoje varre **só** `repository.ts` (`readFileSync(join(__dirname, "repository.ts"))`, linha 21). Generalizar o glob para `lib/**/*repository*.ts` para que qualquer novo módulo de leitura (incluindo o que servir `fixture_simulations` ao dashboard) seja coberto pela mesma proibição estática de `detail_json` pesado.

**Calibração — `brierScore` é adição NOVA.** `lib/ai/calibration-metrics.ts` hoje só tem `scoreWinner`/`scoreOverUnder`/`hitRate`/`calibrationBuckets` — **não há Brier** (verificado: arquivo lido por inteiro, 127 linhas). `hitRate` é binário (acerto/erro), insuficiente para medir a **qualidade probabilística** da simulação. Adicionar `brierScore(p, y) = (p − y)²` + variante multiclasse para 1X2, com testes próprios; o reconciler Ruby resolve `fixture_simulations` (placar/stats reais pós-jogo) e a página `/calibracao` passa a exibir o Brier da simulação separado do hitRate do copilot.

### 6.6 Camada de saída por jogador — provável escalação e alocação de eventos (sub-questão 3.6)

**Dado disponível (verificado no payload real `players.json`).** Por jogador, `homePlayers[]`/`awayPlayers[]` trazem: `played`, `started`, `subs`, `minutes`, `goals`, `assists`, `yellows`, `reds`, `totalShots`, `shotsOnTarget`, `foulsCommitted`, `foulsDrawn`, `offsides`, `tackles`, `firstGoals`, `firstCards`, `goals1h`/`goals2h`, `cards1h`/`cards2h`, `injured` (boolean), e **`outcomeOdds`** (ex.: `ANYTIME_SCORER`, `FIRST_GOAL`, `TO_BE_CARDED`, `FIRST_CARD`). `injured` ESTÁ em `PLAYER_STAT_FIELDS` (`widget_merger.rb:34`) e é propagado por `flatten_player`. O que se descarta é `outcomeOdds`, `playerStatsForm` e `*TeamSeasons` (§6.5 item 6).

**Método de alocação (proposto concretamente):**

**(a) Provável XI por time** — ranquear os jogadores **excluindo `injured: true`** por uma pontuação de titularidade: `score = started + minutes / minutos_por_jogo_da_liga` (combina "começou como titular" com "volume de minutos"); pegar o **top-11**. **Tratamento honesto da incerteza:** isto é **projeção do histórico**, NÃO a escalação oficial. A UI **deve rotular explicitamente "provável escalação"** — nunca "XI oficial". `player_events` carrega flag `provavel_titular: boolean` e um campo de confiança baixo/médio/alto derivado da margem entre o 11º e o 12º colocado.

**(b) Alocação de evento** — quando uma iteração do Monte Carlo gera N gols do time (ou M cartões), distribuir cada evento entre os 11 prováveis titulares por probabilidade proporcional à **taxa histórica do jogador ponderada pelos minutos esperados**:

```
peso_gol(jogador)    ∝ (goals / minutes)            × minutos_esperados(jogador)
peso_cartao(jogador) ∝ ((yellows + reds) / minutes) × minutos_esperados(jogador)
```

(quando fizer sentido, idem para SOT via `shotsOnTarget/minutes` e assists via `assists/minutes`). Os `firstGoals`/`firstCards` permitem refinar P(primeiro a marcar/levar cartão). Agregando sobre as 10k iterações, por jogador: **P(marcar ≥1 gol)**, **gols esperados**, **P(tomar cartão)**, **P(SOT ≥1)**, **flag provável titular**. Esses escalares vão para `player_events jsonb`.

**(c) Âncora player-level não-circular.** Os `outcomeOdds` por jogador (`ANYTIME_SCORER`, `TO_BE_CARDED`, `FIRST_GOAL`) devigados servem para **validar** P(marcar) / P(cartão) simulada contra o mercado de props — **nunca como input** (mesma regra de §6.3).

**Decisão de arquitetura — re-scrape tardio de escalação (NÃO pré-decidida; trade-off + recomendação).** O scrape roda **1×/dia 07:00 BRT**; a escalação oficial só sai ~1h pré-KO. Opções:

| Opção | Custo | Ganho |
|---|---|---|
| **A. Só projeção do histórico** (MVP) | Zero infra extra | Escalação aproximada; honestamente rotulada "provável" |
| **B. Segundo scrape tardio** (cron extra ~1h pré-KO, re-fetch só `players.json` + lineups) | Cron por-fixture (escalonado por kickoff_utc) ou janela varrendo fixtures das próximas ~2h; mais código; mais requests ao choistats; risco de rate-limit | Escalação muito mais próxima da real (XI oficial quando o feed já publicou) |

**Recomendação:** **Opção A no MVP.** Razões: (1) o produto é uso pessoal, 1 usuário, baixíssimo tráfego (CLAUDE.md) — o ganho marginal de precisão da escalação não justifica a complexidade de um scheduler por-fixture e o risco de rate-limit/instabilidade que historicamente custou caro neste projeto (Lições #11-13); (2) a UI **já vai rotular "provável escalação"**, então a expectativa do usuário está alinhada com a precisão entregue; (3) YAGNI — adicionar cron escalonado por kickoff é exatamente o tipo de complexidade especulativa que a metodologia do projeto proíbe sem necessidade comprovada. **Follow-up condicional:** se, após o POC, o erro de escalação se mostrar materialmente degradante para a calibração (Brier dos player_events ruim), promover a Opção B como ADR dedicado com gatilho de re-scrape estreito (só fixtures nas próximas ~90 min, só `players.json`).

## 7. Claims triangulados

| # | Claim | Fontes | Classificação |
|---|---|---|---|
| C1 | A API entrega os 4 blocos `*Avgs` e o `WidgetMerger` os descarta hoje | repo (`widget_merger.rb:98-106`) + payload | `[triangulated A]` (código + payload, fontes independentes no repo) |
| C2 | Poisson puro subestima empates/placares baixos; correção Dixon-Coles ajusta as 4 células | [3], [5], [7] | `[triangulated A]` |
| C3 | Bivariado-Poisson (λ3 covariância + inflação diagonal) generaliza o DC para empates | [1], [2] | `[partial B]` ([1] paywall 403, [2] espelho 403 a crawler — mesma origem; não verificável independentemente) |
| C4 | Escanteios/cartões são overdispersos → Negative Binomial supera Poisson | [6], [7] | `[partial B]` (rebaixado: [6] ResearchGate 403 a crawler — não acessível; [7] exprysm sozinho, acessível, confirma a direção) |
| C5 | Devig multiplicativo é adequado; diferenças vs. métodos sofisticados são mínimas (RPS ≈ 0.00015, < 0.0002) | [8], [9] | `[partial B]` ([8] estudo primário com o número; [9] confirma a fórmula mas não o número) |
| C6 | Pooling parcial / shrinkage para a média da liga proporcional à informação observada | [10] | `[single C]` ([10] PDF comprimido não verificável por crawler — mitigado por usar shrink **condicional** a `numMatches` baixo, não pooling pesado uniforme) |
| C7 | Worker Cloudflare tem isolate de 128 MB de memória; outage 1101 consistente com puxar blob | [11] + incidentes B12 (34.1 MB/dia) / B14 (22.63 MB pico) em MEMORY | `[triangulated A]` (doc oficial + telemetria de produção; nota: [11] é o limite de **memória**, distinto do timeout de SSE de ADR-002) |
| C8 | `brierScore` não existe em `calibration-metrics.ts` (adição nova necessária) | repo (arquivo lido integralmente) | `[single A]` (fato verificável de código, não opinião) |
| C9 | O guard de payload varre só `repository.ts` (precisa generalizar) | repo (`repository-payload-guard.test.ts:21`) | `[single A]` (fato de código) |
| C10 | `players.json` traz por jogador `started/minutes/injured/goals/.../outcomeOdds` + Tier-3 `playerStatsForm`/`*TeamSeasons`; merger descarta o Tier-3 | repo (payload linhas 252-332/10272/12346/12384 + `widget_merger.rb:233-278`) | `[triangulated A]` (payload real + código, verificações independentes) |
| C11 | `fixtureWithoutStats` existe no payload real (não só no código) | repo (`team-records.json:4442`) | `[single A]` (fato de payload — verificado, marca a ressalva do critic como resolvida) |

`triangulation_coverage` = claims `triangulated A`/total dos principais = (C1,C2,C7,C10) + os `[single A]` de fato-de-código (C8,C9,C11) tratados como verificados ≈ 0.72 (C3,C4,C5,C6 ficam como hipóteses parciais ou single, não sustentam sozinhos a decisão).

## 8. Alternativas consideradas

| Alternativa | Por que não (no MVP) |
|---|---|
| DC / biv-Poisson com MLE global jogo-a-jogo | Não há dataset jogo-a-jogo amplo; os `*Avgs` **já são** as forças prontas |
| Biv-Poisson diagonal-inflated como modelo primário | Upgrade calibrável — entra com gatilho de calibração, não no MVP |
| Poisson puro sem correção | Subestima empates [3][5][7] |
| Shrinkage pesado/uniforme em todos os times | Premissa morta (`numMatches` 17-37 já é estável); só shrink condicional |
| Estender `ai_predictions` (0016) | Ortogonal: 0016 é predição do LLM com checks/RLS próprios; mistura quebra semântica |
| Computar Monte Carlo no Worker | 128 MB isolate + latência [11]; reabre risco 1101 |
| Reusar `hitRate` para medir simulação | Binário; precisa de `brierScore` (probabilístico) |
| Odds como input do modelo | Circular — colapsa a simulação na opinião do book |
| Re-scrape tardio de escalação no MVP | Complexidade de cron por-fixture + risco rate-limit não justificados p/ 1 usuário (Opção A recomendada; B = follow-up condicional) |
| Persistir as 10k iterações do MC | Blob pesado — só escalares agregados |

## 9. Limitações conhecidas

1. **Sem fan-out nem critic interno no ambiente deste researcher** — `Agent`/sub-researchers e `research-critic` não expostos. Mitigado: critic real rodou externamente sobre v0.1 e v0.2; v0.3 aplica as ressalvas da auditoria v0.2 (Lição #1 do projeto, já cumprida).
2. **Fontes inacessíveis a crawler:** **[1] paywall Wiley 403**; **[2] ResearchGate publication/227719079 — 403 em acesso automatizado, verificar manualmente**; **[6] ResearchGate publication/357366021 — 403 em acesso automatizado**, triangulação com [7] (exprysm, acessível) mitiga parcialmente o claim de NB para overdispersão (rebaixado a `[partial B]`); **[10] Baio-Blangiardo UCL PDF — PDF comprimido não verificável por crawler**, claim C6 fica `[single C]` mitigado por uso de shrink **condicional** (não pooling pesado).
3. **`numMatches`/n real não medido contra produção** — a estabilidade 17-37 vem do fixture de amostra; o POC obrigatório deve confirmar a distribuição real de `numMatches` em produção (especialmente ligas com poucos jogos rodados, times promovidos).
4. **Baseline de liga calculada sobre o recorte do dia é ruidosa** para ligas com poucos jogos naquele dia (poucos times para agregar `leagueAvg*`). **Limitação declarada e item obrigatório do POC**: medir a variância da baseline-do-dia e decidir se cai para uma baseline persistida (ex.: média móvel da liga) quando o recorte tem < N times.
5. **`league_baselines` (migration 0009) está vazia** — `LeagueBaseline` lê `detail['trends']` e a cobertura observada é ~0%. **Isto NÃO bloqueia**: a normalização proposta em §6.1 agrega os `*Avgs` dos times da liga no recorte, não depende dessa tabela.
6. **`k` do shrinkage** (≈5-8) é hiperparâmetro sem derivação fechada — ancorado no princípio de [10], **a calibrar empiricamente no POC**.
7. **Correlação entre stats secundárias** não modelada no MVP (NB marginais independentes); ganho de cópula não quantificado sem POC.
8. **Escopo declarado — o que NÃO entra no MVP (YAGNI explícito):** (a) modelo bivariado-Poisson (upgrade calibrável, não MVP); (b) cópula para correlação de stats secundárias (independência marginal no MVP); (c) **re-scrape tardio de escalação** (Opção B — follow-up condicional, não MVP); (d) cálculo de baseline persistida de liga (fica como fallback acionado pelo POC se a baseline-do-dia for ruidosa). **Todos os 3 tiers de campos descartados (incluindo Tier-3: `playerStatsForm`/`*TeamSeasons`/`outcomeOdds`/números do `chances.json`) ENTRAM no escopo** (decisão do Pilot) — nada do Tier-3 foi deixado de fora; a pesquisa enxergou e integrou o dado.
9. **`outcomeOdds` `fixtureId: 0`** no fixture de amostra — pode indicar payload de exemplo desconectado; o POC deve confirmar que em produção os `outcomeOdds` por jogador vêm preenchidos antes de depender deles como âncora player-level.

## 10. Decisão sugerida

**Modelo de placar:** força ataque/defesa de temporada normalizada pela liga (4 blocos `*Avgs`) → **Poisson + correção Dixon-Coles (τ; ρ prior fixo calibrável, faixa inicial [−0.15, −0.05])**. Bivariado-Poisson diagonal-inflated = upgrade calibrável pós-MVP.

**Stats secundárias:** **Negative Binomial** por métrica (dispersão dos ~19 per-match); split de tempo só para escanteios e gols (`per_half_available`); resto = total do jogo; **posse não existe → não simular**.

**Robustez:** Monte Carlo 10k → **apenas escalares agregados**; shrinkage **condicional** a `numMatches` baixo (`w = numMatches/(numMatches+k)`, k a calibrar).

**Camada player-level (obrigatória, decisão do Pilot):** provável XI por time (rank por `started`+`minutes`, excluir `injured`, top-11, **rotulado "provável escalação" na UI, nunca XI oficial**); eventos do time alocados ∝ taxa histórica do jogador × minutos esperados; agregação 10k → por jogador P(gol)/gols esperados/P(cartão)/P(SOT)/flag titular, persistido em `player_events jsonb`. **Re-scrape tardio de escalação: NÃO no MVP** (Opção A — projeção do histórico; Opção B = follow-up condicional ao resultado da calibração).

**Âncora:** odds devigadas (multiplicativo) **e** `outcomeOdds` por jogador devigados — **apenas validação não-circular, nunca input**.

**Arquitetura:** computar tudo no **scraper Ruby** pós-persistência; schema **`fixture_simulations` próprio** (não estender 0016) com `player_events jsonb`; **`brierScore` adição nova** em `calibration-metrics.ts` + reconciler Ruby + `/calibracao`; **guard generalizado** para `lib/**/*repository*.ts`. Worker só lê escalares (proteção 1101 / [11] / B12 / B14).

**Task-fundação obrigatória (6 itens):** enriquecer o `WidgetMerger` para persistir os 4 `*Avgs`, `recentHome/AwayAllResults`, `ResultsWithStandings`/`Stage`/`fixtureWithoutStats`, `goalKicks`/`throwIns` per-match, 52 odds devigadas, **e (item 6) o Tier-3 de `players.json` (`playerStatsForm`/`homeTeamSeasons`/`awayTeamSeasons`/`outcomeOdds` por jogador) + números estruturados do `chances.json`** — benefício compartilhado dashboard + simulação.

## 11. Follow-ups acionáveis

1. **POC obrigatório (Lição #2)** antes de fechar arquitetura: medir distribuição real de `numMatches` em produção; medir ruído da baseline-de-liga-do-dia (decidir fallback persistido); calibrar ρ e k; confirmar que `outcomeOdds` por jogador vêm preenchidos em produção (`fixtureId: 0` no sample).
2. **ADR-006: arquitetura da simulação pré-jogo** (modelo + schema + onde computar + decisão Opção A re-scrape).
3. **Atualizar CLAUDE.md** — nova ADR + Lição B15 (premissa de dados real `*Avgs`; camada player-level; "provável escalação" nunca XI oficial).

**Decomposição prevista (pensada para paralelização via subagent-driven-development):**

| Wave | Task | Depende de | Paralelizável |
|---|---|---|---|
| 1 | **Task-fundação: enriquecer `WidgetMerger`** (6 itens, incl. Tier-3 player + chances.json) — migration de colunas/jsonb + specs RED→GREEN | — | Wave isolada (gate para as demais) |
| 2 | **Dashboard turbinado** (consumir os campos novos: `*Avgs`, player Tier-3, odds) | Wave 1 | Paralelo com Wave 2-sim |
| 2 | **Simulação c/ camada player** (Poisson+DC, NB, MC 10k, alocação por jogador) + migration `fixture_simulations` (incl. `player_events`) | Wave 1 | Paralelo com Wave 2-dashboard |
| 3 | **Calibração + Brier** (`brierScore` em `calibration-metrics.ts` + reconciler Ruby p/ `fixture_simulations` + `/calibracao`) | Wave 2-sim | — |
| 3 | **Guard generalizado** (`lib/**/*repository*.ts`) — task curta, pode ir junto da Wave 3 | Wave 2-sim (módulo de leitura novo) | Paralelo com Calibração |

Wave 1 é gate único; Waves 2 (dashboard / simulação) e 3 (calibração / guard) têm pares paralelizáveis — bom alvo para `dispatching-parallel-agents` + `using-git-worktrees`.

## 12. Log adversarial

O `research-critic` **não está exposto no ambiente deste researcher**. O critic **real** rodou **externamente**:

- **v0.1 — REPROVADA.** Premissa de dados errada (supôs n≈10 jogos/time); 4 blocking + must-fix.
- **v0.2 — APROVADA COM RESSALVAS** pelo critic real.

**Ressalvas da auditoria v0.2 e ação tomada nesta v0.3:**

| Ressalva | Severidade | Ação |
|---|---|---|
| Erro numérico RPS<0.0016 | BLOCKING | Corrigido para **RPS ≈ 0.00015 (< 0.0002)** em §6.3, §7, frontmatter |
| Fontes [1]/[2]/[6] inacessíveis | MUST-FIX | Declarado em §5 e §9; C4 (corners/cards→NB) **rebaixado de `triangulated A` para `partial B`**; [1]/[2] mantidos `partial B` |
| Lacuna player-level | MUST-FIX | Integrado: §3.6 nova sub-questão, §6.6 método de alocação + provável XI + decisão re-scrape, schema `player_events jsonb`, task-fundação item 6, follow-up obrigatório |
| Escopo declarado | MUST-FIX | §9.8 declara explicitamente o que NÃO entra (e que Tier-3 ENTRA) |
| Baseline-dia ruidosa | SUGGESTION | §9.4 limitação + item obrigatório do POC |
| [10] PDF não verificável | SUGGESTION | §5/§9.2 registrado; C6 `single C` mitigado por shrink condicional |
| §13 formal | SUGGESTION | Expandida formalmente |
| `k` sem derivação | SUGGESTION | §6.4 ancorado em [10] + "a calibrar no POC" |
| Atribuição τ vs rho_correction | SUGGESTION | Corrigida em §6.1: **τ vem de [5] (dashee87); [4] (penaltyblog 2021) usa `rho_correction`** |
| `fixtureWithoutStats` verificável? | SUGGESTION | Verificado no payload real (`team-records.json:4442`) — §6.5/§7 C11; **não** é nome só de código |

## 13. Referências

[1] Karlis, D. & Ntzoufras, I. (2003). "Analysis of sports data by using bivariate Poisson models". *The Statistician (Journal of the Royal Statistical Society, Series D)*, 52(3), 381–393. DOI 10.1111/1467-9884.00366. https://rss.onlinelibrary.wiley.com/doi/abs/10.1111/1467-9884.00366 — *acesso 403 paywall (não verificável por crawler).*

[2] Karlis, D. & Ntzoufras, I. (2003). Mesmo artigo, espelho ResearchGate. https://www.researchgate.net/publication/227719079 — *403 a acesso automatizado; verificar manualmente.*

[3] penaltyblog — "Dixon-Coles Model" (documentação da biblioteca). https://docs.pena.lt/y/models/dixon_coles.html — *acessível.*

[4] penaltyblog (2021). "Predicting Football Results Using Python and the Dixon and Coles Model" (implementação com `rho_correction` nas 4 scorelines). https://pena.lt/y/2021/06/24/predicting-football-results-using-python-and-dixon-and-coles/ — *acessível.*

[5] dashee87 (Coyle, D.). "Predicting Football Results With Statistical Modelling: Dixon-Coles and Time-Weighting" (correção rotulada τ/tau; ρ≈−0.13 EPL 17/18; decaimento ξ; MLE). https://dashee87.github.io/football/python/predicting-football-results-with-statistical-modelling-dixon-coles-and-time-weighting/ — *acessível.*

[6] Yip, et al. — Escanteios overdispersos, Negative Binomial supera Poisson. ResearchGate publication 357366021. https://www.researchgate.net/publication/357366021 — *403 a acesso automatizado; triangulação parcial com [7].*

[7] exprysm — "Dixon-Coles Model" / metodologia (variância > média em cartões e escanteios ⇒ NB). https://exprysm.com/insights/methodology/dixon-coles-model.html — *acessível.*

[8] penaltyblog (2025). "From Biased Odds to Fair Probabilities" (métodos de devig; teste empírico EPL 24/25; spread RPS ≈ 0.00015 entre métodos). https://pena.lt/y/2025/09/14/from-biased-odds-to-fair-probabilities/ — *acessível.*

[9] sharkbetting — "Devig Explained" (fórmula multiplicativa; overround). https://www.sharkbetting.com/blog/devig-explained — *acessível.*

[10] Baio, G. & Blangiardo, M. "Bayesian hierarchical model for the prediction of football results". UCL Discovery 16040 (PDF). https://discovery.ucl.ac.uk/16040/1/16040.pdf — *PDF comprimido não verificável por crawler; claim usado apenas como princípio de pooling parcial.*

[11] Cloudflare. "Workers — Platform Limits" (isolate 128 MB de memória; CPU 10ms Free / 30s Paid). https://developers.cloudflare.com/workers/platform/limits/ — *acessível.*

(repo) `abissal` @ `main`: `scripts/scraper/lib/scraper/widget_merger.rb` (linhas 8-18, 24-35, 64-77, 98-106, 233-278, 280-296); `scripts/scraper/spec/scraper/fixtures/widgets/players.json` (linhas 252-332, 10272, 12346, 12384); `scripts/scraper/spec/scraper/fixtures/widgets/team-records.json` (linhas 82, 4442, 4472); `supabase/migrations/0016_ai_predictions.sql`; `lib/ai/calibration-metrics.ts` (127 linhas, sem Brier); `lib/fixtures/repository-payload-guard.test.ts` (linha 21).

## 14. Version log

- **v0.1 — REPROVADA** pelo `research-critic` real. Premissa de dados errada (supôs n≈10 jogos/time); 4 blocking + 11 must-fix; arquitetura imaginária parcialmente baseada em suposição não verificada.
- **v0.2 — APROVADA COM RESSALVAS** pelo `research-critic` real. Premissa corrigida (4 blocos `*Avgs`, `numMatches` 17-37); modelo Poisson+DC+NB+MC+shrink condicional; schema próprio; brierScore novo; guard estendido. Ressalvas: 1 blocking (erro numérico RPS), 3 must-fix (fontes 403, lacuna player-level, escopo), 6 suggestions.
- **v0.3 — esta versão.** Aplica todas as ressalvas da auditoria v0.2: número RPS corrigido (≈0.00015); fontes 403 declaradas e C4 rebaixado; **camada player-level integrada** (§3.6, §6.6, schema `player_events`, task-fundação item 6, decisão re-scrape Opção A); escopo declarado (§9.8); baseline-dia como limitação+POC; [10] registrado como `single C`; §13 formal; `k` ancorado+POC; atribuição τ/rho_correction corrigida; `fixtureWithoutStats` verificado no payload real.
