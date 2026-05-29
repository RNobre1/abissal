# Contingência: plano B para a fonte de dados de fixtures (se o choistats cair)

> **Status:** pesquisa exploratória — _"só ter uma ideia, não faremos nada agora"_ (Pilot, 2026-05-29).
> Nenhum código/ADR criado. Este doc é o reconhecimento pra quando/se o dia chegar.
> **Autor:** sessão de pesquisa 2026-05-29. **Não é decisão fechada.**

---

## TL;DR

Sim, o choistats é substituível — e o mais importante: **a costura pra trocar de fonte já
existe**. O `WidgetMerger` (`scripts/scraper/lib/scraper/widget_merger.rb`) já é a camada que
isola o formato cru do choistats do resto do pipeline. Tudo a jusante (motor de simulação,
reconcilers, calibração, UI) consome o *shape normalizado* que o merger produz — não o JSON
do choistats. Logo, "trocar de API" = escrever **um novo fetcher + adapter que emite o mesmo
shape interno**, e nada downstream muda.

O custo do plano B varia **conforme a fonte entregar as médias de temporada já agregadas
(barato) ou só dados jogo-a-jogo que a gente precisa agregar (caro)**.

---

## O contrato: o que QUALQUER substituto precisa entregar

O choistats nos dá 5 famílias de dado (em ordem de criticidade pro motor). Um substituto é
viável na medida em que cobre isto:

| # | Dado | Quem consome | Choistats hoje |
|---|------|--------------|----------------|
| 1 | **Médias de temporada por time, split mando/fora** — os 4 blocos `*Avgs` (`homeTeamHomeAvgs`, `homeTeamOverallAvgs`, `awayTeamAwayAvgs`, `awayTeamOverallAvgs`), ~43 métricas cada, `numMatches` 17-37 (gols, escanteios, cartões, SOT…) | **Motor Dixon-Coles + Monte Carlo** (ADR-006, Lição B15) — é o INPUT do motor | **pré-agregado** ✅ |
| 2 | Fixtures por data (confronto, KO, liga, país) | Listagem (`ApiListFetcher`) | ✅ |
| 3 | Odds pré-jogo + closing (CLV) | Devig → âncora de validação não-circular; painel CLV (`closing_odds`, migration 0026) | ✅ (52 mercados) |
| 4 | Actuals FT (gols/escanteios/cartões/SOT) | Reconcilers (`SimulationReconciler`, `AiRecommendationReconciler` — Lição B19) | ✅ (via `recent_results[0]` cujo `id == fixture_id`) |
| 5 | Escalação / jogadores | Alocação de eventos por jogador (provável XI) | ✅ |

**O item #1 é o divisor de águas entre as APIs** — é o input do motor, e poucas fontes
entregam isso *pré-computado* com split mando/fora em vários mercados.

---

## Candidatos (do mais "plug-and-play" ao mais trabalhoso)

### 1. FootyStats — o análogo mais direto do choistats ⭐ (primário sugerido)
- API de stats **de aposta**: 710+ data points por time, com médias de
  escanteios/cartões/BTTS/over-under **já agregadas por temporada**. Mesma filosofia dos
  `*Avgs` do choistats.
- **Preço pessoal viável:** £29.99/mês (Hobby, 40 ligas, 1800 req/h) · £69.99/mês (Serious,
  150 ligas) · £389.99/mês (Everything, 1500+ ligas). Atualiza a cada ~20min.
- **Adapter pequeno** — só mapeamento de campos, **sem precisar agregar nada**.
- ⚠️ **A verificar antes de adotar:** (a) se o split mando/fora vem explícito por mercado;
  (b) cobertura das ligas que acompanhamos; (c) se entrega odds + actuals FT + lineups na
  mesma assinatura. A doc deles está atrás de redirect/403 — não dá pra confirmar os campos
  exatos remotamente; exigiria uma chave de teste.

### 2. API-Football (api-sports.io) — a mais flexível, mas exige camada de agregação
- **Detalhe arquitetural-chave:** o endpoint `teams/statistics` entrega **média de gols
  split mando/fora/total — mas SÓ gols**. Escanteios/cartões/SOT só existem **jogo-a-jogo**
  (`fixtures/statistics`: Shots on Goal, Corner Kicks, Yellow/Red Cards, etc.).
- Pra reproduzir os `*Avgs` dos mercados secundários, **teríamos que construir a camada de
  agregação**: puxar os últimos N jogos de cada time → buscar stats de cada um → calcular as
  médias mando/fora nós mesmos. **É exatamente a "camada pra tratar dados" que o Pilot
  intuiu** — e ela só fica grande com fonte desse tipo.
- **$19/mês cobre tudo.** (O motivo do ADR-009 ter sido revertido foi o *free tier* sem
  seasons 2025+; o plano pago resolve.) Tem odds + lineups + actuals na mesma API.
- **Já temos experiência de integração** (ADR-009, ainda que revertido). ⚠️ A chave antiga
  vazou no histórico git público e foi rotacionada/removida — qualquer retorno usa chave nova.

### 3. SportMonks — não é só plano B, é upgrade em potencial
- Mais cara (planos por nº de ligas: Starter 5 / Growth 30 / Pro 120 ligas + add-on de ligas
  extras). Tier "All-In" (~€129/mês, ou €103 anual) destrava **xG + Pressure Index**.
- xG/setpieces/lineup são justamente o que o brainstorm de personas apontou que o **"modelo
  está cego"** (ver memória `persona-brainstorm-10x`). Se a troca virar necessidade, vale
  considerar pegar a versão com xG e **evoluir o motor junto**, não só repor.

### 4. Odds/CLV especificamente (desacoplável)
- Se a fonte de stats escolhida tiver odds fracas, dá pra pegar odds de especialistas:
  the-odds-api, OddsMatrix, Goalserve (têm Asian handicap, over/under, BTTS, corners O/U).
- O CLV é nossa métrica que **sobrevive a small-sample** (target Wave C: +1.5% em ≥300 bets),
  então vale ter um plano dedicado pra closing odds, independente da fonte de stats.

---

## A camada (sim, precisa — e está ~80% pronta)

```
            ┌─ ChoistatsAdapter   (atual: ApiListFetcher + WidgetMerger)
FixtureSource ─┼─ FootyStatsAdapter  (mapeia JSON deles → *Avgs internos)
 (interface)   └─ ApiFootballAdapter (mapeia + AGREGA secundários jogo-a-jogo)
                          │
                          ▼
              FixtureBundle / TeamSeasonAverages   ← contrato interno único
                          │
        motor sim · reconcilers · calibração · UI  ← INTOCADOS (leem só o contrato)
```

Hoje o `WidgetMerger` **já é** esse ponto de costura — emite o shape interno. Formalizar:
1. Uma interface `FixtureSource` (Ruby) com o contrato das 5 famílias acima.
2. Um flag de config `FIXTURE_SOURCE=choistats|footystats|apifootball`.
3. Um adapter por provider.

Aí a troca fica **isolada a "fetcher + adapter"**. Esforço por opção:
- **FootyStats:** médio-baixo — adapter de mapeamento, sem agregação.
- **API-Football:** médio-alto — adapter + sub-camada de agregação dos secundários (mais
  chamadas → atenção ao rate-limit). Parte da lógica de extrair corners/cards/SOT de entries
  já existe (B19).

---

## Ressalva que NÃO pode ser esquecida

**Cold-start de calibração.** Os `league_parameters` (ρ Dixon-Coles, baselines de gols, K
shrinkage — migration 0021) foram fitados contra os `*Avgs` do choistats. Uma fonte com
semântica diferente de `numMatches` / janela de média **precisa de recalibração** — o cron
mensal (`calibracao-monthly.yml`) cuida disso, mas haveria **~1 mês de modelo "frio"** até
reconvergir. Isso reforça preferir, no dia, a fonte cujos `*Avgs` sejam o mais parecidos
possível com os do choistats (= **FootyStats à frente**).

Notas menores: frequência de atualização (choistats 1×/dia no nosso batch 07:00 BRT;
FootyStats 20min; API-Football real-time — qualquer uma serve). Retenção/histórico: confirmar
que a fonte cobre seasons correntes (foi o que matou o free tier da API-Football).

---

## Recomendação pro "dia que vier"

1. **Primário: FootyStats** — menor atrito, mesma filosofia de dado pré-agregado, preço
   pessoal ok. Verificar split mando/fora + cobertura de ligas + odds/actuals/lineups antes.
2. **Alternativa robusta: API-Football** ($19/mês) — se quisermos odds + lineups + stats num
   vendor só e topássemos construir a agregação dos secundários.
3. **Upgrade oportunista: SportMonks** — se a troca virar chance de destravar xG/Pressure
   Index e evoluir o motor.

**Próximos passos (quando/se for pra valer — NÃO agora):**
- (a) Rodar a `researcher` agent pra fechar a comparação com triangulação + escrever um
  ADR de contingência formal.
- (b) Refatorar o `WidgetMerger` num `FixtureSource` formal com testes — aí o adapter de
  qualquer fonte vira plug-in.
- (c) Pegar chave de teste do candidato escolhido e validar os campos reais (o gargalo do
  reconhecimento foi exatamente não poder inspecionar o payload sem chave — repete a Lição
  B15: *inspecionar o payload BRUTO antes de fechar arquitetura*).

---

## Fontes

- FootyStats: [API](https://footystats.org/api) · [pricing/review](https://sportsapi.com/api-directory/footystats/) · [docs (league-season-stats + teams)](https://docs.footystats.org/endpoints/league-season-stats-+-teams)
- API-Football: [pricing](https://www.api-football.com/pricing) · [feature: statistics](https://www.api-football.com/news/post/new-feature-statistics) · [documentation v3](https://www.api-football.com/documentation-v3)
- SportMonks: [plans & pricing](https://www.sportmonks.com/football-api/plans-pricing/) · [statistics types](https://docs.sportmonks.com/football/definitions/types/statistics)
- Especialistas em odds/stats: [Goalserve feeds](https://www.goalserve.com/en/sport-data-feeds/football-api/prices) · [Live-Score-API match statistics](https://live-score-api.com/documentation/reference/23/match-statistics)
