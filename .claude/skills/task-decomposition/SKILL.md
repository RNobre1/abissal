---
name: task-decomposition
description: Decompose non-trivial features into tracked tasks in docs/tasks/{feature}/. Provides structure for parallel work, granular review, and session resumption. Use the bootstrap skill to install templates first.
---

> **Pra engines sem skill loading (Cursor, Codex sem MCP):** leia este file inteiro e siga as instrucoes como se fossem suas. Voce nao precisa "invocar" — apenas obedeca. Cursor e Codex que tem `xp-stack` instalado via npm leem este SKILL.md em `.cursor/rules/` ou `.codex/skills/`.

Voce eh o Decompositor. Sua missao eh quebrar features nao-triviais em T-files rastreaveis com fonte de verdade JSON (tasks.json) + render markdown derivado (00-overview.md). Cada task tem id, slug, title, status, deps, phase, confidence — nunca crie task sem esses campos.

## Doc level (escolha antes de começar)

Pergunte ao Piloto qual nível de documentação:

- **`essencial`** (default pra features <1 dia ou bugfix): apenas `00-overview.md` + 1-3 T-files. Sem `PROGRESS.md`, sem `TERMINAL-PROMPTS.md`, sem `state.json`. Reduz overhead pra trabalho rápido.
- **`completo`** (default pra features >1 dia ou multi-onda): full pacote — `00-overview.md` + `PROGRESS.md` + `state.json` + `tasks.json` + 1 T-file por task + opcional `TERMINAL-PROMPTS.md` se for paralelizar via paperclip/local-waves.

Aceita via slash command argument: `/xp-stack:task-decomposition essencial` ou `/xp-stack:task-decomposition completo`. Default: `completo` se não especificado e feature parece grande; senão pergunte.

Salve a escolha em `state.json` campo `doc_level` (W2 schema já suporta).

# Task Decomposition

Non-trivial features (more than one day of work, multiple files, risk of parallel conflicts) must be decomposed into individual tasks before execution.

## Required Structure

Create `docs/tasks/{feature-slug}/` with:

| File | Purpose |
|---|---|
| `00-overview.md` | General plan, diagnosis (before/after), task table, sub-tasks, parallelism waves, how to execute |
| `PROGRESS.md` | Live snapshot: status per task, metrics, decisions, chronological history |
| `T{N}-{slug}.md` | One task per file. TDD mandatory (red -> green -> refactor -> verification), allowed/forbidden files, acceptance criteria, execution log |

## Conventions

- Slug in kebab-case (`testing-improvement`, `mtr-pricing`)
- Branch per task: `feat/{feature-slug}-T{N}`
- Status: `[ ] Pending` -> `[ ] Ready to dispatch` -> `[x] Completed YYYY-MM-DD (#PR -> hash)`
- Sub-tasks discovered in review become `T{N}.1`, `T{N}.2`, registered in `00-overview.md`
- PRs are not self-merged — user reviews and merges

## Task File Template (T{N}-{slug}.md)

Each task file must contain:
- **Header**: name, session N of N, branch, status checkboxes
- **Objective**: 1 sentence
- **Context**: larger feature, other sessions, decisions, CLAUDE.md refs
- **Files ALLOWED to touch** (exhaustive list)
- **Files FORBIDDEN** (exhaustive list)
- **Execution order with TDD** (Phase 1: RED, Phase 2: GREEN, Phase 3: REFACTOR, Phase 4: VERIFICATION)
- **Acceptance criteria**
- **Mandatory test scenarios**
- **Blockers** (when to stop)
- **Execution log**, **State on pause**, **Notes for review**

## Archival Policy — NEVER Delete Completed Tasks

Two options, in order of preference:
1. **In-place**: leave the folder where it is, mark `**Status:** COMPLETED on YYYY-MM-DD` in `00-overview.md`. Default.
2. **Move to `docs/tasks/_archive/{feature}/`**: only when `docs/tasks/` gets cluttered (5+ completed features). Use `git mv`, not `rm`.

**Reason:** Completed tasks contain non-reconstructable context (decisions, incidents, trade-offs, follow-ups not yet turned into features). Git preserves content theoretically, but `grep` in `docs/tasks/` is much faster than `git log`.

## Workflow

1. Copy from templates when starting a new feature — **don't redesign the structure**
2. Fill `00-overview.md` with diagnostic and task breakdown
3. Each task gets its own branch
4. Execute TDD phases in order within each task
5. Update `PROGRESS.md` as each task completes
6. Review with Pilot before moving to next task
