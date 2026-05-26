# API-Football — schema snapshots

Snapshot semanal dos endpoints v3 da [API-Football](https://www.api-football.com).

## Por que isso existe

A documentação oficial é uma SPA atrás de Cloudflare challenge — não tem OpenAPI público. Solução pragmática: dumpar samples curados dos endpoints que usamos e detectar breaking changes via SHA256.

Quando hash de um arquivo muda entre dois snapshots, é candidato a:
- Campo novo adicionado (compatível)
- Campo renomeado ou removido (**breaking**)
- Schema reorganizado (potencialmente **breaking**)

## Estrutura

```
docs/external-apis/api-football/
├── README.md                 # esse arquivo
├── reference-urls.md         # links oficiais úteis
└── samples/
    └── YYYY-MM-DD/
        ├── HASHES.txt        # SHA256 por arquivo
        ├── status.json
        ├── fixtures-today.json
        ├── fixtures-statistics-finished.json   # ← schema crítico pra Wave R
        ├── odds.json                            # ← schema crítico pra Wave O2
        ├── ...
```

## Endpoints capturados

| Arquivo | Endpoint | Wave que usa |
|---|---|---|
| `status.json` | `/status` | infraestrutura · quota |
| `timezone.json` | `/timezone` | utilidade |
| `leagues-libertadores.json` | `/leagues?id=13` | Wave R · mapping ligas |
| `leagues-brasileirao-a.json` | `/leagues?id=71` | Wave R · mapping ligas |
| `fixtures-today.json` | `/fixtures?date=X` | Wave R · discovery |
| `fixtures-statistics-finished.json` | `/fixtures/statistics?fixture=X` | **Wave R · reconciler stats** |
| `fixtures-events.json` | `/fixtures/events?fixture=X` | futuro · timeline |
| `fixtures-lineups.json` | `/fixtures/lineups?fixture=X` | futuro · escalações |
| `fixtures-headtohead.json` | `/fixtures/headtohead?h2h=X-Y` | futuro · H2H |
| `odds.json` | `/odds?fixture=X` | **Wave O2 · multi-bookmaker** |
| `teams-libertadores.json` | `/teams?league=X&season=Y` | futuro · roster |
| `standings.json` | `/standings?league=X&season=Y` | futuro · contexto |

## Custos

- **12 requests por snapshot** (1 por endpoint)
- Free tier free tier: 100/dia + ~10/min (validado empiricamente — throttle 6.5s entre reqs)
- Cron semanal = **48 reqs/mês** (~1.6% do orçamento mensal)

## Rodando manualmente

```bash
# Snapshot novo (vai para samples/YYYY-MM-DD/)
API_FOOTBALL_KEY=... pnpm exec tsx scripts/external-apis/snapshot-api-football.ts

# Comparar com data específica
API_FOOTBALL_KEY=... pnpm exec tsx scripts/external-apis/snapshot-api-football.ts --compare=2026-05-19
```

## Cron GH Actions

`.github/workflows/api-football-snapshot.yml` roda toda segunda 09:00 BRT (12:00 UTC). Se diff vs snapshot anterior, commita o novo dump em main automaticamente. Quando há diferença de schema, abre issue automaticamente pra revisão (pattern futuro).

## Sanitização

Dados sensíveis da conta (email, nome) são sanitizados antes de salvar — apenas plan / quota / endpoints schemas aparecem no git.

## Quando consultar

- **Antes de chamar endpoint novo**: leia o sample correspondente pra ver shape exato
- **Após cron detectar mudança**: revise diff git pra avaliar impacto
- **Debug de produção**: compare response real vs sample esperado
