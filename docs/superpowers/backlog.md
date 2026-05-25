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

## WAVE A — Disciplina (ATIVA, sessão 2026-05-25)

> **Critério de sucesso:** medir CLV real, fechar loop de ROI realizado, validar backtest sem leakage, e ter alerta operacional.
> **Após Wave A:** congelar features por 14-21 dias pra coletar dados.

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
