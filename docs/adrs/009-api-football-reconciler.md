# ADR-009: API-Football como fonte única para actuals de corners/cards/SOT

**Data:** 2026-05-26
**Status:** REVERTED 2026-05-26 (mesmo dia)

## Reversão (2026-05-26 tarde)

PR #12 deployado e validado em prod via scrape disparado. Resultado: **0 sucessos
em 1130 tentativas de reconciliação**. Investigação systematic-debugging revelou
root cause crítico que não foi pego em dev:

> Plano Free do API-Football **só dá acesso a seasons 2022-2024**. Endpoint
> `/fixtures?league=X&season=2026` retorna `{'plan': 'Free plans do not have
> access to this season, try from 2022 to 2024.'}`. **Nenhum dado atual é
> acessível com free tier**.

Por que não pegamos em dev:
- Smoke inicial usou fixture histórica (215662, season 2022-2024) — passou
- Tests RSpec usavam WebMock — não hit API real
- ADR-009 v0 não validou seasons recentes

Pilot decidiu reverter completamente. Reavaliar em ~1 mês quando:
- API-Football liberar seasons 2025+ no free tier (improvável)
- OU upgrade pra PRO ($19/mês — desbloqueia tudo)
- OU outra source (FBref scraping, Football-Data.co.uk pra ligas cobertas)

### O que ficou em prod (intencional)

- **Migration 0036**: `fixture_simulations.actual_data_source` (column nullable) +
  `actuals_fixture_mapping` (table vazia). Schema dead-but-benign — não machuca.
  Reverter custaria migration 0038 com DROP COLUMN — instabilidade desnecessária.
- **API_FOOTBALL_* GitHub Secrets**: mantidos pra snapshot infra semanal
  (12 reqs/sem, dentro do free tier mesmo agora).
- **Snapshot cron** (`api-football-snapshot.yml`): mantido, útil pra detectar
  quando seasons 2026 ficarem acessíveis no free.

### O que foi deletado

- `scripts/scraper/lib/scraper/actuals/` (5 arquivos: client, parser, resolver,
  league_ids, reconciler)
- `scripts/scraper/spec/scraper/actuals*` (specs)
- Invocação do `ActualsReconciler` no `orchestrator.rb`
- 3 envs `API_FOOTBALL_*` no `scrape-daily.yml`

### Lição

Smoke testing rasos (1 curl em endpoint feliz) não substitui exploration de
limitações de plano free. Próxima integração com API paga: testar TODOS os
endpoints+params relevantes contra dados ATUAIS antes de codar reconciler.

---

## Decisão original (mantida pra histórico)

**Data:** 2026-05-26
**Contexto:** Wave O+E+P+R (PR #11) expandiu a IA para emitir recomendações em
corners-over/under, cards-over/under e sot-over/under. Wave G (PR #5) adicionou
as colunas `actual_corners_home/away`, `actual_cards_home/away`,
`actual_sot_home/away` em `fixture_simulations`. Porém o reconciler de actuals
secundários nunca foi implementado — colunas permanecem NULL, calibração quebra.

---

## Decisão

Usar **exclusivamente API-Football v3** (`https://v3.football.api-sports.io`)
como fonte para popular `actual_corners_*`, `actual_cards_*` e `actual_sot_*`.

Alternativas descartadas:
- **FDUK CSV mix:** complexidade de parsing + enriquecimento, sem benefício claro
  para o scope de usage pessoal (baixo volume, ligas mainstream).
- **Choistats widget `recent-results`:** investigado em 0029_actuals_secondary.sql
  — o objeto `fixture` do widget só expõe `homeGoalsFt`/`awayGoalsFt`/`homeReds`/
  `awayReds` em status=FT. Corners e SOT não estão disponíveis.
- **Scraping HTML:** frágil, viola robots.txt.

---

## Motivação para API-Football

1. **Cobertura:** 1200+ leagues incluindo Libertadores, Sudamericana, Brasileirão
   A/B, Premier, La Liga, Serie A, Bundesliga, Ligue 1, Liga NOS, MLS, K-League.
2. **Schema validado:** smoke test em 2026-05-26 contra fixture_id=215662:
   `Shots on Goal`, `Corner Kicks`, `Yellow Cards`, `Red Cards` presentes no array
   `statistics` de cada time.
3. **Custo:** Free tier = 100 req/dia. Budget diário ~30 fixtures resolvidas/dia
   × 1 req/fixture = 30 reqs. Margem confortável (70 reqs livres para outros usos).
4. **Auth simples:** único header `x-apisports-key: <key>` (direto para
   api-sports.io; não precisa de `x-rapidapi-key`/`x-rapidapi-host`).
5. **Rate limiting:** per-minute throttle detectado (HTTP 429 com `retry-after`
   header em segundos). Implementar delay de 2s entre requests no batch para
   evitar 429 sem afetar o orçamento diário.

---

## Mapeamento de league IDs (investigado via API em 2026-05-26, 12 reqs)

| Nossa `league` / `country` | API-Football ID | Nome Canônico |
|---|---|---|
| `Serie A` / `brazil` | 71 | Série A (Brazil) |
| `Serie B` / `brazil` | 72 | Série B (Brazil) |
| `Premier League` / `england` | 39 | Premier League (England) |
| `Championship` / `england` | 40 | Championship (England) |
| `La Liga` / `spain` | 140 | La Liga (Spain) |
| `Serie A` / `italy` | 135 | Serie A (Italy) |
| `Bundesliga` / `germany` | 78 | Bundesliga (Germany) |
| `Ligue 1` / `france` | 61 | Ligue 1 (France) |
| `Primeira Liga` / `portugal` | 94 | Primeira Liga (Portugal) |
| `Major League Soccer` / `usa` | 253 | Major League Soccer (USA) |
| `Eredivisie` / `netherlands` | 88 | Eredivisie (Netherlands) |
| `CONMEBOL Libertadores` / `world` | 13 | CONMEBOL Libertadores |
| `CONMEBOL Sudamericana` / `world` | 11 | CONMEBOL Sudamericana |
| `UEFA Champions League` / `world` | 2 | UEFA Champions League |
| `UEFA Europa League` / `world` | 3 | UEFA Europa League |

Nota: `statistics_fixtures` = true para Serie A Brasil em 2026 (validado no smoke).
Ligas pequenas (Cups, nacionais menores) ficam `unsupported_league` — degradação
graciosa, sem abortar o pipeline.

---

## Estratégia de mapping de fixture_id

O `fixture_simulations.fixture_id` é o ID do choistats (via `api.choistats.com`),
**diferente** do ID do API-Football. Fluxo de resolução:

1. Lookup cache: `actuals_fixture_mapping` (migration 0036) por `choistats_fixture_id`.
2. Cache miss: `GET /fixtures?date=<kickoff_date>&league=<af_league_id>&season=<year>`
   — filtra por `homeTeam.name` match (exact após normalização). Custa 1 req.
3. Resultado único: cacheado + retorna `api_football_fixture_id`.
4. Zero ou múltiplos matches: log "unresolvable" + retorna nil.

Normalização: `downcase + strip + gsub(/[^a-z0-9 ]/, '')` — remove diacríticos
e pontuação. Suficiente para matches como "Flamengo" → "Flamengo" sem precisar
de Levenshtein para os casos comuns.

---

## Mapeamento de estatísticas

| Tipo na API-Football | Campo no DB |
|---|---|
| `Shots on Goal` | `actual_sot_home` / `actual_sot_away` |
| `Corner Kicks` | `actual_corners_home` / `actual_corners_away` |
| `Yellow Cards` + `Red Cards` | `actual_cards_home` / `actual_cards_away` |

Identificação home vs away: comparar `team.name` normalizado com `home_team`/
`away_team` da fixture_simulations (mesma normalização acima).

Valores ausentes (ligas que não fornecem estatísticas): deixar NULL, marcar
`actual_data_source = 'stats_unavailable'`.

---

## Fallback e degradação graciosa

- **Key ausente** (`API_FOOTBALL_KEY` nil): `reconciler.run` retorna
  `{ skipped: 'no_key' }` sem acessar a rede.
- **429 rate limit** (per-minute): não configura retry automático para evitar
  consumo de quota. Log + continua a próxima fixture (o delay de 2s previne).
- **Quota diária esgotada** (≥95 reqs): aborta o batch, salva para amanhã.
- **Liga não mapeada**: marca `actual_data_source = 'unresolvable-unsupported_league'`,
  continua. Não derruba o pipeline.
- **Jogo sem stats** (liga pequena mapeada mas sem `statistics_fixtures`): marca
  `actual_data_source = 'unresolvable-stats_unavailable'`.

---

## Custo estimado

- Batch diário: ~30 fixtures resolvidas/dia × 1 req/fixture = 30 reqs.
- Discovery (cache miss): 1 req extra por fixture na 1ª vez. Amortizado.
- Status check: 1 req no início do batch.
- Total conservador: 60-70 reqs/dia. Dentro do free tier (100/dia).

Upgrade para pago ($9.99/mês = 7500 req/dia) só se volume crescer muito ou
se quisermos adicionar mais ligas.

---

## Consequências

- `actual_corners_*`, `actual_cards_*`, `actual_sot_*` passam a ser populados
  para as ligas principais após o scrape diário.
- Calibração de mercados secundários (calibracao-monthly.yml) passa a ter dados
  reais para comparar com simulações.
- `actuals_fixture_mapping` table nova (migration 0036) como cache permanente.
- `actual_data_source` coluna nova (migration 0036) para observabilidade.
- Requisito de env var `API_FOOTBALL_KEY` (já em GitHub Secrets).
