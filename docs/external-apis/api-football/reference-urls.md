# API-Football — links oficiais

- **Dashboard**: https://dashboard.api-football.com — quota, profile, key reset
- **Documentation v3**: https://www.api-football.com/documentation-v3 (SPA, Cloudflare challenge)
- **Pricing**: https://www.api-football.com/pricing
- **Status changelog**: https://status.api-sports.io

## Base URL

- Direto (recomendado): `https://v3.football.api-sports.io`
- Via RapidAPI (alternativa): `https://api-football-v1.p.rapidapi.com/v3`

Headers diferem:
- Direto: `x-apisports-key: <key>`
- RapidAPI: `x-rapidapi-key: <key>` + `x-rapidapi-host: api-football-v1.p.rapidapi.com`

## Rate limits (free tier · validado empiricamente 2026-05-26)

- **100 requests/dia** (reset 00:00 UTC)
- **~10 requests/minuto** (não documentado explicitamente, descoberto via HTTP 429 quando 11º+ req em ~60s)
- Mitigação: throttle 6.5s entre requests em scripts batch

## Resposta padrão

Todo endpoint retorna:
```json
{
  "get": "endpoint_name",
  "parameters": { ... },
  "errors": [],
  "results": N,
  "paging": { "current": 1, "total": M },
  "response": [ /* array de objetos */ ]
}
```

- `errors`: vazio quando OK. Quando quota exhausted: `{"requests": "..."}`
- `paging`: total > 1 = pagination needed (raro pros endpoints que usamos)
- `response`: payload real

## Mapping de ligas usadas

| Nome em `fixtures.league` | `league_id` API-Football |
|---|---|
| Copa Libertadores | 13 |
| Copa Sudamericana | 11 |
| Brasileirão Série A | 71 |
| Brasileirão Série B | 72 |
| Premier League | 39 |
| La Liga | 140 |
| Serie A (Italy) | 135 |
| Bundesliga | 78 |
| Ligue 1 | 61 |
| Eredivisie | 88 |
| Liga Portugal | 94 |
| MLS | 253 |
| K League 1 | 292 |
| K League 2 | 293 |
| J League 1 | 98 |

> Tabela completa via `GET /leagues` (paginated). Cache em `actuals_fixture_mapping` quando descobrir IDs novos.

## Schemas críticos

### `/fixtures/statistics?fixture=X`

Pós-jogo (status=FT). Retorna 2 elementos (home + away). Statistics relevantes pra Wave R:

| `type` | Mapping no DB |
|---|---|
| `"Shots on Goal"` | `actual_sot_*` |
| `"Corner Kicks"` | `actual_corners_*` |
| `"Yellow Cards"` + `"Red Cards"` | `actual_cards_*` (soma) |
| `"Ball Possession"` | (não usado, string `"X%"`) |

### `/odds?fixture=X`

Pré-jogo. Retorna até 10 bookmakers com 15+ bet types cada. Schemas relevantes pra Wave O2:

| `bets[].name` | Mapping no nosso edge-calculator |
|---|---|
| `"Match Winner"` | `1x2` (home/draw/away) |
| `"Goals Over/Under"` | `over25` (line=2.5) ou outras linhas |
| `"Both Teams Score"` | `btts` (yes/no) |
| `"Asian Handicap"` | futuro · Wave C+ moat |
| `"Corners Over/Under"` | `corners-over/under` Wave O+E+P+R |
| `"Cards Over/Under"` | `cards-over/under` |
| `"Shots on Target Over/Under"` | `sot-over/under` |

Schemas reais: ver `samples/YYYY-MM-DD/odds.json`.
