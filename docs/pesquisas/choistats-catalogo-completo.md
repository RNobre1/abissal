# Catálogo COMPLETO do retorno do choistats — o que temos vs o que usamos

> **Propósito:** insumo para brainstorm multi-persona. Lista **tudo** que a API do choistats
> devolve por fixture (14 blocos, ~300 campos distintos), com exemplos reais e o **status de
> uso** pela nossa simulação. Amostra real bruta: `choistats-amostra-real.json` (Ittihad Tanger ×
> Wydad Casablanca, Botola Pro — 171 KB). Doc dos widgets brutos: `../external-apis/choistats/choistats-api.md`.
>
> **Pergunta para as personas:** dado TODO esse retorno, o que **deveria/poderia** estar
> alimentando nosso motor de simulação/predição e **não está**? Rankeie a importância. Que
> sinais estão sendo desperdiçados? Que ideias novas (mercados, features, modelos) isso abre?

## Como a sim funciona hoje (resumo do audit do código)

A simulação (`scripts/scraper/lib/scraper/simulation/`) é: **força-de-temporada (avgs) → Poisson + Dixon-Coles → Monte Carlo 10k**. O que ela consome:
- **`avgs.home_home` / `avgs.away_away`** → só `avgGoalsFor`/`avgGoalsAg` viram λ (gols). Com **shrinkage** se `num_matches < 15` (encolhe pra média da liga).
- **`recent_matches`** → só a **dispersão** (variância) dos secundários (escanteios/cartões/SOT) + categorias sem season-avg (faltas/impedimentos/desarmes via F12). **NÃO** mexe na média.
- **`referee_record`** → ajuste de cartões (F6, blend 40%) — **só nos ~4% de jogos com juiz escalado**.
- **`player_stats` + `player_extra.outcome_odds_by_player`** → provável XI + alocação de gols/cartões/SOT por jogador.
- **`odds_devigged`** → âncora de validação (NÃO é input).
- **Forma recente como sinal de MÉDIA está DESLIGADA** (F7/xG-proxy existe no código mas o orchestrator de produção não liga).

## Os 14 blocos do `detail_json` (= merge dos widgets)

Legenda de uso: ✅ usado · 🟡 parcialmente usado · ❌ ignorado.

---

### 1. `avgs` — médias de temporada por contexto · 🟡 (só 2 de ~172 campos)
4 contextos: **`home_home`** (mandante em casa), **`away_away`** (visitante fora), **`home_overall`**, **`away_overall`**. Cada um com **43 campos** (× 4 = 172 números por jogo). Exemplo (`home_home`, num_matches=10):

| grupo | campos (For / Ag / Total, alguns com 1h/2h) | exemplo |
|---|---|---|
| Gols | `avgGoalsFor/Ag/Total`, `firstHalfGoalsFor/Ag/Total`, `secondHalfGoalsFor/Ag/Total` | 0.7 / 1.0 / 1.7 |
| Escanteios | `cornersFor/Ag/Total`, `cornersFor1h/2h`, `cornersAg1h/2h`, `cornersTotal1h/2h` | 3.6 / 4.3 / 7.9 |
| Cartões | `cardsFor/Ag/Total` (nº cartões), `bookingPointsFor/Ag/Total` (amarelo=10/verm=25) | 2.8 / 2.5 / 5.3 · bp 37/29.5/66.5 |
| Finalização | `shotsFor/Ag`, `shotsOnTargetFor/Ag` | 10.8 / 3.8 SOT |
| Outros | `foulsWon`, `foulsConceded`, `tacklesFor/Ag/Total`, `offsidesFor/Ag/Total`, `throwInsFor/Ag/Total`, `goalKicksFor/Ag/Total` | faltas 11.5, desarmes 8.7… |
| Meta | `num_matches` | 10 |

**Uso atual:** SÓ `avgGoalsFor`/`avgGoalsAg` de `home_home`/`away_away`. **Ignorado:** splits 1º/2º tempo de TUDO, contexto `overall`, faltas, desarmes, laterais, tiros de meta, finalizações totais, e as médias diretas de escanteios/cartões/SOT (a sim recomputa via outro caminho).

### 2. `recent_matches` — últimos jogos NA LIGA, jogo a jogo · 🟡 (só dispersão)
Array (até 10) por lado (`home`/`away`). Cada jogo tem **~40 campos**: `result`, `htResult`, `homeGoalsFt/Ht`, `awayGoalsFt/Ht`, `homeCorners/awayCorners` (+ `1h`/`2h`), `homeYellows/awayYellows`, `homeReds/awayReds`, `homeYellowReds`, `homeBookingPoints`, `homeShotsOnTarget`, `homeTotalShots`, `homeFouls`, `homeTackles`, `homeOffsides`, `homeThrowIns`, `homeGoalKicks`, `date_iso`, `league`, `status`.
**Uso:** só pra calcular a **dispersão** (variância) dos secundários + média de faltas/impedimentos/desarmes (F12). **Ignorado:** tendência/forma (a sequência cronológica), os splits 1h/2h por jogo, o placar como série temporal.

### 3. `recent_all` — últimos 10 jogos em TODAS as competições · ❌
Mesma forma de `recent_matches`, mas inclui copas/amistosos (não só a liga). **Zero uso.** Útil pra times com poucos jogos de liga (amostra), fadiga de calendário, e detectar troca de chave (copa vs liga).

### 4. `h2h` — confronto direto · ❌
Array de até 5 confrontos diretos, cada um com os ~40 campos de um jogo (placar, escanteios, cartões, SOT…). **Zero uso.**

### 5. `team_record` — campanha casa/fora/geral · ❌
`{home:{...}, overall:{...}}` com: `won/draw/lost`, `form` (últimos 5 = `["D","L","D","D","D"]`), `played`, `points`, `points_per_game`, `position`, `goal_diff`, `goals_for/against`, `type`. **Zero uso.** `points_per_game` e `form` são sinais clássicos de força/momento.

### 6. `standings` — posição na tabela · ❌
`{played, points, position:"10th", goal_diff, stage_name:"Regular Season", fixture_position, position_type}`. **Zero uso.** Diferença de posição/pontos = proxy de mismatch e de **motivação** (briga por título/rebaixamento/meio de tabela).

### 7. `streaks` — sequências ativas · ❌ (na sim; alimenta badges da UI)
Array por lado de sequências: `{desc, stat_type, group, home_perc, away_perc, overall_perc, home_count, home_streak, home_fixtures, ...}`. Ex.: "Unbeaten" (invicto 80% em casa, streak 3), "Win", "Win To Nil", "BTTS", "Over X", "Clean Sheet"… Cobre Result, Goals, Corners, Cards, BTTS. **Zero uso na predição.** É literalmente "% de vezes que o time bate cada mercado", casa/fora.

### 8. `predictions` — 🔥 previsões PRONTAS do choistats · ❌
Array de previsões já calculadas pela fonte, com **probabilidade e justificativa**. Exemplo real:
```json
{"stat_type":"Under 3.5 Match Goals","chance":91,"best_odds":1.222,"best_odds_bookmaker":"BET365",
 "home_stats":["Under 3.5 em 16/16 jogos","Under 3.5 nos últimos 10 em casa"],
 "away_stats":["Under 3.5 em 4/5 jogos","Under 3.5 nos últimos 5 fora"]}
```
**Zero uso.** É um sinal de ENSEMBLE de graça (a opinião de outro modelo + a melhor odd de mercado por mercado).

### 9. `odds_summary` — odds da casa por mercado · 🟡 (só na IA-2/edge, não na sim)
Dezenas de mercados: Result, BTTS, Total Corners (todas as linhas), Match/Team/Half Goals O/U, Double Chance, HT/FT, Clean Sheet, Win To Nil, Highest scoring half, Score Both Halves, Result&BTTS, BTTS&Overs, Most/Team Corners, Handicap, First Half Total Corners… **Nº de mercados varia por liga** (ligas pequenas têm menos; nenhuma testada tinha Cartões/SOT como mercado).

### 10. `odds_devigged` — odds sem margem · 🟡 (âncora de validação)
21 mercados com a probabilidade implícita "limpa" (sem vig). **Uso:** `market_anchor` (validação, não input).

### 11. `player_stats` — estatística por jogador · 🟡 (só XI + alocação)
Por lado: `aggregates` + `top_players[]`. Cada jogador: `name, goals, assists, minutes, started, played, subs, yellows, reds, cards_1h, cards_2h, goals_1h, goals_2h, offsides, first_cards, first_goals, fouls_drawn, fouls_committed, total_shots, shots_on_target, tackles, injured`. **Uso:** provável XI + alocação de gols/cartões/SOT. **Ignorado:** `first_goals`/`first_cards` (mercados de "1º a marcar / 1º cartão"), `cards_1h/2h`, `fouls_drawn/committed`, `assists`, `total_shots` por jogador — ouro pra mercados de jogador.

### 12. `player_extra` — temporadas + odds de artilheiro · 🟡
`{home_seasons, away_seasons, form, outcome_odds_by_player}`. **Uso:** `outcome_odds_by_player.ANYTIME_SCORER` (âncora de alocação). `home_seasons`/`away_seasons`/`form` muitas vezes vazios; **ignorados** quando presentes.

### 13. `referee_record` — árbitro · 🟡 (F6, ~4% cobertura)
`{name, avg_total_booking_points, avg_home_booking_points, avg_away_booking_points, total_yellow_reds, fixtures_count, completed}`. **Só preenchido quando o juiz já foi escalado** (perto do KO) → ~4% no scrape das 07:00. Maior alavanca de cartões (B38), gargalo = cobertura.

### 14. `trends` — ❌ (frequentemente vazio)
Vazio nesta amostra. Pode trazer tendências em outras fixtures — verificar cobertura.

---

## Endpoints da API (widgets brutos)
- `GET /api/widget/fixtures/date/YYYY-MM-DD` — lista do dia.
- `GET /api/widget/match/{id}/recent-results` · `/team-records` · `/players` · `/odds`
- `GET /api/widget/chances/fixture/{id}` (→ `predictions`)
- `GET /api/widget/referee/{id}/fixtures` (→ `referee_record`)
- Headers: `X-Adamchoi-Api-Token`, `Referer: adamchoi.co.uk`.

## Resumo executivo: o que está parado na mesa
| Sinal disponível | Status | Comentário |
|---|---|---|
| Splits 1º/2º tempo (gols/escanteios/cartões) | ❌ | mercados por tempo inteiros sem modelo |
| `team_record.form` + `points_per_game` | ❌ | momento/força clássicos |
| `standings` (posição, gap de pontos) | ❌ | mismatch + motivação |
| `streaks` (% por mercado, casa/fora) | ❌ | "bate o mercado X em Y% dos jogos" |
| `predictions` (chance% + odd + razão) | ❌ | ensemble grátis de outra fonte |
| `h2h` / `recent_all` | ❌ | confronto direto / fadiga de calendário |
| Forma recente na MÉDIA (não só dispersão) | ❌ off | F7 existe, desligado |
| `player_stats`: first_goals/first_cards/1h-2h/fouls | 🟡 | mercados de jogador ricos |
| Contexto (altitude, campo neutro, viagem) | ❌ | não está nos dados — aquisição |
| xG real | ❌ | não temos — aquisição |
