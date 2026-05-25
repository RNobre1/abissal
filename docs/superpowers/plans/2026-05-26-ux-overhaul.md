# UX Overhaul — Plano de execução pós-brainstorm 2026-05-25

> **Origem**: brainstorm `/persona-brainstorm` com 22 personas sobre "front + tempo de uso + tempo pra ações + problemas cognitivos". Síntese em `/home/rnobre/.claude/projects/-home-rnobre--rea-de-trabalho-Projetos-Git-adam-stats/memory/persona-brainstorm-ux-night.md` + memory `MEMORY.md`.
>
> **Aprovação**: Pilot autorizou "fazer tudo EXCETO o que disse pra não fazer agora" + adicionou pedido NOVO de aposta múltipla (bilhete).
>
> **Filosofia**: ordem das waves importa. Telemetria + cleanup técnico antes de UX core (pra ter base diagnóstica). Bilhete tem prioridade alta porque destrava workflow inteiro do Pilot.

---

## ⛔ NÃO FAZER (lista fixa de "não fazer agora", mantida)

- ❌ Reduzir TODA fricção pré-aposta (DA+Pragmatist+BE convergem: atrito é proteção)
- ❌ Push de **ABERTURA** de oportunidades (Sharp: gatilho de tilt). **Fechamento 23h** OK.
- ❌ Stake redondo automático sem jitter (Sharp: marca conta como bot — ±10% jitter por default)
- ❌ Custo USD ($0.0018) em destaque no panel (BE: âncora de permissividade — esconder em `<details>`)

---

## 📦 Waves de execução

### WAVE T — Telemetria (PARALELIZÁVEL · base diagnóstica)

**Por que primeiro**: 4 personas (Time-on-Task, UX Researcher, BE, CPO) convergiram em "sem telemetria, redesign é especulação". Wave T destrava decisão de Wave U.

**Escopo**:
1. Migration `0028_ui_telemetry.sql` — `ui_telemetry(id, event_type, fixture_id?, ai_recommendation_id?, panel_id?, elapsed_ms?, session_id, created_at)`
2. Endpoint `POST /api/telemetry` (batched, fire-and-forget — never blocks)
3. Client hook `useTelemetry(event, payload)` com batching localStorage + flush 10s
4. Eventos novos:
   - `apostei_modal_open` (com `elapsed_from_panel_visible_ms`)
   - `apostei_modal_confirm` / `apostei_modal_cancel`
   - `apostei_modal_stake_zero` (quando defaultStake=0 — flag de bug)
   - `panel_view` (IntersectionObserver por `data-section` em StatsLayout, debounced 2s)
   - `feedback_button_click` (com elapsed)
   - `ondemand_button_click` + `ondemand_response_received`
5. Dashboard simples em `/admin/telemetry` (3 cards: top funnels, panel view distribution, modal abandonment)

**TDD obrigatório** (akita): tests endpoint + hook + IntersectionObserver mock

**Esforço**: M (3-4h) · **Risco**: baixo

---

### WAVE C — Cleanup técnico (PARALELIZÁVEL · EV positivo independente do modelo)

**Por que paralelo a T**: convergência de 5 personas (Sr Eng, FE, Performance, Motion, a11y) em fixes mecânicos. Aceita pelos 4 céticos de C1 porque é debt cleanup, não UX polish.

**Escopo (8 sub-tarefas)**:
1. **`parseChoistatsId` extraído** → `lib/fixtures/choistats-id.ts` + teste unitário. Substituir 7 callsites (Sr Eng).
2. **`Hero` remove `'use client'`** se possível (FE — investigar dependências antes).
3. **Middleware matcher exclui `/api/*`** — elimina round-trip Supabase Auth desnecessário (Perf).
4. **`Promise.all` em `fixturesForBrtDay`** queries #2+#3 (Perf, lib/fixtures/repository.ts:184-193).
5. **`useSyncExternalStore` → `@container` CSS** em `simulation-disclosure` + `stats-layout-responsive` (FE — elimina layout shift mobile).
6. **`useOptimistic` em `feedback-buttons.tsx`** — clique → estado saved imediato + rollback no catch (Motion+FE+IHC+a11y).
7. **`Cache-Control: public, s-maxage=300, swr=600`** em `GET /api/fixtures` (Perf).
8. **Shimmer skeleton via classe** (não `style={}` inline) — `PanelSkeleton:40` (Motion + a11y vestibular).

**TDD**: tests pra extracted utility + regression nos lugares modificados

**Esforço**: M (4-5h) · **Risco**: baixo · **Atenção**: alguns são "quase one-line" — não bundlar todos num commit gigante; agrupar por dimensão (extração, perf, motion).

---

### WAVE B — Bug fixes operacionais (PARALELIZÁVEL)

**Por que paralelo**: bugs latentes que afetam confiança e CLV.

**Escopo**:
1. **`defaultStake = 0` quando `units_final` null** → ler `bankroll_settings.units_per_bankroll` real, multiplicar por `units_final`. Fallback documentado se settings ausente.
2. **CLV correto**: novo campo `bet_selections.odd_taken` (já existe? confirmar) + modal "Apostei" tem campo **obrigatório** "odd que você efetivamente apostou" (não pré-preenchido cegamente). CLV passa a usar `odd_taken` vs `odd_close`, não `odd_captured` da reco. Migration leve se schema precisar.
3. **Stake jitter ±10% por default** (Sharp) — em vez de R$ 50,00 sugere R$ 47,30 ou R$ 51,80. Salva em telemetria a versão pre-jitter. Toggle off em settings se Pilot preferir redondo.
4. **Modal focus management** (a11y AA): `autoFocus` no primeiro campo do `ApostaiModal` + voltar foco ao trigger `<AiRecoActions>` no close. `aria-live="polite"` na confirmação "✓ Apostou".
5. **Selects de liga/mercado em `/bets`** com `onChange` → `router.push` (Bookkeeper bug pré-existente).

**TDD**: tests por fix

**Esforço**: M (3-4h) · **Risco**: baixo-médio (CLV fix muda semântica)

---

### WAVE M — Bilhete múltipla (NOVO PEDIDO DO PILOT)

**Por que prioritário**: workflow real do Pilot inclui aposta múltipla. Hoje não há nenhuma forma de montar bilhete — cada Apostei é single. Sem isso, o sistema não cobre 100% das apostas reais.

**Escopo**:
1. **Migration `0029_bet_slip.sql`**:
   ```sql
   CREATE TABLE bet_slips (
     id BIGSERIAL PRIMARY KEY,
     user_id UUID REFERENCES auth.users(id),
     status TEXT NOT NULL DEFAULT 'draft', -- 'draft'|'committed'|'cancelled'
     stake_total NUMERIC(12,2),
     odd_combined NUMERIC(10,4),
     potential_return NUMERIC(12,2),
     bet_id UUID REFERENCES bets(id) ON DELETE SET NULL,  -- preenchido ao committar
     created_at TIMESTAMPTZ DEFAULT now(),
     updated_at TIMESTAMPTZ DEFAULT now()
   );

   CREATE TABLE bet_slip_legs (
     id BIGSERIAL PRIMARY KEY,
     slip_id BIGINT NOT NULL REFERENCES bet_slips(id) ON DELETE CASCADE,
     ai_recommendation_id BIGINT REFERENCES ai_recommendations(id) ON DELETE SET NULL,
     fixture_id BIGINT,  -- choistats id
     home_team TEXT, away_team TEXT,
     market TEXT, side TEXT,
     odd_taken NUMERIC(10,4) NOT NULL,
     league TEXT,
     sport_id BIGINT REFERENCES sports(id),
     market_id BIGINT REFERENCES markets(id),
     created_at TIMESTAMPTZ DEFAULT now(),
     UNIQUE(slip_id, fixture_id, market, side)  -- evita duplicar mesma seleção
   );

   CREATE INDEX idx_bet_slip_user_status ON bet_slips(user_id, status);
   CREATE INDEX idx_bet_slip_legs_slip ON bet_slip_legs(slip_id);
   ```

2. **Server actions**:
   - `addLegToSlip(aiRecoId | manualLeg)` — cria draft se inexistente, adiciona leg, recalcula `odd_combined`
   - `removeLegFromSlip(legId)`
   - `updateSlipStake(stake)`
   - `commitSlip(houseId)` — converte em row em `bets` (kind='multiple') + cria N `bet_selections` + linka cada reco_id em `ai_recommendations` se aplicável
   - `cancelSlip()`

3. **UI**:
   - `<BetSlipFAB>` (Floating Action Button) sempre visível mostrando contagem (`Bilhete · 3 jogos · odd 8.50 · R$ 80`)
   - Click expande drawer com legs editáveis + stake input
   - Na `<AiRecoPanel>`: SUBSTITUIR botão "Apostei" único por 2 botões:
     - `[ + bilhete ]` → adiciona ao slip draft
     - `[ apostei agora ]` → fluxo single direto (igual hoje)
   - Página dedicada `/bilhete` pra revisar antes de committar
   - Validações: detecta legs incompatíveis (mesmo fixture, ou mesmo evento em mercados conflitantes — ex: Over 2.5 + Under 2.5)
   - Validação de timing: alerta se KO de algum leg já passou ou está muito perto
   - Cálculo: `odd_combined = produto(legs.odd_taken)` · `potential_return = stake * odd_combined`

4. **Integração com Wave B**:
   - Stake jitter aplica no slip total, não em cada leg
   - CLV: cada leg tem seu próprio `odd_taken` vs `odd_close` — CLV combinado = média ponderada por leg

**TDD**:
- Tests endpoint + UI
- Spec: slip com 3 legs Over 2.5/3.5 + 1X2/home, odd_combined correto, committar gera 1 bet kind='multiple' com 4 selections

**Esforço**: L (8-12h, é a maior wave) · **Risco**: médio (novo schema + workflow paralelo ao existente)

---

### WAVE U — UX Core (depende de T pra ter dados)

**Por que depois de T**: várias decisões (quais painéis colapsar, qual ordem) precisam de telemetria de painel-views.

**Escopo (5 sub-tarefas)**:

1. **Zona de decisão fixa no `/fixtures/[id]`** — 8 personas convergiram. Hero + AiRecoPanel + Momentum no topo com `max-h-screen`, divisor explícito "análise técnica ↓", 14 painéis restantes em scroll abaixo. `<SimulationDisclosure>` pattern já existe — replicar.

2. **Traduzir vocabulário** (6 personas + Content Designer com reescritas concretas):
   - "Edge X%" → ANTES + "Vantagem estimada X%"
   - "Kelly Yu → IA Zu" → "Aposta sugerida: R$ XX (Z unidades)" (com R$ visível como âncora — BE)
   - "skip" badge → "sem oportunidade"
   - Glossário inline tooltip pra termos técnicos restantes
   - Esconder `custo USD` em `<details>` "metadados técnicos"
   - Unificar terminologia cross-página: "confidence" → "confiança"; "OportunidadesIa" → "sugestões da IA"

3. **`/calibracao` redesign**:
   - Topo: 3 cards-resumo gigantes (Brier, ROI, CLV) com cor verde/vermelha conforme target
   - **CLV gauge visual**: progress bar "186/300 bets · CLV +0.8% · falta 0.7pp pro target +1.5%"
   - Reliability diagram SVG (scatter + diagonal y=x + banda Wilson 95%) — substitui tabelas de buckets
   - Equity curve interativa (PL cumulativo over time + drawdown subplot)
   - Heatmap liga × confidence
   - Tabelas atrás de `<details>` "detalhes técnicos"

4. **Bottom sheet modal "Apostei"** — replicar `mobile-bottom-nav.tsx` Radix Dialog fixed bottom. Tap targets ≥44pt. Resumo pre-confirm explícito (WCAG 3.3.4).

5. **Botão direto na listagem** — `OportunidadesIa` ganha botão "[ + bilhete ]" inline em cada card. Click adiciona ao slip sem precisar abrir `/fixtures/[id]`. Power+Naive+IHC+Casual convergem.

**TDD**: tests UI + accessibility tests + E2E manual final

**Esforço**: L-XL (10-14h) · **Risco**: médio

---

### WAVE P — Power features (após U)

**Por que depois**: workflow básico precisa estar sólido antes de atalhos avançados.

**Escopo**:
1. **Telegram bot FECHAMENTO 23h** (Cloudflare Worker + Telegram Bot API)
   - Mensagem: "📊 hoje: 2W-1L · +1.2u · IA acertou 67%"
   - Sem mensagem de manhã (Sharp veto)
2. **Atalhos de teclado** (Power):
   - `j`/`k` navegar fixtures
   - `Enter` abrir focused
   - `b` focar "+ bilhete" no AiRecoPanel
   - `s` skip + back
   - `[`/`]` fixture anterior/seguinte
   - `?` modal de ajuda com atalhos
3. **Batch endpoint** `POST /api/ai-reco/apostei/batch` — útil pra commitar slip + auto-bet futuro
4. **`/bets` melhorias Bookkeeper**:
   - Export CSV completo (todos campos + filtros aplicados)
   - Range de datas no filtro
   - Edição de bet pendente (UI usando `bet_events.edited` já no enum)
   - Autosave/draft em localStorage no `/bets/new`
   - Heatmap dia × liga
5. **Bankroll over time chart** em `/banca` (linha cumulativa + drawdown subplot)

**TDD**: por feature

**Esforço**: XL (12-16h) · **Risco**: baixo (features incrementais)

---

### WAVE G — Calibração granular (NOVA, pedido do Pilot 2026-05-25)

**Por que importa**: investigação revelou que **apenas 4/12 métricas que a sim produz são calibradas** (1x2-home/draw/away, over25). BTTS, escanteios, cartões, SOT, top_scorelines — **nunca coletados nem comparados**. Pior: pra contagens (gols totais), uso atual de threshold binário (`over 2.5? sim/não`) **perde informação de magnitude** — errar 0 vs 3 conta igual a errar 0 vs 8.

**Pilot quote**: *"a simulação errou por um escanteio a quantidade exata de cada time não deve ter o mesmo peso caso ele erre por 8 não?"*

**Escopo**:

1. **Migration `0030_actuals_secondary.sql`** — adicionar colunas em `fixture_simulations`:
   ```sql
   ALTER TABLE fixture_simulations ADD COLUMN IF NOT EXISTS actual_btts BOOLEAN;
   ALTER TABLE fixture_simulations ADD COLUMN IF NOT EXISTS actual_corners_home INT;
   ALTER TABLE fixture_simulations ADD COLUMN IF NOT EXISTS actual_corners_away INT;
   ALTER TABLE fixture_simulations ADD COLUMN IF NOT EXISTS actual_cards_home INT;
   ALTER TABLE fixture_simulations ADD COLUMN IF NOT EXISTS actual_cards_away INT;
   ALTER TABLE fixture_simulations ADD COLUMN IF NOT EXISTS actual_sot_home INT;
   ALTER TABLE fixture_simulations ADD COLUMN IF NOT EXISTS actual_sot_away INT;
   ```

2. **Reconciler estendido** (`scripts/scraper/lib/scraper/simulation_reconciler.rb`):
   - Pull de `fixtures.detail_json.match_stats` (verificar se choistats fornece — investigação prévia diz que sim_stats vem de `detail_json.avgs`, presumir que `match_stats` final também existe)
   - Se choistats não tiver, marcar como **conhecido limite** e usar só dados disponíveis (BTTS é trivial: `home > 0 AND away > 0`)
   - Preencher novas colunas no UPDATE

3. **Métricas de calibração estendidas** (`lib/calibracao/sim-reliability.ts` + `lib/ai/calibration-metrics.ts`):
   - **BTTS Brier**: `brierScore(p_btts, btts ? 1 : 0)` — uso de Brier existente
   - **Corner CRPS** (novo): empirical CDF da distribuição `p_corners` (do `sim_stats`) vs `actual_corners_total`. Implementação: ordena samples, compara contra step function do real.
   - **Card CRPS**, **SOT CRPS** idem
   - **Scoreline CRPS**: usa `top_scorelines` array (prob por placar) — compara contra placar real via squared distance

4. **Calibração isotônica estendida** (`scripts/calibracao/fit-isotonic.ts`):
   - Adicionar `'btts'` ao array `Metric[]` (já existe a coluna no enum SQL?? — checar)
   - Pra contagens: calibração isotônica não se aplica diretamente (precisa transformar contagem em probabilidade discreta). Opção A: calibrar **thresholds** (over 8.5 corners, over 9.5 corners — 1 curva por threshold). Opção B: skip calibração isotônica pra contagens, foco em CRPS.
   - Migration 0019 enum CHECK: estender pra incluir `'btts'`, `'corners-over-95'`, etc.

5. **UI em `/calibracao`** (extensão da Wave U):
   - Card-resumo por dimensão: 1x2 Brier · O/U Brier · BTTS Brier · Corner CRPS · Card CRPS
   - Reliability diagram por métrica binária
   - Histogram de erro de contagem (real - esperado) por métrica de contagem
   - Heatmap "fixture × métrica" mostrando onde sim acerta vs erra

6. **Decisão de produto**: se choistats NÃO fornece `match_stats` completos, considerar fonte alternativa (SofaScore, Footystats API). DEFER essa decisão se o investigador inicial encontrar bloqueio.

**TDD**:
- Tests pra CRPS function (Gneiting & Raftery 2007 reference impl)
- Tests pro reconciler com mock de detail_json sem match_stats (degrada gracioso)
- Tests pra calibração isotônica com novo metric

**Esforço**: M-L (6-8h) · **Risco**: médio
- Bloqueio externo possível (choistats fornece match_stats finais?)
- Schema migration grande mas idempotente

**Ordem**: paralelo a Wave T no início OU sequencial após M (depende de bandwidth)

---

### WAVE F — Fricção ética contextual (último, depende de T)

**Por que último**: usa dados de telemetria pra calibrar quando disparar.

**Escopo** (BE+Recovery convergem):
1. **Pre-bet thesis gate**: antes do `commitSlip()` ou `Apostei`, se `hora_BRT >= 22h OR drawdown_3d >= 10%`, força campo `thesis` (10+ chars) com microcopy: "É tarde. Qual sua tese em 1 frase?". Salva em `bets.thesis` (ou `bet_slips.thesis`).
2. **Quiet mode pós-loss**: se PL_24h < -X% (configurável), esconder `OportunidadesIa` no `/` por 4-6h. Substitui por card "última aposta: resultado negativo" com banca-summary acima.
3. **Settings `/configuracoes/disciplina`**: stop-loss diário, max bets/dia, cooldown pós-loss. Bloqueio server-side em `placeBetAction`.

**Esforço**: M (3-4h) · **Risco**: médio (muda fluxo crítico, mas com kill switch via env var)

---

## 🗂️ Cronograma sugerido (autonomous /auto session)

```
Sessão 1 (~8h paralela):
  Wave T (telemetria)         [1 agent worktree]
  Wave C (cleanup técnico)    [1-2 agents, dividir os 8 fixes]
  Wave B (bug fixes operac.)  [1 agent]
  Wave G (calibração granular) [1 agent — começa investigando choistats match_stats]
  → 4-5 agents paralelos

Sessão 2 (~10h):
  Wave M (bilhete múltipla)   [1-2 agents — backend + UI]
  → muita coisa, 1 wave inteira

Sessão 3 (~12h):
  Wave U (UX core)            [3 agents paralelos por sub-tarefa]
  → 5 sub-tarefas distribuídas, incluindo /calibracao redesign que se beneficia da Wave G

Sessão 4 (~10h):
  Wave P (power features)     [3-4 agents paralelos]

Sessão 5 (~4h):
  Wave F (fricção ética)      [1 agent + E2E final]
```

Total estimado: **~46-56h de wall-clock** com /auto + agents paralelos (G adicionou ~6-8h).

---

## ✅ Critérios de aceitação por wave

| Wave | Critério |
|---|---|
| T | Eventos chegam em `ui_telemetry`, dashboard básico funcional, sem regressão UI |
| C | Suítes 100% verde, perf measurável (Lighthouse cold/warm), parseChoistatsId 1 fonte |
| B | CLV usa odd_taken real, stake jitter aplicado, modal a11y AA, defaultStake nunca 0 |
| M | Slip com 3+ legs cria 1 bet multiple, validações funcionam, FAB visível, /bilhete navega |
| U | Zona de decisão clara, vocabulário traduzido, /calibracao com 3 cards + reliability SVG |
| P | Bot 23h dispara, atalhos funcionam, export CSV com filtros, bankroll chart |
| F | Thesis gate dispara nos thresholds, quiet mode aciona, settings/disciplina UI funcional |
| G | BTTS reconciliado e calibrado, Brier histórico mostra 5+ métricas, CRPS implementado pra contagens (escanteios/cartões — se choistats fornecer match_stats finais) |

---

## 🔗 Referências

- `~/.claude/projects/-home-rnobre--rea-de-trabalho-Projetos-Git-adam-stats/memory/persona-brainstorm-ux-night.md`
- `~/.claude/projects/-home-rnobre--rea-de-trabalho-Projetos-Git-adam-stats/memory/walk-forward-bomb.md`
- `~/.claude/projects/-home-rnobre--rea-de-trabalho-Projetos-Git-adam-stats/memory/persona-brainstorm-skill.md`
- `docs/superpowers/backlog.md` (atualizado com este plano)
