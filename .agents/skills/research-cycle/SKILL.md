---
name: research-cycle
description: Orchestrate rigorous research for non-trivial decisions using the researcher agent. Produces versioned reports with triangulated sources, inline citations, and optional adversarial review. Invoke with /xp-stack:research-cycle.
---

> **Pra engines sem skill loading (Cursor, Codex sem MCP):** leia este file inteiro e siga as instrucoes como se fossem suas. Voce nao precisa "invocar" — apenas obedeca. Cursor e Codex que tem `xp-stack` instalado via npm leem este SKILL.md em `.cursor/rules/` ou `.codex/skills/`.

Voce eh o Pesquisador. Sua missao eh triangular fontes (minimo 3), marcar confidence (🟢/🟡/🔴) em cada claim, e produzir trilha auditavel em sources.json + claims.json + pesquisa.md. Nunca afirme sem cite. Nunca cite sem fonte verificavel.

## Tier do ciclo (escolha antes de começar)

Três níveis de profundidade:

- **`L1` quick** (<5min, sem critic): WebSearch direto, 1-2 fontes, sem `sources.json` estruturado. Use pra dúvidas pontuais ou validação rápida de fato.
- **`L2` standard** (<15min, com critic): researcher principal + research-critic adversarial, 3+ fontes trianguladas, `sources.json` + `claims.json` + `pesquisa.md`. **Default**.
- **`L3` deep** (<30min, com 2-4 researchers paralelos): pra decisão arquitetural P0 ou trade-off complexo. Múltiplos researchers concorrentes + critic + sintetizador final.

Aceita via slash command argument: `/xp-stack:research-cycle L1` ou `L2` ou `L3`. Default: `L2`.

Salve qual tier foi usado no header de `pesquisa.md`.

# Research Cycle — Methodical Investigation

Non-trivial decisions (heavy library choices, architectural trade-offs, product hypothesis validation, complex incident analysis, large-scale refactors) need to be backed by formal auditable research. **Don't accept "gut feeling" as an ADR basis.** If the decision becomes an ADR, the research that backs it needs to become a file in `docs/pesquisas/`.

## When to apply

**Apply when:**
- Non-trivial architectural decision (heavy lib choice, external service, data pattern, cache strategy)
- Choice between >2 alternatives with non-obvious trade-offs
- Product or market hypothesis validation
- Complex incident with non-evident root cause
- Large-scale refactor affecting multiple layers
- Research on a new topic the team hasn't mastered

**Don't apply when:**
- Obvious bug with clear cause
- Task already mapped in a T-file with sufficient context
- Trivial decision (YAGNI), low-impact local change
- Production fire drill — urgency trumps rigor; rigor goes in the post-mortem

## Tiers (Pilot chooses at the start)

| Tier | What it does | Target latency | Approx cost |
|---|---|---|---|
| **L1 (quick)** | Single `researcher` agent, no critic | < 3 min | Low |
| **L2 (standard)** — **DEFAULT** | `researcher` + `research-critic` | < 8 min | Medium |
| **L3 (deep)** | 2-4 parallel researchers + critic | < 20 min | High (~15x simple chat) |

## Flow

### Step 1: Capture the question
If invoked with an argument, use it as the initial question. If invoked without argument, ask the Pilot.

### Step 2: Choose tier
Ask the Pilot which tier to run. Default L2. If in doubt between L2 and L3, choose L2.

### Step 3: Invoke the researcher agent
Use the `Agent` tool with `subagent_type: researcher` passing a self-contained prompt that includes:
- The central question
- The tier
- Relevant project context paths (CLAUDE.md, existing research docs, related code)
- Expected deliverable: complete report following the research template

### Step 4: Review the draft with the Pilot
Present: slug + metrics, 3-5 bullet summary, critic findings (if any), suggested decision.
Then ask: Accept and write | Run critic again | Iterate | Abort.

### Step 5: Write and close the loop
If the Pilot accepted:
1. Confirm the final slug
2. Write the content to `docs/pesquisas/{slug}.md`
3. Return: file path + final metrics + follow-ups
4. Proactively offer: "Create an ADR referencing this research?" / "Update CLAUDE.md lessons learned?" / "Open a task in docs/tasks/?"

## Operational rules

- **Never skip pipeline steps** — this skill has **5 flow steps** (above: Capture / Choose tier / Invoke / Review draft / Write). The `researcher` agent invoked in Step 3 internally runs its own **7-phase pipeline** (clarification, decomposition, parallel collection, triangulation, synthesis with citations, adversarial review, delivery). Even in tier L1, all 5 skill steps execute and all 7 researcher phases run — only the researcher's phase 6 (adversarial review via `research-critic`) is skipped in L1.
- **Never invent a question for the Pilot** — if the question is vague, ask before invoking the agent
- **Never write without explicit approval** — Step 4 exists for this
- **Never promote tier without asking** — if you think L1 won't suffice, ask before invoking
- **Respect pair programming** — this skill is the Pilot's tool, not an autonomous agent
