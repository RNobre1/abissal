# ADR-011 — Avaliação de modelos: log-loss como árbitro + arquitetura champion-challenger (shadow), promoção gated

**Status:** ACCEPTED — _2026-06-03_

**Contexto:** pesquisa L3 `docs/pesquisas/estado-da-arte-modelos-predicao-e-champion-challenger.md`.

## Decisão

1. **Métrica de DECISÃO de modelo = log-loss/ignorance** (proper, local, eficiente em small-sample). **RPS é não-local e fraco para discriminar** → fica **só como leitura ordinal na UI**. **CRPS** para distribuições de **contagem** (escanteios/cartões/SOT). **CLV vs fechamento** é o baseline de skill que sobrevive a small-sample.

2. **Arquitetura champion-challenger em SHADOW:** persistir **uma predição por `(jogo × modelo × mercado)` no momento do jogo** (tabela `model_predictions`, migration 0049). Só o **champion** (`is_champion=true`) alimenta bilhete/recomendador; **challengers rodam em shadow** (não tocam o caminho de aposta). Design **forward-only** — contorna a retenção de ~4 dias do payload bruto (não recomputa histórico; grava as probs quando o jogo acontece). O próprio `model_predictions` é o **store append-only** que, ao amadurecer, destrava ML/gradient-boosting (o único caminho que bate o mercado em RPS, hoje bloqueado pela retenção).

3. **Teste de vitória:** **bootstrap pareado** dos deltas de log-loss por jogo (primário), **deflacionado pelo nº de challengers testados** (controle de multiple testing — anti walk-forward-bomb); Diebold-Mariano+HLN como cross-check.

4. **Promoção = decisão HUMANA gated** por **gate triplo**, em janela forward limpa: **log-loss ↓ E CLV vs fechamento não-pior E reliability (CORP) não-pior**. Bump de `model_version` reseta calibração (B28/B33) → a promoção carrega esse custo conscientemente.

## Consequências

- **Positivo:** mede precisão de forma honesta; permite provar challengers sem "bumpar" nada; acumula o histórico que destrava o frontier (ML).
- **Negativo/custo:** um INSERT por modelo×mercado no scrape; um card a mais em `/calibracao`; promoção continua manual (por design).
- **Não-circularidade:** mercado é **âncora** (CLV), nunca input.

## Alternativas rejeitadas

- RPS como árbitro (não-local, ineficiente — ref [21][22] da pesquisa).
- Promoção automática (repetiria a walk-forward-bomb).
- GBM/pi-ratings/xG como challenger imediato (bloqueado por retenção + sem dados — gated ao store append-only e à aquisição de xG/árbitro).

## Enquadramento honesto (analogia do tempo)

A previsão do tempo é "absurda" por lei física + observação total + estacionariedade + verificação obsessiva. O futebol não tem lei física nem observação total, muta toda temporada, e enfrenta um **mercado quase perfeito** (Pinnacle calibrado a ~1:1). Logo o **teto de acerto de placar é baixo por entropia do esporte**, não por limite de modelo. O método do tempo (mais dados, melhor física generativa, ML sobre histórico, verificação/ensemble) é transferível e é o roadmap; a ambição **alcançável** é bater os **mercados ineficientes** (escanteios/cartões), provada por CLV.
