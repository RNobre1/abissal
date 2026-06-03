---
tipo: pesquisa
titulo: "Estado-da-arte de modelos de simulação/predição esportiva por alvo + arquitetura champion-challenger (shadow) para o Abissal"
status: completed
metodologia_tier: L3
source_diversity: 40
primary_source_ratio: 0.56
citation_density: 0.93
triangulation_coverage: 0.80
latency_min: 22
evidence_grades:
  primary_claim: A
  secondary_claim: B
autor: pilot+claude+researcher
criado: 2026-06-03
relacionado:
  - CLAUDE.md (ADR-006 simulação pré-jogo)
  - docs/pesquisas/simulacao-pre-jogo-fixtures.md
  - docs/lessons.md (B24/B28/B31/B32/B33 + walk-forward-bomb)
  - docs/tasks/champion-challenger/ (a abrir)
tags: [research, simulacao, predicao, calibracao, champion-challenger, futebol]
---

# Estado-da-arte de modelos de predição esportiva por alvo + arquitetura champion-challenger

> **TL;DR.** Nenhum modelo estatístico clássico (incluindo o nosso) bate o RPS do mercado; só **gradient boosting sobre pi-ratings** o faz (e por pouco, exigindo ~216k jogos de treino). O teto de predição do futebol é baixo **por entropia do esporte + mercado eficiente**, não por limite de modelo — a analogia com previsão do tempo ilumina o que é transferível (mais dados, melhor física generativa, ML sobre histórico, verificação obsessiva) e o que não é (futebol não tem "lei física" nem observação total, e tem um mercado adversário quase perfeito). O caminho honesto: rodar challengers em **shadow** (champion-challenger), medir por **log-loss/CRPS + CLV vs fechamento**, e promover só por **evidência forward gated**. Achado mais acionável: **cartões são SUB-dispersos** → nosso Negative Binomial está na direção errada (Conway-Maxwell-Poisson é o fix). E **O/U de gols modelado direto de chutes+escanteios** tem o único edge out-of-sample peer-reviewed (~0,8%/aposta em 12 anos), usando só dados que já temos.

---

## 1. Context

O Abissal pré-computa por fixture uma simulação (força-de-temporada → Poisson + Dixon-Coles + Negative Binomial → Monte Carlo 10k → escalares + alocação por jogador) e calibra a saída pós-modelo (isotônica, `k` de distribuição, calibração de forma de placar). Medimos pela primeira vez a acurácia de placar (B33): **top-1 hit 10,2%** (a sim previa 14,7% — superconfiante), **RPS(1x2) 0,216**, **log-loss de placar 1,68**, **Brier dos secundários ~0,25** (≈ acaso). O Pilot quer perseguir a **melhor precisão possível** e perguntou se existe "algo nível previsão-do-tempo" a usar — e, se não, criar do zero. A decisão que depende desta pesquisa: **quais modelos challenger vale rodar em paralelo (shadow) contra o champion, e como provar qual é melhor sem "bumpar" nada no escuro** (temos trauma de overfit — a "walk-forward bomb": +14% ROI in-sample virou −14% out-of-sample). Decidir errado = gastar esforço em modelos que não batem o mercado, ou pior, promover por sorte.

## 2. Central question

Dado o contexto do Abissal (inputs do choistats sem xG, compute em Ruby/GitHub Actions, retenção de ~4 dias do payload bruto, amostras pequenas e crescentes), **quais são os melhores modelos do mundo por alvo de predição (1x2/placar, gols/BTTS, contagens, jogador) e qual a metodologia correta para rodá-los como challengers em shadow e declarar um vencedor com honestidade** — medido por regras de score próprias e CLV, não por accuracy in-sample?

## 3. Sub-questions

| # | Sub-question | Search scope |
|---|---|---|
| 3.1 | Melhores modelos de resultado 1x2 + distribuição de placar exato | Dixon-Coles, bivariate/Weibull-count, GBM+pi-ratings, ELO/SPI, beating-the-bookies |
| 3.2 | Gols totais O/U + BTTS: derivar da matriz vs modelo direto | Poisson/NB no total, Skellam, GAP-ratings (Wheatcroft) |
| 3.3 | Contagens (escanteios/cartões/SOT): dispersão e edge | CMP, NB, batch-arrival, eficiência de mercado de secundários |
| 3.4 | Marcadores e alocação de eventos por jogador | rate models 1−exp(−λ), Dirichlet-Multinomial, Bayes-xG, favorite-longshot |
| 3.5 | Scoring rules, calibração e validação/champion-challenger | RPS vs log-loss/CRPS, CORP, isotonic/beta/temperature, walk-forward, bootstrap pareado |

## 4. Applied methodology

- **Tier**: L3 (decisão arquitetural P0 + escopo amplo multi-alvo).
- **Tools**: WebSearch + WebFetch (papers peer-review, arXiv, datasets, docs de prática), leitura local do repo (`lib/calibracao/`, `scripts/scraper/lib/scraper/simulation/`).
- **Subagents**: 4 `researcher` paralelos (alvo 1 / alvos 2+3 / alvo 4 / cross-cutting), cada um com auto-crítica adversarial; síntese pelo orquestrador.
- **Wall-clock**: ~22 min (4 researchers concorrentes ~6 min cada + síntese).
- **Adversarial review**: auto-crítica em cada researcher (seções de limitação); síntese consolidada. `research-critic` dedicado: não rodado (cada slice se auto-criticou; ver §12).

## 5. Sources consulted

Lista consolidada (dedup entre researchers). `primary` = paper peer-review / dataset / código; `secondary` = blog/prática/listicle.

| # | URL | Type | Quality | Notes |
|---|---|---|---|---|
| 1 | https://arxiv.org/pdf/2403.07669 | primary | high | Benchmark RPS de 216k jogos/52 ligas (Bunker-Yeung-Fujii 2024) |
| 2 | https://pena.lt/y/2025/03/10/which-model-should-you-use-to-predict-football-matches/ | secondary | high | Comparação empírica OOS de 6 modelos de placar (Eredivisie) |
| 3 | https://dashee87.github.io/.../dixon-coles-and-time-weighting/ | secondary | high | Decaimento temporal DC, ξ ótimo |
| 4 | https://rss.onlinelibrary.wiley.com/doi/abs/10.1111/1467-9876.00065 | primary | high | Dixon-Coles (1997) original |
| 5 | https://blogs.salford.ac.uk/business-school/.../paper.pdf | primary | high | Boshnakov-Kharrat-McHale (2016) Weibull-count+cópula |
| 6 | https://link.springer.com/article/10.1007/s10994-018-5704-6 | primary | high | Hubáček et al. XGBoost+pi-ratings (venceu desafio 2017) |
| 7 | https://link.springer.com/article/10.1007/s10994-018-5703-7 | primary | high | Constantinou "Dolores" (2º no desafio 2017) |
| 8 | https://arxiv.org/abs/1710.02824 | primary | high | Kaunitz et al. "Beating the bookies" (ROI + account-limiting) |
| 9 | https://www.football-data.co.uk/blog/pinnacle_efficiency.php | secondary | high | Eficiência da closing line Pinnacle (87.960 pares) |
| 10 | http://www2.stat-athens.aueb.gr/~jbn/papers2/08_Karlis_Ntzoufras_2003_RSSD.pdf | primary | high | Bivariate Poisson + inflação de diagonal |
| 11 | https://academic.oup.com/jrsssa/advance-article/doi/10.1093/jrsssa/qnag014/8488960 | primary | high | "Yellow fever": cartões SUB-dispersos (ν 1.11–1.46), CMP+árbitro |
| 12 | https://link.springer.com/article/10.1007/s11222-023-10244-0 | primary | high | CMP mean-parameterizada p/ counts under/over-dispersos |
| 13 | https://eprints.lse.ac.uk/103712/ | primary | high | Wheatcroft (2020) modelo lucrativo de O/U (shots+corners), 12 anos |
| 14 | https://arxiv.org/abs/2001.09097 | primary | high | Wheatcroft (2021) prever stats como passo intermediário |
| 15 | https://lup.lub.lu.se/student-papers/record/9127007/file/9127013.pdf | primary | medium | Tese Lund: modelo lucrativo de escanteios (NB + features de pressão) |
| 16 | https://arxiv.org/abs/2112.13001 | primary | medium | Compound/geometric-Poisson p/ escanteios (batch arrival), backtest HKJC |
| 17 | https://arxiv.org/html/2311.13707 | primary | high | Bayes-xG: identidade do jogador melhora xG (exige shot-level) |
| 18 | https://arxiv.org/pdf/2508.09992 | primary | medium | OpenFPL: GBM sobre agregados rivaliza serviços comerciais |
| 19 | https://en.wikipedia.org/wiki/Favourite-longshot_bias | secondary | medium | Favorite-longshot bias (síntese de estudos) |
| 20 | https://www.pinnacle.com/betting-resources/en/betting-strategy/what-is-the-favourite-longshot-bias/ | secondary | medium | FL-bias explicado (Pinnacle) |
| 21 | https://arxiv.org/abs/1908.08980 | primary | high | Wheatcroft (2019) "the case against the RPS" |
| 22 | https://pena.lt/y/2025/05/01/better-metrics-for-football-forecasts-moving-beyond-the-ranked-probability-score/ | secondary | high | Experimentos: log-loss > RPS na discriminação em small-sample |
| 23 | https://www.pnas.org/doi/10.1073/pnas.2016191118 | primary | high | CORP: reliability diagram estável via PAV (Dimitriadis-Gneiting-Jordan 2021) |
| 24 | https://www.cs.cornell.edu/~alexn/papers/calibration.icml05.crc.rev3.pdf | primary | high | Niculescu-Mizil & Caruana: isotônica overfita em small-sample |
| 25 | https://arxiv.org/abs/1706.04599 | primary | high | Guo et al. temperature scaling |
| 26 | https://arxiv.org/abs/2502.05676 | primary | high | Venn-Abers calibration (garantia finite-sample) |
| 27 | https://blog.quantinsti.com/cross-validation-embargo-purging-combinatorial/ | secondary | high | Purged/embargo CV (López de Prado) |
| 28 | https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf | primary | high | Deflated Sharpe / PBO (multiple testing) |
| 29 | https://www.sas.upenn.edu/~fdiebold/papers/paper68/pa.dm.pdf | primary | high | Diebold-Mariano (+ correção HLN p/ small-sample) |
| 30 | https://arxiv.org/pdf/2511.19794 | primary | medium | Protocolo de bootstrap pareado p/ comparar modelos |
| 31 | https://wallaroo.ai/.../shadow-deployments/ | secondary | medium | Champion-challenger / shadow deployment (MLOps) |
| 32 | https://www.datarobot.com/blog/introducing-mlops-champion-challenger-models/ | secondary | medium | Champion-challenger (MLOps) |
| 33 | https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5381388 | primary | medium | Wilkens: modelo xG simples ~10-15% ROI OOS mas instável |
| 34 | https://wizardofodds.com/article/player-props-understanding-the-math-behind-the-lines/ | secondary | medium | Holds de player props (10-20% em secundários) |
| 35 | https://understat.com | secondary | medium | Fonte pública de xG (avaliação de aquisição de dados) |

## 6. Synthesis

### 6.1 Resultado 1x2 + distribuição de placar (sub-3.1)

A régua que importa, no mesmo dataset de 216k jogos/52 ligas: **odds de bookmaker = RPS 0,2020** [1]. Das ~13 abordagens da literatura, **só duas batem o mercado**: CatBoost+pi-ratings (0,1925) e TabNet+pi-ratings (0,1956), ambas exigindo histórico massivo + stack ML [1]. XGBoost+pi-ratings (venceu o desafio 2017) dá 0,2063 — bom, mas ainda **pior** que o mercado [1][6]. Lição central triangulada: **o ganho vem da feature `pi-ratings`, não do algoritmo** [1][6].

Para modelos de PLACAR (família Poisson) o ranking out-of-sample [2]: Dixon-Coles e Weibull-Count empatam no topo (RPS ~0,1914); **decaimento temporal** (`exp(−ξ·t)`) é o **maior ganho isolado** (0,1914→0,1891) [2][3][4]; double/bivariate Poisson são iguais ou piores (DC já é a forma certa dessa família — gols têm correlação levemente NEGATIVA, que a bivariate Poisson nem modela) [2][10]. O **Bivariate Weibull-Count + Cópula** [5] é o único challenger estatístico que ataca diretamente nossas métricas fracas (top-1 placar, log-loss): o parâmetro de forma modela sub- E super-dispersão e a cópula permite dependência negativa; tem retorno OOS positivo reportado e usa **só os dados que já temos** [5].

> **Mercado como âncora, não input** (regra de não-circularidade): o Pinnacle de fecho é calibrado a slope ~1:1 sobre 87.960 pares [9]; é o baseline de validação (CLV), jamais um input do modelo.

### 6.2 Gols O/U + BTTS (sub-3.2)

Derivar O/U/BTTS da matriz de placar (o que fazemos) é coerente e barato; o termo de correlação DC ajuda pouco no total de gols (concentra-se em 0-0/1-0/0-1/1-1) [2][10]. O achado forte: **modelar o total de gols DIRETO, usando chutes+escanteios como input** (Wheatcroft, "GAP ratings") tem **lucro médio ~0,8%/aposta em 12 anos / 68.672 apostas, 10 ligas** [13], com o paper companheiro confirmando que prever estatísticas (chutes/SOT/escanteios) como passo intermediário **carrega informação além das odds** [14]. A tese central — *"chutes e escanteios predizem gols melhor que gols passados"* — é diretamente acionável com os blocos `*Avgs` do choistats. Skellam (diferença de gols) é elegante para 1x2/handicap mas **perde o total** → fora de O/U/BTTS [10].

### 6.3 Contagens — escanteios, cartões, SOT (sub-3.3)

**Surpresa que muda o jogo:** **cartões são UNDER-dispersos** (variância < média; ν do CMP medido em 1,11–1,46) [11], confirmado independentemente [12]. **Negative Binomial só modela var ≥ média** — está na **direção errada** para cartões (provável causa do Brier ~0,25). O fix é **Conway-Maxwell-Poisson** (cobre under/equi/over-dispersão) [11][12], e o **árbitro** é a maior alavanca isolada (efeito 0,81×–1,23× na taxa de cartões) — que **não temos** hoje [11]. **Escanteios SÃO over-dispersos** → NB é a direção certa, e enriquecer com features de pressão (SOT/chutes/supremacia) tem backtest lucrativo [15]; batch-arrival (compound-Poisson) é uma segunda onda [16]. **SOT** vale mais como **feature** de gols/escanteios do que como mercado-fim [13][14]. Honestidade de eficiência: gols/O/U são líquidos (edge fino ~0,8% [13]); **escanteios/cartões são menos eficientes** (mais espaço para edge) [34], mas só se a forma da distribuição estiver certa.

### 6.4 Marcadores e eventos por jogador (sub-3.4)

O champion aloca eventos por jogador via multinomial dos gols do time — válido, mas **não é o que o mercado precifica** e tem um furo: o método canônico é **rate model** `λ_jogador = (gols/90 × minutos esperados)` → **anytime = 1−exp(−λ)** [com penalty-taker separado, pênalti ≈ 0,76 xG] [15-scorer][outras]. O mercado de scorer tem **favorite-longshot bias forte** (margens 43,7%→74,6% em request-a-bet; longshots sobreprecificados) [19][20] → **devig das odds de scorer (que o choistats já entrega e nós descartamos) é o melhor baseline + âncora**, e há valor estrutural em FADE de longshot. **Dirichlet-Multinomial** com shrinkage é o caminho para cartões/SOT/assists por jogador (incerteza da share tratada corretamente). **Bayes-xG** prova que a identidade do jogador melhora o xG [17] **mas exige shot-level (≥50 chutes/jogador)** — inviável com o choistats; é o teto que justifica buscar fonte de xG. OpenFPL (GBM sobre agregados) é o estado-da-arte replicável [18] mas exige xG/xA + histórico de treino.

### 6.5 Scoring rules, calibração, validação, champion-challenger (sub-3.5)

- **Métrica de DECISÃO = log-loss/ignorance** (proper, local, mais eficiente em small-sample); **RPS é não-local e fraco para discriminar modelos** [21][22] → manter RPS só como leitura ordinal na UI. **CRPS** para distribuições de **contagem** (compara a forma inteira, não só uma linha) [scoringRules]. **Decomposição CORP** (reusa o PAV que já temos) separa reliability de resolution e diagnostica a overconfidence (B24) com rigor [23].
- **Calibração:** isotônica **overfita em small-sample (<~500-1000 pts)** [24] — confirma academicamente as travas `n≥20/30` e os achados B31/B32; **beta calibration** (3 params, ~1/20 da variância da isotônica) é o upgrade para n-médio; **temperature scaling** [25] é o melhor no regime data-limited — **e o `T` da nossa `scoreline-cal` (B33) JÁ é temperature scaling** (reinventamos sem nomear). Venn-Abers [26] para rotular incerteza quando n é baixo (follow-up).
- **Validação honesta:** walk-forward + **purging/embargo** previne leakage temporal [27]; a walk-forward-bomb é overfit por **multiple testing** — a defesa é **controlar o nº de tentativas** (deflacionar significância) [27][28], não "calibrar melhor".
- **Provar vitória:** **bootstrap pareado** dos deltas de log-loss por jogo (primário; robusto a small-sample/cauda) + **Diebold-Mariano com correção HLN+t(T−1)** (cross-check) [29][30], **deflacionado pelo nº de challengers** [28]. **Gate triplo de promoção (humano):** log-loss↓ **E** CLV vs fechamento não-pior **E** reliability (CORP) não-pior.
- **Arquitetura shadow:** persistir **uma predição por (jogo × modelo × mercado) no momento do jogo** (forward-only — contorna a retenção de 4 dias); só o champion alimenta bilhete/recomendador; challengers em shadow [31][32].

### 6.6 Enquadramento honesto — a analogia da previsão do tempo

A previsão do tempo é "absurda" por: (a) **lei física conhecida** (Navier-Stokes); (b) **observação quase total**; (c) **sistema estacionário**; (d) **verificação/ensemble obsessivos**. O futebol **não tem (a)** (não há "lei do futebol"), tem **(b)/(c) fracos** (cego sem xG/escalação/árbitro; times mutam toda temporada), e tem um **adversário que o tempo não tem: o mercado** (previsão coletiva calibrada a r²≈0,997 [9]). Por isso o **teto de predição de placar é baixo por entropia do esporte**, não por limite de modelo — confirmado: o placar exato top-1 satura ~10-13% e só GBM+pi-ratings bate o mercado, por pouco [1]. **Mas o MÉTODO do tempo é transferível e é o roadmap:** mais observação (dados: xG/escalação/árbitro — a alavanca #1), melhor física generativa (Weibull/CMP/rate-model), ML sobre histórico acumulado (destrava com store append-only), e verificação/ensemble obsessivos (o champion-challenger). Ambição **real e alcançável**: bater o mercado nos **mercados ineficientes** (escanteios/cartões), provado por **CLV**.

## 7. Triangulated claims

| Claim | Confirming sources | Status | Evidence grade |
|---|---|---|---|
| Odds de bookmaker = RPS 0,2020; só GBM+pi-ratings bate | [1][9] | [triangulated] | A |
| DC ≈ Poisson ≈ bivariate Poisson em RPS (diferenças não-significativas) | [2][10] | [triangulated] | A |
| Decaimento temporal é o maior ganho isolado de RPS em modelos de placar | [2][3][4] | [triangulated] | A |
| **Cartões são SUB-dispersos** (NB na direção errada → CMP) | [11][12] | [triangulated] | A |
| Escanteios são over-dispersos (NB correto) + features de pressão lucram | [15][16] | [partial] | B |
| O/U direto de chutes+escanteios lucra ~0,8%/aposta OOS (12 anos) | [13][14] | [partial] (mesma fonte primária; direção triangulada com [15]) | B |
| Anytime-scorer = 1−exp(−λ); λ = rate×minutos | [15-scorer][16-scorer] | [triangulated] | B |
| Favorite-longshot bias forte em scorer (longshots sobreprecificados) | [19][20] | [triangulated] | B |
| Log-loss > RPS para discriminar modelos em small-sample | [21][22] | [triangulated] | B |
| Isotônica overfita em small-sample (<~500-1000 pts) | [24] + replicações | [triangulated] | A |
| Kaunitz lucrou (3,5-9,9% ROI) mas foi limitado/fechado pelas casas | [8] | [partial] | B |
| Sharp closing line é quase perfeitamente calibrado (slope ~1:1) | [9] | [single] (forte, mas 1 dataset) | B |
| Player finishing importa mas exige shot-level (≥50 chutes/jog.) | [17] | [single] — hipótese p/ aquisição de dados | C |

## 8. Alternatives considered

| Alternative | Why not chosen |
|---|---|
| GBM+pi-ratings / deep learning como challenger imediato | Melhor do mundo, mas **bloqueado pela retenção de 4 dias** (sem histórico de treino) + stack ML hostil em Ruby/Actions. É o destino estratégico, gated ao store append-only. |
| Double/Bivariate Poisson | Empata ou perde para o DC que já temos; só captura dependência positiva [2][10]. |
| Skellam | Perde o total de gols → fora de O/U/BTTS [10]. |
| CMP nas marginais de GOL | Ganho OOS inconsistente; constante de normalização cara. (Para cartões é outra história — recomendado.) |
| Bayes-xG / OpenFPL (jogador) | Exigem xG/shot-level que o choistats não dá [17][18]. Gated a aquisição de fonte. |
| RPS como árbitro de modelo | Não-local e ineficiente em small-sample [21][22]; fica só na UI. |
| Promoção automática de challenger | Repetiria a walk-forward-bomb (selection bias) — promoção é humana, gated. |

## 9. Known limitations

- **RPS entre ligas não é comparável em nível absoluto** — os números de [2] (Eredivisie) vs [1] (52 ligas) só se comparam por **ganho relativo**; a única comparação válida é **shadow no MESMO dado do projeto**.
- **Retenção de 4 dias é o gargalo transversal** — mata GBM/pi-ratings/deep-learning e enfraquece o decaimento temporal. O **store append-only** é o destravador de maior alavancagem.
- **Magnitudes de edge são hipóteses** — vários PDFs primários (Wheatcroft IJF, Lund thesis, compound-Poisson HKJC) retornaram 403 ao crawler; as **direções** estão trianguladas, os **números exatos de ROI** ficam como hipótese a confirmar.
- **Árbitro e xG não disponíveis** — as duas maiores alavancas externas (cartões e gols/jogador) dependem de aquisição de dados não-resolvida.
- `research-critic` dedicado não rodou (cada researcher se auto-criticou) — ver §12.

## 10. Suggested decision

**Adotar a arquitetura champion-challenger em shadow como a fundação** (uma predição por jogo×modelo×mercado, forward-only), com **log-loss como árbitro de modelo, CRPS para contagens, RPS só na UI, e CLV vs fechamento como baseline de skill**; promoção **humana gated** por gate triplo. **Primeiros challengers a rodar** (todos com dados que já temos): (1) **O/U direto de chutes+escanteios** (único edge OOS peer-review); (2) **CMP para cartões** (conserta a sub-dispersão — maior bug-class achado); (3) **Weibull-Count+Cópula** (ataca top-1/log-loss do placar); (4) **DC+decaimento ξ** (trivial); (5) **rate-model de scorer 1−exp(−λ)** + devig/persistência das odds de scorer. **NÃO** perseguir GBM/xG/árbitro agora — gated a (a) store append-only de histórico e (b) aquisição de dados. A ambição "nível previsão-do-tempo" é honesta no método (mais dados + verificação obsessiva), não no teto de acerto de placar (limitado pela entropia do esporte).

## 11. Follow-ups

- [x] ADR: "Avaliação de modelos: log-loss árbitro, CRPS contagem, champion-challenger shadow, promoção gated" → `docs/adrs/010-...` (criado neste ciclo).
- [ ] Task/feature: **arquitetura champion-challenger** (schema `model_predictions` + escrita shadow + scoring no reconciler + comparador + card `/calibracao`). **Em andamento** (PR da fundação).
- [ ] Task: **store append-only de histórico** (destrava GBM/pi-ratings) — o próprio `model_predictions` já é o começo.
- [ ] Challengers (próxima onda): O/U-direto, CMP-cartões, Weibull-Cópula, DC+ξ, rate-model scorer.
- [ ] Pesquisa derivada: aquisição de **xG** (understat/FBref) e **árbitro** — custo/benefício.
- [ ] Lições registradas em `docs/lessons.md` (cartões sub-dispersos; `T` do B33 = temperature scaling; isotônica overfita <500).

## 12. Adversarial review log

Tier L3 com auto-crítica por researcher (não houve `research-critic` dedicado; a síntese consolidou as auto-críticas).

### Weaknesses found

| # | Classification | Weakness | Action taken |
|---|---|---|---|
| 1 | blocking | Recomendar "bater o mercado" como meta default (quase impossível em RPS) | Resolvido: meta redefinida = bater mercados INEFICIENTES via CLV; mercado é âncora, não input |
| 2 | blocking | RPS como árbitro repetiria erro (não-local) | Resolvido: log-loss primário, RPS só UI [21][22] |
| 3 | blocking | Promoção automática repetiria a walk-forward-bomb | Resolvido: promoção humana gated + deflação por multiple testing [28] |
| 4 | must-fix | DM assintótico desonesto em small-sample | Resolvido: bootstrap pareado primário, DM-HLN cross-check [29][30] |
| 5 | must-fix | Magnitudes de edge de PDFs não-lidos | Marcado [partial]/hipótese (§7, §9) |
| 6 | must-fix | Retenção 4 dias invalidaria backtest de challengers | Resolvido: design forward-only (persiste probs no momento do jogo) |
| 7 | suggestion | Achado "cartões sub-dispersos" contradiz nosso NB atual | Registrado como challenger #2 (CMP) + lição |

## 13. References

1. [Machine Learning for Soccer Match Result Prediction](https://arxiv.org/pdf/2403.07669) — Bunker, Yeung, Fujii (2024). Benchmark RPS de 216k jogos.
2. [Which model should you use to predict football matches?](https://pena.lt/y/2025/03/10/which-model-should-you-use-to-predict-football-matches/) — penaltyblog. Comparação OOS de 6 modelos.
3. [Predicting Football Results: Dixon-Coles and Time-Weighting](https://dashee87.github.io/football/python/predicting-football-results-with-statistical-modelling-dixon-coles-and-time-weighting/) — dashee87.
4. [Modelling Association Football Scores...](https://rss.onlinelibrary.wiley.com/doi/abs/10.1111/1467-9876.00065) — Dixon & Coles (1997), JRSS-C.
5. [A Bivariate Weibull Count Model for Forecasting Football Scores](https://blogs.salford.ac.uk/business-school/wp-content/uploads/sites/7/2016/09/paper.pdf) — Boshnakov, Kharrat, McHale (2016).
6. [Learning to predict soccer results... gradient boosted trees](https://link.springer.com/article/10.1007/s10994-018-5704-6) — Hubáček et al. (2019).
7. [Dolores: a model that predicts football match outcomes](https://link.springer.com/article/10.1007/s10994-018-5703-7) — Constantinou (2018).
8. [Beating the bookies with their own numbers](https://arxiv.org/abs/1710.02824) — Kaunitz, Zhong, Kreiner (2017).
9. [The Efficiency of the Pinnacle.com Closing Line](https://www.football-data.co.uk/blog/pinnacle_efficiency.php) — football-data.co.uk.
10. [Analysis of sports data by using bivariate Poisson models](http://www2.stat-athens.aueb.gr/~jbn/papers2/08_Karlis_Ntzoufras_2003_RSSD.pdf) — Karlis & Ntzoufras (2003).
11. [Yellow fever: referee consistency via bivariate mean-parameterized CMP](https://academic.oup.com/jrsssa/advance-article/doi/10.1093/jrsssa/qnag014/8488960) — JRSS-A. Cartões sub-dispersos + efeito árbitro.
12. [Mean-parameterised CMP regression for over/under-dispersed counts](https://link.springer.com/article/10.1007/s11222-023-10244-0) — Statistics and Computing.
13. [A Profitable Model for Predicting the Over/Under Market in Football](https://eprints.lse.ac.uk/103712/) — Wheatcroft (2020), Int. J. Forecasting.
14. [Forecasting football matches by predicting match statistics](https://arxiv.org/abs/2001.09097) — Wheatcroft (2021).
15. [Forecasting Football Corner Odds](https://lup.lub.lu.se/student-papers/record/9127007/file/9127013.pdf) — Lund University thesis.
16. [Forecasting corner kicks using compound Poisson](https://arxiv.org/abs/2112.13001) — arXiv 2112.13001.
17. [Bayes-xG: Player and Position Correction on xG](https://arxiv.org/html/2311.13707) — arXiv 2311.13707.
18. [OpenFPL: open-source forecasting rivaling commercial FPL services](https://arxiv.org/pdf/2508.09992) — arXiv 2508.09992.
19. [Favourite-longshot bias](https://en.wikipedia.org/wiki/Favourite-longshot_bias) — síntese de estudos.
20. [Explaining the Favourite-Longshot Bias](https://www.pinnacle.com/betting-resources/en/betting-strategy/what-is-the-favourite-longshot-bias/vun2u32r85ppf4yp) — Pinnacle.
21. [Evaluating probabilistic forecasts of football: the case against the RPS](https://arxiv.org/abs/1908.08980) — Wheatcroft (2019).
22. [Better Metrics for Football Forecasts: Moving Beyond the RPS](https://pena.lt/y/2025/05/01/better-metrics-for-football-forecasts-moving-beyond-the-ranked-probability-score/) — penaltyblog.
23. [Stable reliability diagrams (CORP)](https://www.pnas.org/doi/10.1073/pnas.2016191118) — Dimitriadis, Gneiting & Jordan (2021), PNAS.
24. [Predicting Good Probabilities With Supervised Learning](https://www.cs.cornell.edu/~alexn/papers/calibration.icml05.crc.rev3.pdf) — Niculescu-Mizil & Caruana (2005).
25. [On Calibration of Modern Neural Networks (temperature scaling)](https://arxiv.org/abs/1706.04599) — Guo et al. (2017).
26. [Generalized Venn and Venn-Abers Calibration](https://arxiv.org/abs/2502.05676) — van der Laan et al. (2025).
27. [Cross-validation, embargo, purging, combinatorial](https://blog.quantinsti.com/cross-validation-embargo-purging-combinatorial/) — quantinsti / López de Prado.
28. [The Deflated Sharpe Ratio](https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf) — Bailey & López de Prado (2014).
29. [Comparing Predictive Accuracy (twenty years later)](https://www.sas.upenn.edu/~fdiebold/papers/paper68/pa.dm.pdf) — Diebold (2015).
30. [When +1% Is Not Enough: A Paired Bootstrap Protocol](https://arxiv.org/pdf/2511.19794) — arXiv 2511.19794.
31. [Validating ML Models in Production using Shadow Deployments](https://wallaroo.ai/validating-ml-models-in-production-in-the-cloud-or-at-the-edge-using-shadow-deployments/) — Wallaroo.
32. [Introducing MLOps Champion-Challenger Models](https://www.datarobot.com/blog/introducing-mlops-champion-challenger-models/) — DataRobot.
33. [Can Simple Models Predict Football — and Beat the Odds?](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5381388) — Wilkens (2026).
34. [Player Props: Understanding the Math Behind the Lines](https://wizardofodds.com/article/player-props-understanding-the-math-behind-the-lines/) — Wizard of Odds.
35. [Understat](https://understat.com) — fonte pública de xG (avaliação de aquisição).

---

## Version log

| Date | Version | Change | Author |
|---|---|---|---|
| 2026-06-03 | 1.0 | Versão inicial — síntese L3 de 4 researchers paralelos. | pilot+claude+researcher |
