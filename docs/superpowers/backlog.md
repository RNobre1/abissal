# Backlog estratégico — Abissal

> **Última revisão:** 2026-05-25 (sessão de brainstorm executivo)
> **Objetivo:** consolidar decisões de evolução do produto após 10 perspectivas executivas/expert.

---

## Como ler este arquivo

- **WAVE A**: caminho **Disciplina** — medição rigorosa antes de novas features (em execução, esta sessão)
- **WAVE B**: caminho **Produto** — UX/ritual/distribuição leve (deferred condicional)
- **WAVE C**: caminho **Aposta de moat** — novos mercados/cobertura (deferred até CLV validar)
- **DEFERRED**: items que ficaram fora das 3 waves mas estão registrados
- **MATAR**: candidates a remoção

---

## Diagnóstico consolidado (10 perspectivas)

| Perspectiva | Achado-chave |
|---|---|
| **PO** | Botão "Apostei" não cria bet na banca → loop não fecha |
| **CEO** | Pare de construir; 14-21 dias coletando dados out-of-sample |
| **CSO** | Moat real = loop fechado + ligas obscuras (n=14 calibradas). Mercados 1X2/O2.5/BTTS = commodity |
| **CTO** | `compute/route.ts` (771 LOC) duplica pipeline Ruby; AiRecommenderRunner morre silencioso no rescue global |
| **CMO** | Loop morre em silêncio pós-jogo. Falta "encerramento do dia" |
| **CFO** | TCO real ≈ R$3.400/mês (tempo). Bankroll mínimo R$35k pra pagar isso |
| **CRO** | Cap cego à confiança; correlação intra-dia esquecida. Worst-case 30d = -28% bankroll |
| **Sharp** | Sem CLV é cego. Edge ≥20% em soft books = overlay stale; vai virar conta limitada em 60-90d |
| **ML** | Backtest +14% tem leakage temporal grave; ROI real provável +2 a +8%; IC95% = ±7.5pp |
| **Legal** | IRRF 15% definitivo em casa SPA-BR; 0% deduzível; manter ledger 5 anos |

### Convergências fortes (3+ agents)

1. **CLV é o buraco central** (Sharp + CSO + ML)
2. **Pare de construir, colete dados** (CEO + ML + Sharp)
3. **Loop "Apostei → Bet" não fecha** (PO + CMO + CFO)
4. **Ligas calibradas (Premier/La Liga) são as PIORES pra ter edge** (CSO + Sharp)
5. **R1 pode estar adicionando custo, não alpha** (Sharp + ML — Cenário A determinístico = +8.1%)

---

## WAVE A — Disciplina (SHIPPED 2026-05-25)

> **Critério de sucesso:** medir CLV real, fechar loop de ROI realizado, validar backtest sem leakage, e ter alerta operacional.
> **Após Wave A:** congelar features por 14-21 dias pra coletar dados.

### Status final

- [x] **A1 CLV tracking** — `ce865ab` · 21 closing odds capturados em prod
- [x] **A2 "Apostei" cria bet** — `f5c77d7` · migration 0025 + modal + endpoint + UI
- [x] **A3 Walk-forward backtest** — `d5491eb` · relatório bomba: ROI NEGATIVO em todos 10 cenários
- [x] **A4 Silent death detector** — `808a711` · orchestrator ping `HEALTHCHECKS_AI_RECO_URL/fail`

## WAVE R — Reversões (SHIPPED 2026-05-25 noite, resposta ao A3)

- [x] **R1** EDGE_THRESHOLD 20 → 10 — `a069037`
- [x] **R2** Kelly fracionado ¼ → ⅛ — `a069037`
- [x] **R3** Cap calibrada 2.0u → 1.0u, não-cal 0.5u → 0.1u — `a069037`
- [ ] **R4** PAUSAR bets reais até CLV ≥ +1.5% em ≥100 bets — **gate operacional do Pilot, não código**
- [x] **R5** IC95% bootstrap obrigatório em backtest — já implementado em A3
- [x] **R6** Blending α 0.5 → 0.3 — `a069037`

## QUICK WINS UX (SHIPPED 2026-05-25 noite)

- [x] **a11y**: contrast `--color-ink-faint` 1.7:1 → 3.5:1, skip link, ▲/▼ Metric — `a069037`
- [x] **Bookkeeper form**: sport/market/league selects + filtros `/bets` + migration 0027 — `28a2fec`

### A1 — CLV tracking

**Problema:** sem Closing Line Value, ROI a 30 bets é puro ruído. Sharp+CSO+ML convergem absoluto.

**Escopo:**
- Cron `closing-odds.yml` ~5min pré-KO de cada fixture com reco bet ativa
- Fonte: scrape Pinnacle (HTML público) ou Betfair Exchange (API com login). Investigar API Choistats — já agrega Pinnacle em alguns mercados.
- Migration `0025_closing_odds.sql` — `closing_odds(id, fixture_id, market, side, odd_close, source, captured_at, ai_recommendation_id REF)`
- Métrica: `CLV% = (odd_taken / odd_close - 1) * 100`
- UI: nova seção em `/calibracao` com CLV médio + IC95% + por liga
- Target: CLV ≥ +1.5% sustentado em ≥300 bets

### A2 — "Apostei" cria bet na banca

**Problema:** clicar "Apostei" só grava em `ai_reco_feedback`. A bet não nasce em `bets`. `/calibracao` mede ROI hipotético eternamente.

**Escopo:**
- Botão "Apostei" abre mini-modal: dropdown casa + odd capturada (pré-preenchida da reco) + stake (pré-preenchida = `units_final * unit_value`)
- POST endpoint cria bet em `bets` table com `ai_recommendation_id` FK
- Migration `0026_link_bets_to_ai_recos.sql` — `bets.ai_recommendation_id BIGINT REFERENCES ai_recommendations(id)`
- Idempotência: unique (ai_recommendation_id) — re-clique atualiza em vez de duplicar
- Após criar bet, panel mostra "vinculada à bet #X"
- /calibracao ganha tab "ROI realizado (bet humano)" vs "ROI hipotético (todas as recos)"

### A3 — Walk-forward backtest sem leakage

**Problema:** ML Researcher mostrou que `getActiveCurves` retorna curvas treinadas nas mesmas 30d que o backtest avalia. ROI +14% provavelmente cai pra +4-8% out-of-sample real.

**Escopo:**
- Refactor de `scripts/backtest-ai-reco.ts`:
  - Para cada fixture em janela `[t, t+7d]`, refit isotônica + league_params usando apenas sims `actual_resolved_at < t`
  - Loop temporal expanding window (Constantinou & Fenton 2012 §4)
- Bootstrap IC95% no ROI: re-amostrar 1000× com reposição
- Decompor Brier via Murphy (1973): Reliability − Resolution + Uncertainty
- Adicionar LogLoss + CRPS
- Output: relatório `docs/superpowers/specs/2026-05-25-backtest-walk-forward.md`
- Honest ROI esperado: +2% a +8%

### A4 — Silent death detector no scraper

**Problema:** `AiRecommenderRunner.run` é `rescue StandardError` não-fatal no `orchestrator.rb:432`. Se quebrar silenciosamente, scrape fica verde no healthchecks e Pilot só descobre dias depois.

**Escopo:**
- Adicionar `recommendations_created` ao `RunStats` do orchestrator
- No fim do scrape: se `recommendations_created == 0 && fixtures_with_pending_sim > 10`, pingar `HEALTHCHECKS_AI_RECO_URL/fail`
- Log claro: `[ai-reco] WARN: 0 recos criadas em dia com N fixtures pending — possível silent death`
- Healthchecks: criar 2º check em healthchecks.io só pro IA recommender (separado do scrape geral)

---

## WAVE B — Produto / Ritual (DEFERRED, prox 2-4 sem se Wave A validar)

> **Critério de retomada:** Wave A concluída + ROI real > 0 em 7 dias.

### B1 — Bot Telegram diário privado

- Bot Cloudflare Worker, 1 chat owner
- Manhã 07:15 BRT: "☕ N ops hoje. edge médio +X%. tap aqui [deep link]"
- Noite 23:30 BRT: "📊 fechou: ROI X u, streak N dias"
- Implementação: Telegram Bot API + cron Workers (~1h trabalho)

### B2 — Página "encerramento do dia"

- `/diario/[date]` com sumário: bets do dia, P/L, IA accuracy, próxima janela
- Hoje o reconciler atualiza DB e usuário nunca vê

### B3 — Streak/estado emocional no header

- "Hoje: 2W-1L · +1.2u · streak 8d"
- Cor do header reflete estado: verde=caça, cinza=descanso, vermelho=cuidado

### B4 — Stale alert + on-demand refresh

- Badge "stale (Δedge?)" quando `now - reco.created_at > 4h && kickoff < now + 3h`
- Botão refresh chama `/api/ai-reco/compute` (já implementado)

### B5 — Modal prompt+response em /llm-observability

- Click numa linha da tabela abre drawer com prompt+response raw
- Auditável o raciocínio do R1 sem precisar de psql

### B6 — Confiança como número (não label)

- Exibir `prob_blended` numérico ao lado da edge
- Régua quantitativa pra comparar recos

---

## WAVE C — Moat / Mercados (DEFERRED, condicionado CLV ≥ +1.5% em ≥300 bets)

### C1 — Asian Handicap + Over/Under linhas alternativas (1.5/3.5/4.5)

- Onde sharps de verdade moram. CSO + Sharp convergem.
- 5× mais candidatos por jogo → IA tem espaço pra escolher
- Risco: extender edge calculator pra mercados com handicap; testar isotônica pra cada
- Escopo: 2-3 sessões

### C2 — Cobertura agressiva em ligas obscuras

- Brasileirão Série B, K-League 2, J-League 2, Argentina B, Liga Portugal 2, Eredivisie 2, Leste-europeu
- Onde POD/RebelBetting cobrem mal, vig largo, sharps focam pouco
- Já está acontecendo organicamente via cron mensal — só precisa garantir cobertura no scraper

### C3 — Cap dinâmico em função de evidência

- Substituir `cap = calibrated ? 2.0 : 0.5` por função de (n_samples, confidence, edge)
- CRO sugeriu: `cap = min(2.0, 0.5 + 1.5*tanh(n_calib/30) * confidence_factor)`

### C4 — Circuit breaker automático

- Rolling Brier 14d > 0.27 OU PL 20d < -10u → auto-skip via env `RECO_KILL_SWITCH=auto`
- Detecta descalibração antes de queimar >12% bankroll

### C5 — Calmar Ratio rolling 30d

- Métrica de risco que ROI sozinho mente
- Target saudável ≥ 2.0; abaixo de 1.0 = parar

---

## DEFERRED — items registrados mas sem timing definido

### Técnicos

- **Extrair `lib/ai-reco/pipeline.ts`** consumido por TS endpoint + Ruby (via CLI Node) — elimina duplicação de pipeline (CTO D1, ~2 dias)
- **Renomear migrations pra timestamped** — eliminar workaround pg-direct (CTO D3, 1h)
- **Dashboard custo cumulativo em /llm-observability** — alarm $1/dia (CTO O3)
- **Migrar GH Actions Node 20 → Node 24** — deadline set/2026 (warning ativo)
- **CF Worker `abissal-production` órfão** — verificar se quebrou DNS/route (W2-A note)
- **Modal prompt/response em /llm-observability** (CTO + PO #4)

### Financeiros

- **Política formal de retiradas**: 30% lucro mensal retira, 70% reinveste até R$35k; depois 100% retira (CFO #4)
- **Reserva tributária 15%** segregada em conta separada
- **Ledger mensal** (data/casa/stake/retorno/IRRF) — defesa em malha fina (Legal #5)

### Risk

- **Kelly ⅛ até N≥50 bets reais resolved + Brier ≤ 0.23** (CRO #3b)
- **Cap diário 5u total + cap por liga 2u/dia** (CRO #3c — correlação intra-dia)
- **Stress test detector**: Brier 14d > 0.27 ou PL 20d < -10u → pause (CRO #4 = C4)

### Legal/Compliance

- **Disclaimer escrito** no README: "ferramenta pessoal, sem garantia, não é aconselhamento" (Legal #5b)
- **Operar APENAS casas SPA-BR autorizadas** — evita Carnê-Leão 27.5%
- **Stakes não-redondas + 3-5 casas** — evita limitação algorítmica (Sharp + Legal)

---

## MATAR — candidates a remoção

### `/audit` e `/logs` pages

- Vestígios do Bet-Manager pré-fusão
- `audit_log` é trigger-driven, útil pra debug, **inútil pro Pilot apostador**
- Esconde valor real no menu lateral
- **Sugestão:** tirar do nav, manter rota acessível por URL (PO contra-recomendação)

### Asian handicap como V2 explicito (era follow-up genérico)

- Já está nesta Wave C agora. Remover do follow-up genérico se aparecer em outro lugar.

---

## WAVE O+E+P — Expansão de mercados (corners, cards, SOT, players) — 2026-05-26

> **Origem**: Pilot 2026-05-26 ao perceber que IA só analisa 1x2/over25/btts. Sim Monte Carlo JÁ modela 7 métricas por time (goals · sot · cards · fouls · corners · tackles · offsides) com p10/p50/p90, mas o recommender descarta tudo exceto goals. Wave G (2026-05-25 noite) já preparou colunas `actual_corners_home/away`, `actual_cards_*`, `actual_sot_*` em `fixture_simulations` — só falta popular + emitir bets.
>
> **Gate**: dispara após A+B+C (Pipeline Health + IC95% + 3 charts MVP) mergear em prod.

### Por que importa

1. **Mais data de calibração** — Pilot disse: "teremos mais dados do desempenho dele". 7 dimensões × CRPS = signal much more rich pra detectar onde IA tem edge real.
2. **Mais oportunidades** — escanteios e cartões têm **vig menor** que 1x2 (mercados secundários, bookies dão margem maior) — onde sharps moram.
3. **Sim já faz o trabalho** — desperdício atual. `sim_stats.home.corners.p50 = 8.2 ± 2.1` está no DB, ninguém olha.

### Escopo dividido em 3 sub-waves (paralelizáveis após gate)

#### W-O (Odds) — Captura de odds dos mercados novos

- Investigação prévia: choistats expõe odds de corners/cards/SOT? Inspeção empírica do payload `widget/fixtures/{id}` é o primeiro passo.
- Se choistats fornece: estender `lib/fixtures/parser.ts` + `lib/fixtures/repository.ts` pra extrair e persistir em `market_anchor` (hoje só `{ Result: 1x2 }`).
- Se não fornece: **avaliar fontes alternativas** — Pinnacle API (paga, ~$15/mês), Bet365 scraping (complicado), Sportingbet via Cloudflare Worker proxy.
- Persistência: estender `fixture_simulations.market_anchor jsonb` pra incluir `Corners`, `Cards`, `SOT` com odds por threshold (over 9.5, over 10.5, etc).
- Decisão de produto: começar com **over/under corners** (mais líquido) e **over/under cards** antes de player props.
- Esforço: M-L (8-12h dependendo da fonte)
- Risco: bloqueio externo (choistats pode não ter; alternativas custam)

#### W-E (Edge calculator estendido)

- `lib/ai-reco/edge-calculator.ts`: estender union `export type Market = "1x2" | "over25" | "btts" | "corners-over-95" | "corners-over-105" | "cards-over-25" | "cards-over-35" | "sot-over-95" | ...`
- Cada mercado:
  - **Prob predicta**: derivar de `sim_stats.home.corners.distribution` (precisa amostras Monte Carlo, não só p10/p50/p90 — pode exigir extender sim pra serializar samples por métrica)
  - **Odds**: do `market_anchor` estendido (W-O)
  - **Edge**: `prob_calibrated × odd - 1`
- Migration `0035_model_calibration_metrics.sql`: adicionar `'corners-over-95'`, `'cards-over-25'`, etc ao enum de `metric` (já estendido pra `'btts'` em 0031)
- Isotonic calibration: rodar `fit-isotonic.ts` pra cada novo mercado quando n≥30 (provavelmente vai demorar meses pra ter sample).
- Edge candidates por jogo saltam de ~4-6 → ~15-25. Recommender pode ficar mais lento. Pre-filter agressivo (`edge ≥ 10%` antes de chamar IA).
- Esforço: L (10-14h)
- Test plan: unit tests pra cada market (edge calc · CRPS reconciler · isotonic fit) + integration test com sim_stats real.

#### W-P (Prompt da IA estendido)

- `lib/ai-reco/prompts.ts`: prompt atual do DeepSeek R1 lista só 3 mercados. Estender pra incluir:
  - Lista de mercados disponíveis (1x2, over25, btts, corners-{over9.5,over10.5}, cards-{over2.5,over3.5}, sot-{over9.5,over10.5,over11.5})
  - Heurísticas de contexto: corners em ligas com pressing alto vs baixo · cards em jogos de rivalidade
  - Side-perspective novos: "over corners home" vs "under cards away"
- Edge_table_snapshot persistido inclui todos os candidatos novos (debug retroativo).
- Custo: prompt vai ficar maior → ~2x tokens input. DeepSeek R1 é barato (~$0.0018/call); 4 × tokens = ~$0.007/call. Aceitável.
- Esforço: M (4-6h)
- Test: snapshot tests do prompt rendering + parsing da resposta.

#### W-R (Reconciler estendido — dependência de W-O+G)

- `simulation_reconciler.rb` (Ruby): após W-O capturar odds, pull dos placares finais de corners/cards/sot via choistats (Wave G já confirmou: choistats NÃO fornece esses dados além de placar+cartões vermelhos).
- **Bloqueio externo conhecido**: fixture detail page só tem `homeCorners` quando arquivado em `recent_results` (histórico), não no jogo atual reconciliado. **Mitigação**: SofaScore API ou Footystats — investigar custo e cobertura.
- Sem reconciler estendido, CRPS de contagens implementado na Wave G fica dormant.
- Esforço: M (4-6h se source alternativa OK; XL se precisar reverse-engineering)
- Risco alto: pode bloquear todo W-O+E se nenhuma fonte fornece actuals.

### Ordem de execução pós-gate

1. **W-O primeiro** (investigação inicial: choistats expõe odds desses mercados?). Se NÃO, decisão de produto: pagar Pinnacle API ou parar wave inteira.
2. **Em paralelo (após W-O confirmar dados)**: W-E + W-P + W-R
3. **Validation gate**: smoke E2E — pelo menos 1 reco real em corners gerada + reconciliada com actual.

### Critério de sucesso

- ≥3 mercados novos emitindo recos diárias
- Edge_table_snapshot mostra ≥15 candidatos/jogo (vs ~6 hoje)
- 30d depois: Brier por mercado disponível em `/calibracao` (já preparado pela Wave G granular)
- ROI por mercado novo mostrado no Pipeline Health Card (Wave A da brainstorm calibração)

### Risco e contingência

- **Risco principal**: actuals indisponíveis externamente. Sim só, sem reconciliation = bets sem feedback loop = calibração quebrada.
- **Contingência**: começar com mercados onde temos actuals naturais — **cards** via `homeReds`/`homeYellows` no choistats recent_results (que Wave G já validou existir parcialmente). Corners/SOT defer até source alternativa achada.

### Esforço total

- W-O: 8-12h
- W-E: 10-14h
- W-P: 4-6h
- W-R: 4-12h (depende de source)
- Total: **26-44h wall-clock** com /auto paralelo

### Why não fazer antes da Wave A+B+C (brainstorm calibracao)

A+B+C entrega visibilidade do que JÁ existe. Sem isso, expandir mercados é amplificar fluxo cego — Pilot vai ter 4x mais recos sem ferramenta pra dizer se valem ou são ruído. Pipeline Health Card vai detectar quando W-E gerar recos sem actuals correspondentes (silenciamento que aconteceu hoje com goals).

---

## WAVE N — Aposta por foto (BACKLOG · pós UX overhaul · 2026-05-25)

> **Origem**: Pilot 2026-05-25 noite — "minha maior preguiça é registrar minha aposta". Casas têm UIs diferentes (Superbet, Bet365, Betano, etc); registro manual via Wave M reduz fricção mas exige digitar odds, mercado, side.

### Hipótese de produto

OCR + LLM parser sobre screenshot de cupom de aposta da casa → pré-preenche modal `Apostei` ou `BetSlipDrawer` (Wave M) com legs, odds, stake e potencial retorno. User confirma antes do commit.

### Arquitetura proposta

1. **Upload**: input `<input type="file" accept="image/*" capture>` no FAB do bilhete OU rota dedicada `/apostei/foto`
2. **Vision LLM**: enviar imagem + prompt estruturado pro DeepSeek Vision (via OpenRouter) OU Gemini 2.0 Flash (mais barato e melhor em OCR de cupons). Outputs: `{ legs: [{ home, away, market, side, odd_taken, league?, kickoff? }], stake_total, odd_combined, house_detected }`
3. **Fuzzy match**: comparar `home/away` extraídos com fixtures.home_team/away_team em janela [hoje-2d, hoje+4d] via trigram similarity (`pg_trgm` extension). Auto-link `fixture_id` quando confiança ≥ 85%.
4. **Modal de confirmação**: mostra legs parseadas com edit inline; flag legs sem fixture_id match (manual override); commit chama `commitSlip` da Wave M.
5. **Telemetria** (Wave T): `bilhete_foto_uploaded`, `bilhete_foto_parsed_success`, `bilhete_foto_legs_corrected` (user editou X legs), `bilhete_foto_committed`.

### Cobertura prevista por casa

| Casa | Probabilidade OCR ok | Notas |
|---|---|---|
| Superbet (screenshot Pilot) | Alta (90%) | Layout limpo, fonte legível, estrutura `time / mercado / odd` clara |
| Bet365 | Média (75%) | Dense, muitas badges, mas fonte ok |
| Betano | Alta (85%) | Cards estilizados, contraste alto |
| Estrela | Média (70%) | Layout denso mobile |
| Sportingbet/PixBet/etc | Variável | Avaliar por amostra real |

Caso OCR falhe: fallback gracioso pro fluxo manual atual.

### Custo estimado (atualizado 2026-05-25: Pilot pediu 2.5 Flash)

| Modelo | Input $/M tok | Output $/M tok | Custo/imagem* | Qualidade OCR cupons |
|---|---|---|---|---|
| **Gemini 2.5 Flash** | $0.30 | $2.50 | ~$0.0015 | Alta — melhor em layouts densos/tabelas |
| Gemini 2.5 Flash-Lite | $0.10 | $0.40 | ~$0.0005 | Média-alta — fallback econômico |
| Gemini 2.0 Flash | $0.10 | $0.40 | ~$0.0005 | Média — base |
| Claude Haiku 4.5 Vision | $1.00 | $5.00 | ~$0.004 | Alta — overkill no preço |
| DeepSeek Vision | ~$0.30 | ~$1.00 | ~$0.001 | Não testado em PT-BR cupons |

*Assume 1.2k tokens equiv input (imagem 1080×2400 + prompt) + 500 output tokens estruturados.

**Decisão default: Gemini 2.5 Flash via OpenRouter.** 10 bilhetes/mês × $0.0015 = **$0.015/mês** — desprezível. Fallback automático pro 2.5 Flash-Lite se quota Gemini estourar. Thinking mode OFF (não precisa raciocinar em cima de uma imagem estruturada — só extrair).

Validação inicial: rodar a screenshot Superbet do Pilot pelas 3 opções (2.5 Flash · 2.5 Flash-Lite · DeepSeek Vision), comparar accuracy nas 3 legs estruturadas + 1 live (Coritiba × Bahia X). Só fecha modelo padrão após esse benchmark de 1 caso.

### TDD

- Fixture suite: 5-10 screenshots reais (de várias casas, anonimizadas) commitados em `tests/fixtures/bet-slips/`
- Unit test do parser: mock LLM response → asserta legs estruturadas corretas
- Integration: subir imagem → matcher acha fixture → cria draft slip
- E2E: upload foto Superbet do Pilot → confirma 3 legs → commit cria 1 bet kind='multiple'

### Esforço · risco · gate

- **Esforço**: M-L (8-12h) — depende de quanto a fuzzy match falha (cleaner home_team mapping pode ser meio caminho)
- **Risco**: médio — depende da qualidade do vision LLM em PT-BR (validar primeiro com a screenshot Superbet do Pilot como caso de regressão)
- **Gate de entrada**: só depois de Wave M (`bet_slips` operacional) + Wave U mergeada (UX core estável). Telemetria de Wave M vai dizer se fricção do registro manual realmente justifica investimento.

### Não-decidido (aberto)

- Vision LLM: DeepSeek vs Gemini vs Claude Haiku 4.5 Vision — comparar custo × acurácia em 10 amostras antes de fechar
- Onde upload aparece: FAB do bilhete? Botão dedicado em `/bilhete`? Atalho de teclado (Power)?
- Multi-foto (cupom grande que rola): defer V2

---

## Não fazer agora (perigo)

- **Automação de placement de aposta** — Bet365/Betano detectam e limitam contas com padrão IA em 60-90 dias. Mantém decision-support manual. (CEO + Sharp)
- **Escalar capital pessoal acima de R$10k** — antes de N≥50 bets reais resolved e CLV ≥ +1.5%. (CRO + Sharp)
- **Abrir Abissal publicamente** (Twitter, RSS, SaaS) — vira graveyard de tipsters; drift de foco; manutenção de comunidade; risco regulatório (CMO #5 + CEO + Legal)
- **Trocar modelo IA (Sonnet, GPT-5, etc)** — sem evidência. Custo já está aceitável. R1 funciona.

---

## Critérios de retomada / pivot

| Métrica | Threshold | Ação |
|---|---|---|
| ROI real (bets vinculados a recos) | < 0 com N ≥ 30 | Kill switch IA-2 batch, mantém só on-demand decision-support |
| ROI real | ≥ +5% com N ≥ 50 | Iniciar Wave B (ritual) ou Wave C (Asian Handicap) |
| CLV médio | ≥ +1.5% sustentado N ≥ 300 | Liberar escalada de bankroll + Wave C |
| Drawdown bankroll | > 25% peak | Cap unitário pela metade até recuperar 50% |
| Custo IA/mês | > $20 sem expansão de cobertura | Auditar /llm-observability |
| Brier 30d ligas calibradas | > 0.235 | Bloquear novas bets em ligas não-calibradas |
| Recos criadas em 1 dia | == 0 com > 10 fixtures pending | Healthchecks /fail (A4 implementado) |

---

## Histórico de waves

- **2026-05-25 manhã:** IA-2 ship inicial (commits `795ff93..5f2ba63`)
- **2026-05-25 tarde Wave 1:** backtest + sanity + calibração expandida + on-demand R1 + feedback UI (5 agents)
- **2026-05-25 tarde Wave 2:** sanity 30→50 + blending α=0.5 + cron mensal (3 agents)
- **2026-05-25 tarde Wave 3:** edge threshold 5%→20% (1-line, validado)
- **2026-05-25 tarde Wave A:** disciplina (CLV + bet-link + walk-forward + silent-death) — EM ANDAMENTO
