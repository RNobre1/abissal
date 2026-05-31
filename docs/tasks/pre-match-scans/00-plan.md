# Pré-jogo "scans" sob demanda — duplo green + escanteios 2+ ambos os tempos

**Pedido do Pilot:** dois agentes do projeto, sob demanda, que dado uma data devolvem **top-10** de jogos por:
1. **Duplo green** — maior chance de um time **abrir +2 de saldo** em algum instante e **não vencer** (empate ou derrota).
2. **Escanteios** — maior chance de **ambos os times** terem **2+ escanteios em ambos os tempos** (casa 1ºT≥2 ∧ casa 2ºT≥2 ∧ fora 1ºT≥2 ∧ fora 2ºT≥2).

Usar os **dados da sim** (não os edges da IA). Top-10 desc por chance.

## Decisões (travadas com o Pilot)

- **Compute no motor Ruby** (escalares persistidos), não read-only — duplo green é path-dependent e o `top_scorelines` (top-6) trunca a massa relevante; a matriz DC-Poisson completa só existe no motor. Cobre 100% dos fixtures. (ADR-006.)
- **Sidecar empírico** no output dos agentes (não é o ranking, é conferência): a API tem escanteios por-tempo por partida recente (**53% de fill**) e gols por-tempo via HT (**100% de fill**). Mostrar ao lado da prob da sim.
- **Painel empírico no dashboard de stats** (`/fixtures/[id]/stats`): frequência empírica por-tempo de **gols (100%)** e **escanteios (53%, rotulado parcial)**. Display-only.
- **NÃO mexer no modelo/sim inputs** com o empírico (53% fill + bump de version = reset de calibração = armadilha B24/walk-forward). Fora de escopo.
- Escalares são **ranking/display-only** — fora de calibração/ROI/Brier.

## Matemática

**Duplo green** (da matriz `matrix[h][a]` = P(placar final h×a), com `diff = home−away`):
- `f_plus(rh,ra,diff)` = P(diff atinge ≥+2 em algum prefixo de uma interleaving uniforme de rh gols casa + ra gols fora). Recursão memoizada: `diff>=2→1`; `rh+ra==0→0`; senão `p=rh/(rh+ra)`, `p·f_plus(rh-1,ra,diff+1)+(1-p)·f_plus(rh,ra-1,diff-1)`.
- `f_minus` idem com alvo `diff<=-2`. `f_either` com `diff>=2 OR diff<=-2`.
- `p_duplo_green_home = Σ_{h<=a} matrix[h][a]·f_plus(h,a,0)`
- `p_duplo_green_away = Σ_{h>=a} matrix[h][a]·f_minus(h,a,0)`
- `p_duplo_green` (match, qualquer time): por célula — `h<a → f_plus`; `h>a → f_minus`; `h==a → f_either`.
- Validar `f_*` contra enumeração bruta das interleavings (small h,a).

**Escanteios:** pós-loop, dos samples por-tempo do MC: `(1/n)·#{i : casa_h1[i]≥2 ∧ casa_h2[i]≥2 ∧ fora_h1[i]≥2 ∧ fora_h2[i]≥2}`. NULL se `per_half_available=false` ou métrica corners ausente.

## Schema — migration 0046 (escrita)

4 colunas `numeric(5,4)` nullable em `fixture_simulations`:
`p_duplo_green`, `p_duplo_green_home`, `p_duplo_green_away`, `p_both_2corners_both_halves`.

## Fiação (mapa)

- **Motor:** `scripts/scraper/lib/scraper/simulation/monte_carlo.rb` (`run`, matriz na L21) → result hash; `runner.rb#simulate` (L80-93) passa adiante; `orchestrator.rb` `INSERT_SQL` (L156) + `build_params` (L275) adicionam as 4 colunas/valores.
- **Backfill:** `Runner.simulate(detail_json)` roda direto do blob → `bin/backfill_pre_match_scans` re-roda a sim de cada fixture com `detail_json` e dá UPDATE nas 4 colunas da linha mais recente.
- **TS read:** `lib/fixtures/simulation-repository.ts#FixtureSimulationDTO` + SELECT.
- **Empírico:** `lib/fixtures/stats/derive.ts#normalizeMatch` já resolve per-half por-time (gols/escanteios). Reusar pra frequências.
- **Dashboard:** `components/fixtures/stats/panels/splits-1h-2h.tsx` (médias) — adicionar painel/seção de **frequência empírica**.
- **Agentes:** `.claude/agents/*.md` + `scripts/analysis/pre-match-scan.ts` (supabase-js service role, padrão `scripts/calibracao/`).

## Status — SHIPPED 2026-05-31 (PR #25 + #26)

- [x] Migration 0046 aplicada em prod (4 colunas, via pooler).
- [x] Motor Ruby (worker, TDD): f_plus/f_minus/f_either vs enumeração bruta (56 ex) + persist + backfill.
- [x] Backfill rodado: **388 atualizados / 0 pulados / 0 erros**. Fix de id-space (casa pelo id do choistats, não fixtures.id — lição B29).
- [x] TS: DTO + SELECT (×2) + lib empírico (8) + lib ranking (7) + script + 2 agentes + painel dashboard (4). Gate: vitest 1633/1633, build ok, lint 0 erros.
- [x] PR #25 mergeado (10c82ac) + deploy CF **success**. PR #26 = follow-up `--upcoming`.
- [x] E2E real contra prod (próximos de 31/05): corners discrimina forte (Valur×Víkingur 40,5%); duplo-green 3-6% no topo.

**Como usar:** agentes `duplo-green` / `escanteios-ambos-tempos`, ou direto:
`pnpm exec tsx scripts/analysis/pre-match-scan.ts --metric duplo-green|corners [--date YYYY-MM-DD] [--upcoming] [--limit N]`
