# {{Feature}} — Overview

**Date:** {{YYYY-MM-DD}}
**Objective:** {{One sentence with the problem and expected outcome. No process jargon.}}

---

## Diagnosis

{{What exists today vs what needs to exist. Before/after tables help. Numbers > adjectives.}}

| Category | Today | Target | Current quality |
|---|---|---|---|
| {{e.g., hook coverage}} | {{0%}} | {{100%}} | {{Bad / Medium / Good}} |
| {{e.g., API integration}} | {{38%}} | {{85%+}} | {{Basic}} |

---

## Tasks (execution order)

| Task | Name | Dependency | Estimate | Status |
|------|------|------------|----------|--------|
| [T1](T1-{{slug}}.md) | {{short name}} | None | {{S/M/L}} | [ ] Pending |
| [T2](T2-{{slug}}.md) | {{short name}} | T1 | {{S/M/L}} | [ ] Pending |

> **Status syntax:** `[ ] Pending` -> `[ ] Ready to dispatch` -> `[x] Completed YYYY-MM-DD (#{PR} -> {hash})`.
> Tasks blocked by another task: `[ ] Pending — blocked by T{N}`.

---

## Sub-tasks identified

> Follow-ups discovered during execution or review. Stay here as backlog until they become formal T-files.

| Sub-task | Origin | Description |
|---|---|---|
| T{N}.1 | PR #{{NN}} review | {{what fell outside original scope}} |

---

## How to execute

**Start a task in a new terminal:**
```
Read the file docs/tasks/{{feature-slug}}/T{N}-{{name}}.md and execute the task described in it.
Branch: feat/{{feature-slug}}-T{N}. TDD mandatory. When done, open PR to main.
```

**Parallelism allowed** (only include waves if you'll actually parallelize):

| Wave | Parallel tasks | Prerequisite |
|------|----------------|--------------|
| 1 | {{T1 + T2}} | None |
| 2 | {{T3 + T4 + T5}} | T1 complete |

---

## General rules

- **TDD absolute** — tests first, code after
- **One branch per task:** `feat/{{feature-slug}}-T{N}`
- **Conventional commits** matching the change type
- **Don't touch code outside declared scope**
- **CI must pass** after each task
- **On completion:** update status here, update `PROGRESS.md`, open PR to main
- **PR is not self-merge:** user reviews and merges

---

## On feature completion

When ALL tasks have `[x] Completed`:

1. Update this file's header: `**Status:** COMPLETED on YYYY-MM-DD`.
2. Update `PROGRESS.md` with final metrics snapshot.
3. Add ADR to the project's CLAUDE.md or dedicated ADR file if relevant architectural decisions were made.
4. **DO NOT delete the folder.** See `docs/tasks/_template/README.md` > "Archival policy".
