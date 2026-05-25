# IA-2 — Recomendador de Apostas Pré-Jogo

**Status:** DESIGN — aguardando aprovação do Pilot antes do plan
**Data:** 2026-05-24
**Autor:** Pair Programming (Pilot Rafael + Executor)
**Substitui:** `/api/copilot` (chat dia), `/api/fixture-copilot` (chat fixture), `CopilotFab`, `FixtureCopilotDrawer` — ~2785 linhas de IA "merda" (palavra do Pilot: capability errada + performance ruim).

---

## 1. Intent (uma frase)

> Dada uma fixture, recomendar **em qual mercado apostar, quantos units, e por quê**, em forma híbrida (estruturada no topo + prosa embaixo), com cálculo determinístico ancorando o julgamento qualitativo da IA.

**O que NÃO é:**
- ❌ chat livre / conversação multi-turn
- ❌ triagem do dia ("qual jogo apostar" — feita por badge automático, não chat)
- ❌ coach de banca / retrospectiva
- ❌ explorador de curiosidade pré-jogo

**Tarefa única, output único, métrica única (ROI hipotético).**

## 2. Decisões consolidadas (do brainstorming)

| # | Decisão | Razão |
|---|---|---|
| D1 | Output **híbrido** (estruturado no topo + prosa) | Estrutura pro que medir (calibração), prosa pra contexto |
| D2 | **Backend computa edge por mercado**, IA escolhe + verbaliza | Menos espaço pra alucinar, ancoragem matemática |
| D3 | **Pre-compute no cron** pras fixtures com `edge >= 5%` | ~12 fixtures/dia, latência user = 0, custo ~$0.22/dia |
| D4 | **+ Botão on-demand** em qualquer fixture | Cobre os casos fora do cron (edge<5%, ligas s/F4) |
| D5 | Contexto: **pacote curado ~7KB** (sem detail_json bruto, sem tools) | Menos ruído, 1 chamada por fixture, previsível |
| D6 | **Kelly fracionado** backend (¼ Kelly), IA pode REDUZIR | Math protege; IA adiciona prudência qualitativa |
| D7 | **Cap absoluto 2.0u** por recomendação | Conservador pra single-user |
| D8 | Liga sem F4-params: **cap 0.5u** + flag "confidence baixo" no prompt | Cobertura sem exposição |
| D9 | Modelo: **DeepSeek R1** (reasoner) | Pensa antes de responder; cron mascara latência 8-15s |
| D10 | **3 UI surfaces:** inline na fixture + badge na lista + dashboard | Máxima descoberta |
| D11 | Métrica: **ROI hipotético + Brier**, sobre TODA recomendação | Independe de o Pilot apostar — IA tem score próprio |
| D12 | **Nova table `ai_recommendations`** (não estende `ai_predictions`) | Conceito diferente: recomendação com market/units/edge |
| D13 | **Observabilidade obsessiva** (custo USD, prompt+response snapshot, prompt_version, edge_table_snapshot) | Requisito explícito do Pilot pra melhorar continuamente |

## 3. Arquitetura (3 camadas)

```
┌───────────────────────────────────────────────────────────────┐
│ CAMADA 1 — Calculadora de Edge (TS pure, determinística)      │
│                                                                 │
│ lib/ai-reco/edge-calculator.ts                                 │
│   buildEdgeTable(sim, oddsByMarket, bankroll, kellyFraction)   │
│     → EdgeCandidate[] ordenado por edge desc                   │
│                                                                 │
│ - Aplica isotônica via active-curves-repository                │
│ - Calcula edge = prob_calibrado*odd - 1 pra cada mercado       │
│ - Kelly fracionado (¼ default) → kelly_units por candidato     │
│ - 100% pure function; testable                                 │
└───────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────┐
│ CAMADA 2 — IA Reasoner (OpenRouter)                            │
│                                                                 │
│ lib/ai-reco/recommender.ts                                     │
│   recommendForFixture(pkg) → AiDecision                        │
│                                                                 │
│ - Input: pacote curado (~7KB) com edge table + contexto        │
│ - Modelo: deepseek/deepseek-r1                                 │
│ - Schema rígido (JSON output)                                  │
│ - 1 chamada, sem tool-loop                                     │
│ - Cap enforcement (units <= 2.0u, <= 0.5u liga não-calibrada) │
└───────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────┐
│ CAMADA 3 — Pipeline + Storage                                  │
│                                                                 │
│ scripts/scraper/lib/scraper/ai_recommender.rb                  │
│   - Chama edge calc (via Next.js interno OU portado)           │
│   - Chama OpenRouter via Ruby (Faraday)                        │
│   - Insere em ai_recommendations + llm_request_logs            │
│                                                                 │
│ Orchestrator:                                                  │
│   scrape → reconcilers → AiRecommenderRunner.new(conn).run    │
└───────────────────────────────────────────────────────────────┘
```

**Decisão de execução do recommender (Ruby vs Next.js):**
- **Opção A (preferida):** Ruby chama OpenRouter direto via Faraday — edge calculator portado pra Ruby (lib pura, ~150 linhas). Custo de duplicação; ganho: pipeline 100% Ruby, sem dependência cross-stack.
- **Opção B:** Ruby chama endpoint `POST /api/internal/ai-reco/compute` (Next.js) com bearer token de service. Reusa TS lib, mas adiciona cross-service round-trip.
- **Plano default: A.** Lib TS continua pra on-demand (botão na UI). Portar edge calculator pra Ruby (`scripts/scraper/lib/scraper/ai_reco/edge_calculator.rb`) — pure logic, fácil portar com tests parelhos.

## 4. Storage

### 4.1 Migration `0022_ai_recommendations.sql`

```sql
create table if not exists public.ai_recommendations (
  id                bigserial primary key,
  created_at        timestamptz not null default now(),

  -- identificação da fixture (FK soft — fixtures pode purgar)
  fixture_id        bigint,
  home_team         text not null,
  away_team         text not null,
  league            text,
  kickoff_utc       timestamptz,

  -- versionamento
  reco_version      text not null,                -- 'reco-v1' inicial; bump quando lógica mudar
  prompt_version    text not null,                -- 'prompt-v1.0' — hash ou nome semântico
  llm_model         text not null,                -- 'deepseek/deepseek-r1'
  llm_log_id        bigint,                       -- FK soft pra llm_request_logs.id

  -- input (decisão)
  edge_table_snapshot jsonb not null,             -- TODAS as candidatas consideradas (não só a escolhida)
  league_calibrated boolean not null default false,

  -- output IA (estruturado)
  verdict           text not null check (verdict in ('bet','skip')),
  market            text,                          -- '1x2'|'over25'|'under25'|'btts-sim'|'btts-nao'|'asian'
  side              text,                          -- 'home'|'draw'|'away'|'over'|'under'|'+0.5'|'-1.0'…
  prob_estimated    numeric(4,3),                 -- prob bruta do modelo
  prob_calibrated   numeric(4,3),                 -- pós-isotônica
  edge_pct          numeric(5,2),                 -- ex: 8.50
  odd_captured      numeric(5,3),                 -- odd no momento da reco
  kelly_pre         numeric(4,2),                 -- pré-IA
  units_final       numeric(4,2),                 -- IA-adjusted (cap 2.0u, 0.5u liga não-cal)
  reduction_reason  text,                         -- por que reduziu Kelly (null = não reduziu)
  confidence        text check (confidence in ('alto','medio','baixo')),

  -- output IA (prosa)
  summary_line      text,                          -- "BTTS · 1.5u · 64%"
  reasoning_full    text,                          -- 3-5 parágrafos
  red_flags         jsonb default '[]'::jsonb,    -- ["3 desfalques", "..."]

  -- custo
  cost_usd          numeric(8,5),                  -- denormalizado: (prompt_tk * price_in + comp_tk * price_out)

  -- reconciliação (preenchido pelo AiRecommendationReconciler)
  status            text not null default 'pending'
                      check (status in ('pending','resolved','unresolvable')),
  actual_home_goals int,
  actual_away_goals int,
  actual_resolved_at timestamptz,
  bet_won           boolean,
  pl_units          numeric(6,2)                  -- +1.5 / -1.0 etc; null se skip ou unresolvable
);

create index if not exists ai_recommendations_status_kickoff_idx
  on public.ai_recommendations (status, kickoff_utc);
create index if not exists ai_recommendations_fixture_idx
  on public.ai_recommendations (fixture_id) where fixture_id is not null;
create index if not exists ai_recommendations_created_at_desc_idx
  on public.ai_recommendations (created_at desc);
create index if not exists ai_recommendations_verdict_bet_idx
  on public.ai_recommendations (kickoff_utc) where verdict = 'bet';

alter table public.ai_recommendations enable row level security;
grant select on public.ai_recommendations to authenticated;
-- service_role escreve; reconciler usa service.
```

### 4.2 Estender `llm_request_logs` (migration `0023_llm_logs_observability.sql`)

```sql
alter table public.llm_request_logs
  add column if not exists cost_usd        numeric(8,5),
  add column if not exists prompt_version  text,
  add column if not exists prompt_snapshot jsonb,    -- {system, user, edge_table}; pode ser truncado em entries antigas
  add column if not exists response_raw    text,     -- output literal da API (inclui <think>)
  add column if not exists ai_recommendation_id bigint; -- FK soft cross-ref

create index if not exists idx_llm_logs_prompt_version
  on public.llm_request_logs (prompt_version) where prompt_version is not null;
create index if not exists idx_llm_logs_cost
  on public.llm_request_logs (created_at desc) include (cost_usd);
```

**Política de retenção dos snapshots:**
- `prompt_snapshot` + `response_raw` **NÃO** são purgados automaticamente. São essenciais pra debug retroativo.
- Crescimento estimado: 12 reqs/dia × ~10KB jsonb cada = ~120KB/dia = ~44MB/ano. Trivial pro Supabase Free.
- Cron mensal (futuro F-obs-purge) pode truncar `prompt_snapshot`/`response_raw` pra entries > 90 dias se necessário. Por ora: **reter tudo**.

### 4.3 Reconciler novo: `AiRecommendationReconciler` (Ruby)

`scripts/scraper/lib/scraper/ai_recommendation_reconciler.rb`

```ruby
# Pseudocódigo
class AiRecommendationReconciler
  def initialize(logger:)
    # ...
  end

  def run(conn)
    pending = conn.query(<<~SQL).to_a
      SELECT id, fixture_id, home_team, away_team, kickoff_utc,
             market, side, units_final, odd_captured, verdict
      FROM ai_recommendations
      WHERE status = 'pending'
        AND kickoff_utc < now() - INTERVAL '3 hours'
    SQL

    pending.each do |row|
      # 1. Tentar encontrar resultado em fixtures (via fixture_id ou teams+kickoff)
      result = find_result(conn, row)
      next unless result

      # 2. Calcular bet_won + pl_units
      if row['verdict'] == 'skip'
        # Skip não tem aposta — marca resolved sem PL
        update_resolved(conn, row['id'], result, won: nil, pl: nil)
        next
      end

      won = evaluate_bet(row['market'], row['side'], result)
      pl = won ? (row['odd_captured'].to_f - 1) * row['units_final'].to_f : -row['units_final'].to_f

      update_resolved(conn, row['id'], result, won: won, pl: pl)
    end
  end

  private

  def evaluate_bet(market, side, result)
    # 1x2: side == 'home' && home>away, etc.
    # over25: side == 'over' && home+away > 2
    # btts-sim: side == 'sim' && home>=1 && away>=1
    # asian: precisa parsing do handicap line — pode ser feito numa V2
  end
end
```

Integração no orchestrator (`scripts/scraper/lib/scraper/orchestrator.rb`):

```ruby
# Após SimulationReconciler:
begin
  require_relative 'ai_recommendation_reconciler'
  AiRecommendationReconciler.new(logger: logger).run(conn)
rescue StandardError => e
  logger.call("[scrape] ai-reco reconciler failed (non-fatal): #{e.message}")
end
```

## 5. Recommender — schema do output IA

JSON Schema validado server-side (Zod TS / dry-validation Ruby):

```typescript
interface AiDecision {
  verdict: "bet" | "skip";
  // se verdict='skip', campos market/side/units_* podem ser null
  market?: "1x2" | "over25" | "under25" | "btts-sim" | "btts-nao" | "asian";
  side?: string;                          // 'home'|'draw'|'away'|'over'|'under'|'+0.5' etc
  units_final?: number;                   // 0 a 2.0 (cap 0.5 se liga não-cal)
  kelly_pre?: number;                     // backend já passou; IA ecoa pra audit
  reduction_reason?: string | null;       // null se units_final >= kelly_pre
  confidence?: "alto" | "medio" | "baixo";
  prob_estimated?: number;                // 0 a 1
  summary_line?: string;                  // ≤ 60 chars, ex: "BTTS · 1.5u · 64%"
  reasoning?: string;                     // 200-800 chars
  red_flags?: string[];                   // 0-5 entries, cada ≤ 80 chars
}
```

**Enforcement no recommender.ts (pós-IA):**
```typescript
function enforceCaps(decision: AiDecision, leagueCalibrated: boolean): AiDecision {
  if (decision.verdict === "skip") return decision;
  const cap = leagueCalibrated ? 2.0 : 0.5;
  const units = Math.min(decision.units_final ?? 0, cap);
  return { ...decision, units_final: Number(units.toFixed(2)) };
}
```

## 6. Prompt (versionado)

**`prompt-v1.0`** em `lib/ai-reco/prompts.ts`:

```
SYSTEM:
Você é um analista de apostas pré-jogo. Sua tarefa é escolher UMA recomendação
entre os candidatos abaixo (já calculados deterministicamente) e justificar
em 3-5 parágrafos. Você NÃO pode aumentar units além do Kelly sugerido — só
reduzir se houver red flag qualitativo. Responda SOMENTE com o JSON do schema.

Cap absoluto: 2.0u. Para ligas não-calibradas (flag league_calibrated=false),
cap: 0.5u.

USER:
# Fixture
Liga: {league} ({league_calibrated ? 'calibrada' : 'NÃO-calibrada — confiança baixa'})
{home_team} vs {away_team}
Kickoff: {kickoff_utc}
Árbitro: {referee_name | "—"}

# Candidatos (ordenados por edge desc, todos com edge >= 5%)
{edge_table_formatted}

# Contexto
## Sim Monte Carlo
Top 5 placares: {top_scorelines}
sim_stats home: {sim_stats_home_summary}
sim_stats away: {sim_stats_away_summary}

## Forma recente
{home_team} (últimos 5): {recent_home}
{away_team} (últimos 5): {recent_away}

## H2H últimos 3
{h2h_summary}

# Tarefa
Escolha o melhor candidato (ou verdict=skip se NENHUM convence) e gere o JSON
do AiDecision. Seja específico nos red_flags (não invente nada que não está
no contexto acima).
```

**Versionar:** cada mudança no prompt bumpa `prompt-v1.0 → v1.1`. Coluna `prompt_version` em ambas as tables permite A/B retroativo.

## 7. UI surfaces

### 7.1 Inline na fixture page (`/fixtures/[id]`)

Novo componente `app/(dashboard)/fixtures/[id]/_components/ai-reco-panel.tsx`:

```
┌─────────────────────────────────────┐
│ RECOMENDAÇÃO IA · confiança média   │
├─────────────────────────────────────┤
│  BTTS-sim · 1.5u · 64%              │
│  Edge 12% · Kelly 1.8u → IA 1.5u    │
│  Motivo redução: lineup incerta     │
├─────────────────────────────────────┤
│  Liverpool teve 5 BTTS consecutivos │
│  em casa contra defesas top-6.      │
│  Tottenham concedeu pelo menos 1    │
│  gol em 8/10 visitas. Árbitro novo  │
│  na competição (Lima) tem padrão    │
│  permissivo — não inibe.            │
│                                     │
│  Red flags:                         │
│   • 3 desfalques no ataque do TOT   │
│   • Forma recente do LIV irregular  │
│   • Liga calibrada — confiança alta │
├─────────────────────────────────────┤
│  Modelo: deepseek-r1 · prompt-v1.0  │
│  Custo: $0.018 · 12.4s · audit log  │
└─────────────────────────────────────┘
```

- Verdict=`skip` → card minimalista "IA não vê valor (edge top: BTTS +3%, abaixo do threshold 5%)"
- Sem reco salva → botão "[ pedir análise IA ]" → `POST /api/ai-reco/compute` on-demand
- Footer com modelo/custo/latência + link "audit log" → mostra prompt+response em modal

### 7.2 Badge na lista `/fixtures`

`components/fixtures/fixture-card.tsx`:
- Chip ⚡ inline ao lado do título, visível quando existe `ai_recommendations` com `verdict='bet'` ativo
- Tooltip: "IA recomenda {market} {units}u"
- Estado tem que vir da query da lista — adicionar `aiHasBet:boolean` ao DTO via cross-join (igual ao `high_signal` do B14)

### 7.3 Seção no dashboard `/`

`app/(dashboard)/_components/oportunidades-ia.tsx`:
- Top 5 reco com `verdict='bet'` e `kickoff_utc > now()`, ordenadas por `edge_pct * confidence_weight`
- Confidence weights: alto=1.0, medio=0.7, baixo=0.4
- Cada card: summary_line + liga + kickoff_brt + link

## 8. Observabilidade (seção dedicada — requisito do Pilot)

### 8.1 O que é capturado por chamada IA

| Campo | Onde | Pra quê |
|---|---|---|
| `cost_usd` | both tables | agregar custo/dia, custo/modelo, alarme se subir |
| `prompt_snapshot` (jsonb) | llm_request_logs | "que prompt rodou na fixture X?" — debug |
| `response_raw` (text) | llm_request_logs | output literal incluindo `<think>` blocks — debug raciocínio |
| `prompt_version` | both tables | A/B retroativo "v1.0 vs v1.1 — qual deu melhor ROI?" |
| `edge_table_snapshot` (jsonb) | ai_recommendations | "que candidatas IA considerou + escolheu qual + por quê" |
| `llm_log_id` | ai_recommendations | cross-ref bi-direcional |
| `latency_ms` | llm_request_logs | distribuição de latência por modelo |
| `prompt_tokens`/`completion_tokens` | llm_request_logs | tendência de uso (prompt crescendo?) |
| `error` | llm_request_logs | rate de falhas |

### 8.2 Painel `/llm-observability` (novo)

`app/(dashboard)/llm-observability/page.tsx`:

```
┌─ Custo & Volume ────────────────────┐
│ Hoje:    $0.18  /  12 reqs          │
│ 7 dias:  $1.42  /  84 reqs          │
│ 30 dias: $6.18  /  362 reqs         │
│                                     │
│ Por modelo (30d):                   │
│  deepseek-r1     $5.92  340 reqs   │
│  deepseek-v3.2   $0.26   22 reqs   │
└─────────────────────────────────────┘

┌─ Latência (30d) ────────────────────┐
│ p50: 9.2s   p90: 14.1s  p99: 22s    │
│ Erros: 3 / 362 (0.8%)               │
└─────────────────────────────────────┘

┌─ Prompt versions ativos ────────────┐
│ prompt-v1.0:  348 reqs · ROI +12.4u│
│ prompt-v1.1:   14 reqs · ROI +0.8u │
│ (A/B: rodando v1.1 em 4% do volume) │
└─────────────────────────────────────┘

┌─ Top 10 logs recentes ──────────────┐
│ [timestamp] [route] [model] $cost   │
│  Click → modal com prompt + response│
└─────────────────────────────────────┘
```

### 8.3 Custo: tabela de preços

`lib/ai-reco/pricing.ts`:

```typescript
export const MODEL_PRICING_USD_PER_1M_TOKENS = {
  "deepseek/deepseek-r1":     { in: 0.55, out: 2.19 },
  "deepseek/deepseek-v3.2":   { in: 0.27, out: 1.10 },
  "anthropic/claude-sonnet-4.5": { in: 3.00, out: 15.00 },
} as const;

export function computeCostUsd(model: string, promptTokens: number, completionTokens: number): number {
  const p = MODEL_PRICING_USD_PER_1M_TOKENS[model];
  if (!p) return 0;
  return (promptTokens * p.in + completionTokens * p.out) / 1_000_000;
}
```

Preços manuais (consultados em 2026-05-24); atualizar quando OpenRouter mudar.

### 8.4 Painel `/calibracao` — nova seção "IA Recommendations"

Reusa pattern das outras seções (data-section attribute, Brier rendering, etc.):

```
┌─ ROI & Win Rate (recomendações pré-jogo) ─┐
│ ROI total 30d:    +12.4u (em 57 bets)     │
│ Win rate:         56% (32 W / 25 L)       │
│ ROI por unit:     +0.22u/bet              │
│ Brier prob:       0.21                    │
├───────────────────────────────────────────┤
│ Por liga (top 5 volumes):                 │
│  Premier League   12 bets · ROI +4.2u    │
│  La Liga           9 bets · ROI +1.8u    │
│  ...                                      │
├───────────────────────────────────────────┤
│ Por confidence:                           │
│  alto              22 bets · WR 64%      │
│  medio             28 bets · WR 50%      │
│  baixo              7 bets · WR 43%      │
│  (sanity: alto deve > medio > baixo)     │
└───────────────────────────────────────────┘
```

## 9. O que apagar

```
DELETE app/api/copilot/route.ts                           # 391 linhas
DELETE app/api/fixture-copilot/route.ts                   # 281
DELETE lib/fixtures/copilot-tools.ts + test               # 223 + ~300
DELETE lib/fixtures/copilot-scan-tools.ts + test          # 489 + ~400
DELETE lib/fixtures/fixture-copilot-tools.ts + test       # 373 + ~250
DELETE components/fixtures/copilot-fab.tsx                # 413
DELETE components/fixtures/fixture-copilot-drawer.tsx     # 352
DELETE components/fixtures/copilot-tool-steps.tsx         # se único uso
DELETE components/fixtures/chat-message.tsx               # se único uso
DELETE supabase/migrations/0013_fixture_copilot_audit.sql # se table existir, DROP via migration 0024

KEEP lib/openrouter.ts                                    # 209 linhas — wrapper API
KEEP lib/llm-logs.ts                                       # 54 — agora estendido
KEEP lib/llm-logs-repository.ts                            # leitor
KEEP lib/ai/predictions-repository.ts                      # legado, deprecado mas mantido
KEEP lib/ai/calibration-metrics.ts                         # reuso pra novo painel
KEEP migration 0012 (llm_request_logs)                     # estende
KEEP migration 0016 (ai_predictions)                       # legado
```

**Net:** -2785 + ~700 (novo código) = **~-2000 linhas** com capability MUITO mais focada e observável.

## 10. Testes (TDD)

### 10.1 Unit (TS Vitest)
- `lib/ai-reco/edge-calculator.test.ts` — 15+ casos (cada mercado, edge cases zero/inf, Kelly cap, isotônica integration)
- `lib/ai-reco/recommender.test.ts` — mock OpenRouter, schema validation, cap enforcement (2.0u / 0.5u), JSON parse defensivo (Lição A do incidente copilot)
- `lib/ai-reco/pricing.test.ts` — cost math
- `lib/ai-reco/prompts.test.ts` — snapshot do prompt rendered

### 10.2 Unit (Ruby RSpec)
- `scripts/scraper/spec/scraper/ai_recommender_spec.rb` — orchestration, Faraday mock, payload shape
- `scripts/scraper/spec/scraper/ai_reco/edge_calculator_spec.rb` — pure logic (espelha TS)
- `scripts/scraper/spec/scraper/ai_recommendation_reconciler_spec.rb` — bet evaluation por mercado

### 10.3 Integration
- `tests/integration/ai-recommendations-display.test.tsx` — render do painel inline (bet/skip/sem reco)
- `tests/integration/ai-observability-page.test.tsx` — painel `/llm-observability`

### 10.4 Static guards (defensivos)
- Repo payload guard: nenhum `.select` em `lib/ai-reco/**` ou `app/api/ai-reco/**` pode tocar `detail_json` (lição B12)
- Schema enforcement: `enforceCaps` é chamado em 100% dos paths (test)

## 11. Plano de migração (ordem)

```
P0  Migrations 0022 (ai_recommendations) + 0023 (extend llm_logs) aplicadas em prod
P1  Edge calculator TS + Ruby + tests (pure libs, sem rede)
P2  Recommender TS (com mock OpenRouter) + pricing + prompts versionados
P3  AI Recommendation Reconciler (Ruby) + integração no orchestrator
P4  Endpoint POST /api/ai-reco/compute (on-demand) + tests
P5  UI: ai-reco-panel inline na fixture page + badge na lista + dashboard
P6  Painel /calibracao "IA Recommendations" + Painel /llm-observability
P7  Smoke E2E ao vivo (badge multi-chrome: lição B17)
P8  Apagar /api/copilot, /api/fixture-copilot, componentes copilot, libs copilot
P9  Deploy + 1 rodada cron real + verificar resultado em prod
```

## 12. Custo & cap operacional

- **Cron pré-jogo:** ~12 fixtures × ~$0.018/reco = **$0.22/dia** (~$6.5/mês)
- **On-demand:** marginal (~$0.018 por click)
- **Observability storage:** ~120KB jsonb/dia × 365d = ~44MB/ano (trivial)
- **Cap operacional manual:** se custo/dia > $1.00, alarme via healthchecks.io (fail). Default: throttle no orchestrator pra max 30 fixtures/dia mesmo se edge_count for maior.

## 13. Riscos & mitigações

| Risco | Mitigação |
|---|---|
| IA hallucina red flag inexistente | Prompt explícito "não invente"; opcional: validador que checa red_flags vs contexto |
| OpenRouter rate-limit ou outage | 1 retry com backoff; após 2 fails, marca `ai_recommendations` com `error` e segue |
| Modelo R1 thinking explode tokens | Cap `max_tokens: 4000` (resposta + think). Alarme se p99 > 6000 |
| Cost drift (modelo fica mais caro) | Painel `/llm-observability` mostra cost trend; alarme se diário > 2× média 7d |
| Bug tipo B17 (UI feature invisível) | Smoke E2E ao vivo OBRIGATÓRIO em P7 antes de marcar shipped |
| Liga não-calibrada: IA pode sugerir bet com confiança alta indevida | Cap 0.5u + flag no prompt; teste cobrindo |
| Schema OpenRouter response variando | JSON parse defensivo (lição copilot-prod-incident); fallback `verdict=skip` se parse falha |

## 14. Out of scope (não fazer nessa rodada)

- ❌ A/B de modelos paralelo (deepseek vs claude) — pode entrar depois via prompt_version + llm_model
- ❌ Web search tool (lesões/news ao vivo) — risco hallucination alto, tool-loop volta a ser questão
- ❌ Multi-turn chat — explicitamente fora (intent diferente)
- ❌ Coach de banca / retrospectiva — outro feature, outro spec
- ❌ Triagem do dia ("dos 50, quais 5 olhar") — coberto pelas surfaces (badge + dashboard)
- ❌ Notificações push pro mobile quando aparecer oportunidade — futuro

## 15. Métrica de sucesso da feature

**Após 30 dias em prod:**
- ✅ ROI hipotético > 0u (qualquer positivo é vitória — modelo Poisson sozinho não é lucrativo na maioria das ligas pro mercado livre)
- ✅ Win rate >= 50% (em mercados 1X2 e over/under, > 50% significa edge real)
- ✅ Brier do prob_estimated <= 0.22 (calibração razoável)
- ✅ Custo total < $10/mês
- ✅ Zero incidentes de UI (badge invisível, etc.)
- ⚠️ Honesto: pode falhar. Se ROI < 0 após 30d com >=50 amostras, **kill the feature** ou re-prompt.

---

**Para o Pilot revisar:**
- Seções 1-3 (intent, decisões, arquitetura) — bate com o que tu queria?
- Seção 4 (storage) — schema das tables está OK? Falta algum campo?
- Seção 7 (UI surfaces) — mockup ASCII faz sentido?
- Seção 8 (observabilidade) — captura o suficiente do que tu pediu ("logs de tudo, custos, decisões")?
- Seção 11 (ordem de implementação) — faz sentido ou prefere outra sequência?

Se algo precisar ajustar, diz aqui antes de gerar o plan.
