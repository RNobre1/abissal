# Auditoria: consumidor lê chave que o produtor nunca grava

**Data:** 2026-07-29 · **Gatilho:** o bug do `sotCrps` (achado ao especificar o painel de desempenho por liga) · **Pergunta do Pilot:** "veja se esse bug não acontece com outras coisas também"

## A classe de bug

Um consumidor lê `objeto.chave_x`, o produtor grava `objeto.chave_y`. Nada quebra: o
acesso devolve `undefined`, o código degrada graciosamente, e a funcionalidade
simplesmente **não existe** — silenciosa, sem erro no log, sem teste vermelho.

É insidiosa porque a degradação graciosa (boa prática, adotada em todo o projeto) é
exatamente o que esconde o defeito. O projeto já registrou quatro bugs desta classe
(símbolo/string/id-space, sessão de 2026-05-21) e a lição foi: **testar contra o shape
REAL do produtor**, não contra um shape inventado no teste.

## Método

1. Enumerar as chaves que os produtores **de fato** gravam, lendo amostras de produção
   de cada campo jsonb (`sim_stats`, `top_scorelines`, `market_anchor`, `player_events`,
   `edge_table_snapshot`, `red_flags`, `pairs`, `detail_json` e seus 14 sub-blobs).
2. Cruzar com as chaves que o código lê (TS e Ruby).
3. Rodar cada função de derivação contra `detail_json` real e medir a taxa de retorno
   vazio. Retorno vazio em ~100% das fixtures é a assinatura da classe.

## Achado 1 — `sotCrps` lê `shots_on_target`, produtor grava `sot`

**Confirmado end-to-end.** `lib/calibracao/sim-reliability.ts:421` passa `"shots_on_target"`
como chave de `sim_stats`. O shape real de `sim_stats` é:

```
{ home: { cards, corners, fouls, goals, offsides, sot, tackles },
  away: { … mesmas … } }
```

Não existe `shots_on_target`. O produtor (`ai_recommender_runner.rb:488`) grava `sot`.

Prova com 500 linhas resolvidas reais:

```
cornersCrps: 2.536813171623697
cardsCrps  : 1.5803705339105338
sotCrps    : null            ← a métrica nunca existiu
```

**Impacto:** o CRPS de finalizações no alvo é `null` desde que foi escrito, e propaga para
`app/api/calibracao/secondary-metrics/route.ts:107` → o painel `/calibracao` mostra a
métrica vazia. Corners e cards, que usam a chave certa, funcionam.

**Conserto:** trocar a chave (Task 3 do plano `2026-07-29-desempenho-modelo-por-liga.md`).

> `shots_on_target` é chave **legítima** em `detail_json.player_stats` e nos dados de
> partida do choistats. O erro é específico de `sim_stats`.

## Achado 2 — `league_baselines` é uma feature morta que ainda queima cron diário

Mesma classe, mais grave, porque a cadeia inteira está rompida:

| elo | estado |
|---|---|
| **Produtor** | `detail_parser.rb:31 extract_trends(doc)` extrai de **HTML via Nokogiri** (`doc.css(...)`) — o caminho Playwright, **deprecated** (ADR-003 / lição A6: HTTP-direct é o caminho padrão). O pipeline atual nunca preenche `trends`. |
| **Dado** | `detail_json.trends` = `[]` em **12/12** fixtures amostradas. |
| **Agregador** | `league_baseline.rb:59` lê `detail['trends']`, itera sobre lista vazia. |
| **Tabela** | `league_baselines` tem **0 linhas** em produção. |
| **Consumidor** | `fetch_for_league` (`league_baseline.rb:37`) **nunca é chamado** por ninguém. Nenhum TS lê a tabela. |

**Custo corrente:** `orchestrator.rb:450` roda `recompute` a cada scrape diário —
`TRUNCATE league_baselines` seguido de `SELECT league, detail_json FROM fixtures`. Como
`detail_json` tem **136 KB de média** e há 748 fixtures vivas, isso são
**~100 MB atravessando a rede todo dia para produzir zero linhas**.

Não afeta o Worker (roda no cron do GitHub Actions), mas é exatamente o padrão de acesso
que causou as outages 1101/1102: arrastar o blob inteiro.

**Agravante documental:** o `CLAUDE.md` descreve `league_baselines` como viva
("Baselines estatísticos por liga (avg over/btts/etc.)"), e o painel de simulação
referencia baselines de liga na UI. A documentação promete o que o dado não entrega.

**Não consertado** — está fora do escopo do painel de desempenho por liga. Decisão do
Pilot entre: (a) remover a cadeia inteira, (b) reconstruir `trends` a partir da API
HTTP-direct, (c) manter a tabela e só desligar o `recompute` diário.

## O que foi verificado e está correto

| campo | consumidores | veredito |
|---|---|---|
| `sim_stats` | `secondary-fit.ts`, `crps.ts`, `simulation-panel.tsx`, `edge-calculator.ts`, `fit-dist.ts`, `measure-dist-calibration.ts`, `seed-model-predictions.ts`, `value-bets-https.ts`, `ai_recommender_runner.rb`, `prompt_builder.rb` | todos usam `sot` — **só o `sim-reliability.ts` erra** |
| `player_events` | `simulation-repository.ts`, `player-market-value.ts`, `simulation-panel.tsx` | `p_goal`/`p_card`/`p_sot`/`provavel_titular`/`expected_goals` — todas batem |
| `top_scorelines` | `scoreline-display.ts`, `scoreline-accuracy.ts`, `prompts.ts` | `score`/`prob` — batem |
| `market_anchor` | `sim-reliability.ts`, `calibracao/page.tsx` | `Result.<time>` / `Result.Draw` — bate |
| `edge_table_snapshot` | `ai-reco` | 10 chaves, todas presentes |
| derivações de `detail_json` | `deriveTeamRecord`, `deriveStreakIndex`, `deriveOddsCategories`, `deriveRecentMatchStats`, `deriveSplits1h2h`, `deriveRadarAxes`, `deriveDistributions`, `derivePlayerRankings` | todas produzem resultado com dado real; vazios remanescentes são fixtures genuinamente sem o dado |

`predictions` vem vazio em 9/12 fixtures — já documentado como tolerável no `CLAUDE.md`
("Predictions widget may 404 — tolerate"), não é desta classe.

## Nota metodológica: a heurística gera falsos positivos

O teste "derivação sempre vazia = bug" acusou **três funções inocentes**
(`derivePlayerRankings`, `deriveRadarAxes`, `deriveRecentMatchStats`). Em todos os casos o
erro era do teste, não do código: assinatura chamada errada (`deriveRecentMatchStats` recebe
três argumentos e o *nome* do time, não `"home"`) e caminho de dado errado
(`player_stats.home.top_players`, não `player_stats.home`).

**Antes de acusar uma função, confirme como o chamador de produção a invoca.** Um retorno
vazio prova apenas que a entrada não bateu com a expectativa — a culpa pode ser de qualquer
um dos dois lados.

## Reproduzir

Os scripts desta auditoria foram exploratórios e não versionados. Para repetir: amostrar
`fixtures.detail_json` e `fixture_simulations` via service_role, enumerar as chaves reais
recursivamente e cruzar com os literais de chave no código. O único artefato permanente é o
teste de regressão contra o shape real (`lib/calibracao/market-accuracy.fixtures.ts`,
Task 3 do plano), que trava esta classe de bug para `sim_stats`.
