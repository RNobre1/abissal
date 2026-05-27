# Backlog estratégico — Abissal

> **Última revisão:** 2026-05-27
> **Estado atual:** coletando dados out-of-sample. Congelar features por 14-21 dias.

---

## Diagnóstico executivo (10 perspectivas, 2026-05-25)

| Perspectiva | Achado-chave |
|---|---|
| **Sharp** | Sem CLV é cego. Edge ≥20% em soft books = overlay stale → conta limitada em 60-90d |
| **ML** | Backtest +14% tinha leakage. Walk-forward: ROI real +2 a +8%; IC95% = ±7.5pp |
| **PO/CMO** | Loop "Apostei → Bet" fechado (A2 shippado). Falta ritual de encerramento do dia |
| **CRO** | Worst-case 30d = -28% bankroll. Cap cego à confiança; correlação intra-dia ignorada |
| **CEO** | Pare de construir. 14-21 dias coletando dados out-of-sample antes de próxima feature |

**Convergências fortes:** CLV é o buraco central · Pare de construir · Ligas calibradas (PL/LaLiga) são as PIORES pra ter edge.

---

## WAVES SHIPPADAS

| Wave | Commits | Status |
|---|---|---|
| A — Disciplina (CLV tracking + bet-link + walk-forward + silent-death) | `ce865ab..808a711` | SHIPPED 2026-05-25 |
| R — Reversões (edge 20→10, Kelly ¼→⅛, cap 2→1/0.1, α 0.5→0.3) | `a069037` | SHIPPED 2026-05-25 |
| UX a11y + Bookkeeper | `a069037`, `28a2fec` | SHIPPED 2026-05-25 |
| UX overhaul (8 PRs: mobile, bilhete múltipla, OCR foto, etc.) | PRs #2-#9 | SHIPPED 2026-05-26 |
| A+B+C brainstorm calibração (Pipeline Health + IC95% + 3 charts) | PR #10 | SHIPPED 2026-05-26 |
| O+E+P+R expansão mercados | PR #11 | SHIPPED 2026-05-26 |
| Wave N — aposta por foto | `282e069` | SHIPPED 2026-05-26 |

---

## Próximos passos imediatos

### P1 — odd_taken em `/bets/new` (CLV cego para apostas manuais)

**Gate:** corrigir agora — sem isso apostas manuais via `/bets/new` nunca populam `bet_selections.odd_taken`.

- Action `placeBetAction` precisa fazer UPDATE pós-RPC `place_bet` em `bet_selections` por `position_index`
- Schema Zod `selectionSchema.odds` já existe (reusar)
- Referência: `apostei/route.ts:329-336` que faz o mesmo para apostas via IA
- Migration 0030 já criou a coluna — só falta o UPDATE no action

### P2 — Lint `bets/new/form.tsx` (trava CI)

**Gate:** resolver agora — `eslint` reclama de setState sync em useEffect.

### P3 — Pendente Pilot (não é código)

- Criar bot Telegram via @BotFather + `gh secret set TELEGRAM_BOT_TOKEN/CHAT_ID`
- Login single-user: smoke E2E protegido aguarda spot-check manual
- Pendência PAT Supabase: rotacionar service role key quando expirar

---

## WAVE B — Produto / Ritual (deferred, gate: ROI real > 0 em 7 dias)

- **B1** Bot Telegram diário privado (07:15 manhã + 23:30 noite) — ~1h trabalho
- **B2** Página `/diario/[date]` — sumário diário: bets, P/L, accuracy, próxima janela
- **B3** Streak/estado emocional no header (verde=caça, cinza=descanso, vermelho=cuidado)
- **B4** Stale alert + on-demand refresh quando reco.created_at > 4h && kickoff < now+3h
- **B5** Modal prompt+response em `/llm-observability` (auditoria do raciocínio R1)
- **B6** `prob_blended` numérico visível (régua quantitativa)

---

## WAVE C — Moat / Mercados (deferred, gate: CLV ≥ +1.5% em ≥300 bets)

- **C1** Asian Handicap + Over/Under linhas alternativas (1.5/3.5/4.5)
- **C2** Ligas obscuras: Série B, K-League 2, J-League 2, Argentina B
- **C3** Cap dinâmico em função de evidência (`cap = min(2.0, 0.5 + 1.5*tanh(n_calib/30) * cf)`)
- **C4** Circuit breaker: Brier 14d > 0.27 ou PL 20d < -10u → pause automático
- **C5** Calmar Ratio rolling 30d (target ≥ 2.0)

## WAVE O+E+P+R — Expansão mercados corners/cards/SOT

**DEFERRED — arquivado em `docs/tasks/_archive/wave-oepr-deferred/`**
Gate de entrada: CLV médio ≥ +1.5% em ≥100 bets reais. Não mexer antes disso.

---

## Dívida técnica (sem urgência)

- `compute/route.ts` (771 LOC) duplica pipeline Ruby — extrair `lib/ai-reco/pipeline.ts`
- Renomear migrations pra timestamped (eliminar workaround pg-direct)
- Migrar GH Actions Node 20 → Node 24 (deadline set/2026)
- CF Worker `abissal-production` órfão — verificar DNS/route

---

## Critérios de retomada

| Métrica | Threshold | Ação |
|---|---|---|
| ROI real (bets vinculados a recos) | < 0 com N ≥ 30 | Kill switch IA-2 batch, mantém só on-demand |
| ROI real | ≥ +5% com N ≥ 50 | Iniciar Wave B ou C |
| CLV médio | ≥ +1.5% em N ≥ 300 | Escalar bankroll + Wave C + Wave O+E+P+R |
| Drawdown | > 25% peak | Cap unitário pela metade até recuperar 50% |
| Custo IA/mês | > $20 | Auditar `/llm-observability` |
| Recos criadas em 1 dia | == 0 com > 10 pending | Healthchecks /fail (A4 ativo) |

---

## Não fazer agora

- Automação de placement de aposta (limitação de conta em 60-90d)
- Escalar capital acima de R$10k antes de N≥50 bets resolved e CLV ≥ +1.5%
- Abrir Abissal publicamente
- Trocar modelo IA sem evidência
