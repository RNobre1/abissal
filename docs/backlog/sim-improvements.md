# Backlog — melhorias do motor de simulação pré-jogo

> **Sessão autônoma iniciada 2026-05-21.** Pilot autorizou implementação contínua até "tudo 100%". Backlog vivo: cada feature tem checkbox + estado + commits relacionados. Atualizar ao concluir/abandonar cada uma.

## Critérios de decisão (aplicar a TODAS as features)

- **min_samples_per_league = 30**: ligas com menos de 30 jogos persistidos em `fixture_simulations` (com `actual_*` resolvido) continuam no fallback global; auto-calibrações ignoram essas ligas.
- **Brier score binário (1X2) + multiclasse + over/under 2.5** como KPI primário em toda comparação A/B.
- **TDD primeiro, sempre.** Cada feature: spec → plan → subagent-driven TDD com 2-stage review (spec compliance → code quality adversarial) → push main → deploy CF Workers verde → atualização aqui.
- **Lição [[simulacao-pre-jogo-directives]] aplicada**: integration tests precisam alimentar a shape REAL do produtor Ruby, nunca mock hand-fabricado.

## Decisões consolidadas

| Decisão | Razão |
|---|---|
| GNN incluído (F14) | Pilot decidiu manter (única feature mantida da Seção 2 "fora do mundo de apostas"). |
| F9 (recent_matches prior) fundido em F8 | Bayesiano hierárquico acomoda forma temporal nativamente. |
| F11 (bivariate Poisson) marcado **stretch** | Só implementar se F4+F8 não fecharem calibração de placares baixos. |
| F12 (faltas/offsides/throw-ins) **cosmético** | Prioridade baixa; uso pessoal não exige. |
| F13 (stacking) **condicional** | Só vale se F8/F14 divergirem do baseline atual o suficiente em A/B. |
| F7 (xG) **POC de 1h antes** | Risco técnico: choistats pode não expor sinal cru. |

## Waves

### Wave 0 — Observabilidade (sequencial, GATE pra tudo)

- [x] **F1** — Reliability diagram (probability bins vs frequência observada) + Brier-over-time no `/calibracao`. **SHIPPED 2026-05-21.**
  - Commits: `d971191` (lib pura) + `ab6cebe` (page modificada) — 704/704 tests, deploy CF success, E2E ao vivo verificado em `https://abissal.rnobre.workers.dev/calibracao` com 3 linhas sintéticas inseridas/verificadas/deletadas em prod.

- [x] **F2** — Ground-truth do mercado: comparar `p_home` modelo vs `1/odd_devigada` por liga, com detecção de viés sistemático no `/calibracao`. **SHIPPED 2026-05-21.**
  - Commits: incluído em `ab6cebe` (mesma página); MAD modelo vs mercado renderizado por liga. Heurística "MAX-non-Draw como proxy do favorito" registrada inline; trabalho futuro: usar `home_team` exato após esquema permitir.

### Wave 1 — Calibrações baratas

- [x] **F3** — Calibração isotônica pós-modelo. **SHIPPED 2026-05-21.** Lib pura PAV + migration 0019 + script manual + display no `/calibracao`. Aplicação na leitura fica como follow-up **F3-prod**.
  - Commits: `ab8cd98`, `a0f63bd` (migration aplicada em prod), `ea2708a`, `46b3c53`. E2E ao vivo verificado.

- [x] **F6** — Árbitro no λ de cards. **SHIPPED 2026-05-21.** Blend 60% time + 40% árbitro, clamp [0.5, 2.0]. Bump `MODEL_VERSION` v2→v3.
  - Commits: `08d46ef`. 14 specs novos, 373 RSpec verdes.

- [x] **F10** — `outcome_odds_by_player.ANYTIME_SCORER` blend (α=0.3) na alocação de gols. **SHIPPED 2026-05-21.** Bump `MODEL_VERSION` v3→v4. `form` array fica como follow-up F10b.
  - Commits: `10c83be`. 9 specs novos, 382 RSpec verdes.

### Follow-ups derivados da Wave 1

- [x] **F3-prod** — Aplicar curva isotônica ativa na leitura (`getFixtureSimulation`). **SHIPPED 2026-05-24.** Reader `lib/calibracao/active-curves-repository.ts` (novo) lê `model_calibration` ativa por `model_version`; `applyCalibration` em `simulation-repository.ts` aplica as 4 curvas (1x2-home/draw/away + over25), re-normaliza 1X2, expõe `calibrated_via_isotonic` + `calibration_n` no DTO. UI: chip discreto no eyebrow do `SimulationPanel`. 758/758 testes verdes.
  - Commits: `afb7c39` (repo + tests), `2ff1c81` (aplicação + tests), `a6debee` (UI).
  - Cobertura inicial em prod: 12 curvas ativas (v7 com 300 amostras, v2 com 376, v1 com 49).
- [ ] **F10b** — Tratar `player_extra.form` (parsing de `statName` + mapping → goals/cards/sot).
- [ ] **MV-floor** — Mover assertion de `MODEL_VERSION` pra constante "floor" centralizada (lição do bump v3→v4 quebrar spec do F6).

### Wave 2 — Auto-tuning por liga (sozinho)

- [x] **F4** — Calibração por liga via Method of Moments. **SHIPPED 2026-05-21** (lib + script + migration). **F4-apply SHIPPED 2026-05-24** (Runner consome `LeagueCalibration.load(conn)` + threshold override pra ligas prioritárias com `low_confidence` flag).
  - 5 ligas calibradas em prod (Premier 54, Primera Division 33, Super League 33, Pro League 31, MLS 26 ⚠ low_confidence).
  - Override de threshold em `lib/calibracao/league-params.ts` (commit `7d6b2f9`): `priorityLeagues` map relaxa minSamples pra 20 em MLS + top-5 europeias + Brasileirão.
  - Substitui `NEUTRAL_BASELINE` + `RHO_BY_LEAGUE` por liga calibrada quando disponível; fallback transparente quando não.

### Wave 3 — A/B infra (gate pra Wave 4)

- [ ] **F5** — Storage + UI pra rodar 2+ `model_version` na mesma fixture e comparar Brier acumulado. Permite "shadow deploy" de modelo novo.
  - Status: pending
  - Custo: ~2d
  - Commits: _(a registrar)_

### Wave 4 — Motores novos via A/B

- [x] **F7** — xG proxy via `0.10·shots + 0.30·SoT` (POC 2026-05-21 confirmou xG cru ausente no choistats). **SHIPPED 2026-05-21** como opt-in dormente (`Rates.lambdas(..., use_xg_proxy:)`).
  - Commits: `0695711`. 9 specs novos, bump `MODEL_VERSION` v5→v6.
  - Follow-up `F7-prod`: ativar no produtor após coleta de dados resolvidos.

- [⏸] **F8** — Bayesiano hierárquico (Baio-Blangiardo 2010). **DEFERRED 2026-05-21.**
  - Justificativa: requer dados RESOLVIDOS pra estimar priors hierárquicos via MCMC/MAP. Hoje prod tem **0/665 sims resolvidas** (reconciler nunca rodou). Implementar sem dados produziria modelo nominalmente idêntico ao Rates atual com shrinkage — trabalho falso. Re-abrir quando ≥100 resolvidas por liga existirem.

### Wave 5 — GNN (motor extra, offline pipeline Python)

- [⏸] **F14** — Graph Neural Network sobre histórico de jogos. **DEFERRED 2026-05-21.**
  - Justificativa: GNN supervisionado precisa de labels (resultados) pra treinar. 0 resolvidas em prod hoje. Re-abrir junto com F8 quando dados existirem.

### Wave 7 — UX cleanup (não-funcional, mas necessário)

- [ ] **W7-UX** — Auditoria + reorganização: sidebar lateral está bagunçada; melhorar densidade/agrupamento mobile geral (não mudar design system, só organizar). Inclui: hierarquia visual, espaçamento, ordem de navegação, transições estado-vazio. Última wave da sessão autônoma — depois de tudo funcional estar verde.
  - Status: pending
  - Custo: ~2-3d
  - Commits: _(a registrar)_

### Wave 6 — Cosmético + reavaliação final

- [ ] **F12** — Estender Monte Carlo pra simular faltas/offsides/throw-ins (já no `detail_json`).
  - Status: pending
  - Custo: ~2d
  - Commits: _(a registrar)_

- [ ] **F11** — Bivariate Poisson / Skellam. **Decisão pós-medição** (só se F4+F8 não fecharem placares baixos).
  - Status: candidato pendente decisão
  - Commits: _(a registrar)_

- [⏸] **F13** — Stacking/ensemble dos modelos A/B. **DEFERRED 2026-05-21.** Depende de F8/F14/dados resolvidos.

## Backlog rolling (capturar tudo que aparecer no caminho)

_Lista de captura de tudo que surgir como tarefa derivada durante a execução. Tarefa estável ⇒ promover a feature numerada acima ou a backlog separado._

- **F4-cron** — Automatizar `scripts/calibracao/fit-league-parameters.ts` + `scripts/calibracao/fit-isotonic.ts` via cron mensal (GitHub Actions). Destrava coleta inicial de calibração assim que reconciler começar a fechar partidas.
- **F7-prod** — Ativar `use_xg_proxy: true` no produtor (`orchestrator.rb`) — opt-in atual fica dormente.
- **Reconciler-status** — Investigar/garantir que o reconciler do scrape-daily está rodando e fechando partidas (hoje 0/665 resolvidas). Bloqueador de F8/F13/F14.

## Estado de cada Wave

- **Wave 0 (F1+F2)**: ✅ SHIPPED 2026-05-21 — E2E ao vivo verificado.
- **Wave 1 (F3+F6+F10)**: ✅ SHIPPED 2026-05-21.
- **Wave 2 (F4 auto-tuning)**: ✅ SHIPPED 2026-05-21.
- **Wave 3 (F5 A/B infra)**: ✅ SHIPPED 2026-05-21 — migration 0021.
- **Wave 4 (F7)**: F7 ✅ SHIPPED (xG proxy opt-in); F8 ⏸ DEFERRED.
- **Wave 5 (F14 GNN)**: ⏸ DEFERRED.
- **Wave 6 (F12)**: F12 ✅ SHIPPED; F11/F13 ⏸ DEFERRED.
- **Wave 7 (UX cleanup)**: ✅ SHIPPED — sidebar agrupada + drawer "mais" no mobile.

## Bug fix crítico extra-roadmap

- ✅ **SimulationReconciler wired** (`009b1b4`) — existia mas nunca era invocado. 665 sims `pending` for-ever. Próximo scrape diário começa a popular `resolved`. Destrava F8/F13/F14 + auto-tuning real (F4 hoje só roda na infra dormente).

## Operacional adicional

- ✅ **F4-cron** (`3ed4f9d`) — GitHub Action `calibracao-monthly.yml` dia 5 às 08:00 UTC.
- ✅ **Lição B16 no CLAUDE.md** (`996fdd8`) — "Reconciler é obrigatório no pipeline".

## MODEL_VERSION final

- `sim-v1-poisson-dc-nb-mc10k-v7` (bumps acumulados: v2 → v3 [F6] → v4 [F10] → v5 [F4a] → v6 [F7] → v7 [F12]).

## Infra E2E criada nesta sessão

- User `e2e-test@abissal.local` no Supabase Auth (id `c4f2a719-a496-4b8d-919d-5a3fb0a49280`) — mantido pra E2E de próximas waves. Senha em memória autônoma. Deletar no encerramento da sessão completa.
