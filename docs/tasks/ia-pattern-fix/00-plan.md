# Correção dos padrões ruins da IA-2 (pós-hibernação, 2026-05-31)

> **Diretriz do Pilot:** corrigir as probabilidades, **NÃO skippar** mercados
> (skip = fugir do problema). Sem tocar em `EDGE_THRESHOLD`/Kelly/α (gatilhos do
> walk-forward-bomb). O conserto é 100% **calibração**.

## Root cause (VERIFICADO na fonte)

`ai_recommender_runner.rb:262` chama `EdgeCalculator.build(sim, odds, @bankroll,
blend_alpha: @blend_alpha)` **sem `isotonic_lookup:`** → fica `nil` → o
`calibrate()` Ruby devolve a prob **crua**. **O batch (cron `ai-reco.yml`, fonte
de ~todas as 224 bets resolvidas) NUNCA aplica a isotônica.** As curvas fitadas
semanalmente só são aplicadas no caminho on-demand (TS `/api/ai-reco/compute`).
Bug de fiação (construído-mas-nunca-conectado, classe B16), não de tuning.

Consequências medidas (224 bets, 6 dias):
- Overconfidence sistêmica (diz 80%, ganha 54%; pior no `alto`).
- **over25-under 1/18 (5,6%) com prob 72,6%** — e o under é derivado como
  `1 − cal_over`, nunca calibrado por conta própria (assimetria over/under).
- **corners sem curva nenhuma** (nem on-demand) → "over impecável, under não".
- Herding: 28% das bets em "under 8.5 escanteios" (Poisson cru overconfident).

## Fixes (ordem por alavanca/risco)

- [x] **Fix 1 — Ligar a isotônica no batch Ruby.** ✅ SHIPPED (PR#19, f7e4989). `IsotonicLookup.load(conn,
  model_version)` → `Hash<String,Proc>` (interpolação linear das `pairs`, mesmo
  algoritmo do TS `applyIsotonic`); wire no runner (memoizado por model_version)
  → passar em `EdgeCalculator.build(..., isotonic_lookup: lookup)`. Aplica as
  curvas JÁ EXISTENTES (1x2/over25) ao caminho principal. **Risco: baixíssimo
  (bug fix).** TDD: RSpec do loader (interp + clamp + load) + spec do runner
  passando o lookup. **← ESTE PR primeiro.**

- [x] **Fix 2/3 (over25/btts) — SHIPPED.** Split independente `over25-over`/
  `over25-under` + `btts`/`btts-nao` (curvas próprias, não `1−over`) no fit +
  aplicação nos dois edge-calcs (Ruby + TS) + `buildIsotonicLookup` genérico.
  Migration 0044 (drop CHECK) aplicada. Validado contra prod: over25-under
  0,726→0,571 (deflaciona as bets −EV), over25-over 0,46→0,574 (corrige p/
  cima), Brier under 0,2487→0,2361. Secundários (corners/cards/sot, 180 amostras)
  = Fix 2b, próximo.

- [ ] **Fix 2 (ORIGINAL) — Estender o fit (`fit-isotonic.ts`) com curvas independentes por
  lado + secundários, gated em amostra.** Split `over25`→`over25-over` +
  `over25-under` (curvas próprias, não `1−over`); `btts`→`btts-sim`/`btts-nao`.
  Add `corners/cards/sot` por linha-padrão (over/under), computando a prob da sim
  da distribuição em `sim_stats` e o actual de `actual_corners/cards/sot_*`.
  **Trava:** só fita onde `n ≥ MIN` (temos 180 resolvidas v7 nos secundários —
  fita conservador 1-2 linhas; resto cai em identidade; log honesto do que ficou
  de fora). Migration p/ relaxar o CHECK de `model_calibration.metric`.

- [ ] **Fix 3 — Aplicar as curvas novas nos dois edge-calculators.** Ruby já
  referencia `corners-over-85` etc no `calibrate` — basta o lookup entregá-las +
  adicionar `over25-under`/`btts-nao` como chaves próprias. Espelhar no TS
  (`edge-calculator.ts` + `active-curves-repository.ts` METRIC_TO_SLOT).

- [ ] **Fix 4 — Validar.** Brier antes/depois nos mercados calibrados;
  confirmar que o edge de corners-under/over25-under **murcha** (bets −EV param
  de passar no gate sozinhas) — a prova do "consertar, não skippar". Rodar o
  recomendador num replay e comparar.

- [ ] **Fix 6 — Forma da distribuição de placar do sim (o "MUITOS 1x1").**
  SEPARADO dos isotônicos e mais arriscado (mexe no motor). Diagnóstico (737
  sims v7): médias de gol CERTAS (2,72 prev ≈ 2,72 real) e ρ médio normal
  (−0,077, só 2 ligas no floor −0,3) — **não é taxa nem ρ exagerado**. É a
  **forma**: too draw-heavy. Sim prevê over 46,1% vs 52,2% real; empate 26,8%
  vs 23,3%; fora 21,4% vs 28,0%. O Dixon-Coles infla 1-1/0-0 e concentra em
  empate de baixo placar. **A isotônica (Fix 2/3) conserta isso pra APOSTA**
  (mapeia p_over↑/p_draw↓/p_away↑), mas NÃO conserta o top_scoreline EXIBIDO
  (vem do MC cru). Conserto da forma = variância/DC/home-adv — investigação
  dedicada, gated, com CRPS antes/depois. **NÃO agora** (Fix 2 primeiro).
  Nota: a acurácia de placar É medida (CRPS/Brier/correct_winner) mas é
  **display-only** — sem feedback automático; melhora só via refit + isotônica.

- [ ] **Fix 5 — Botão "forçar análise"** (independente, paralelo). Spec em
  `docs/tasks/ai-reco-hardening/02-*.md`. Flag `forced` + **excluir de
  ROI/Brier/calibração** (classe B19). Param `force` no compute route bypassa o
  gate de edge; UI no `AiRecoPanel` com flags explícitas.

- [ ] **Follow-up — mais mercados (desarmes/impedimentos).** Investigar se
  choistats `*Avgs`/recent_results trazem os stats E se há **odds** (sem odds, sem
  edge, sem aposta). NÃO antes da base calibrada. Feasibility report primeiro.

## Invariantes
- TDD inegociável. Cada fix com teste antes do código.
- Nenhuma mudança em threshold/Kelly/α.
- Isotônica é anti-overfit por natureza, mas SEMPRE gated em `n` por métrica.
- Refit semanal (calibracao-weekly, B24) mantém as curvas frescas.
