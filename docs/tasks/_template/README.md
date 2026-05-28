# Task Decomposition Template

Every non-trivial feature should be decomposed in `docs/tasks/{feature-slug}/`. This template exists so we never redesign the structure — copy and fill.

## Usage

```bash
FEATURE=my-feature
mkdir -p "docs/tasks/$FEATURE"
cp docs/tasks/_template/TEMPLATE-overview.md  "docs/tasks/$FEATURE/00-overview.md"
cp docs/tasks/_template/TEMPLATE-progress.md  "docs/tasks/$FEATURE/PROGRESS.md"
cp docs/tasks/_template/TEMPLATE-task.md      "docs/tasks/$FEATURE/T1-first-task.md"
# Optional, only if running in parallel terminals:
cp docs/tasks/_template/TEMPLATE-terminal-prompts.md "docs/tasks/$FEATURE/TERMINAL-PROMPTS.md"
```

## Files

| File | Required | Purpose |
|---|---|---|
| `00-overview.md` | Yes | General plan, diagnosis, task table, parallelism waves, how to execute |
| `PROGRESS.md` | Yes | Live snapshot: status per task, metrics before/after, decisions, chronological history |
| `T{N}-{slug}.md` | Yes (1+) | One task per file. TDD, allowed/forbidden files, acceptance criteria, execution log |
| `TERMINAL-PROMPTS.md` | Optional | Self-contained prompts to parallelize in worktrees/terminals |

## Conventions

- **Feature slug** in kebab-case: `user-auth`, `payment-integration`, `search-feature`
- **Task number** sequential from 1. Sub-tasks discovered in review become `T{N}.1`, `T{N}.2`, etc.
- **Branch** per task: `feat/{feature-slug}-T{N}`
- **Status checkboxes** at task header: `[ ] Planning` `[ ] In progress` `[ ] Tests passing` `[ ] Ready for review`
- **Conventional commits** matching the change type (`test:`, `feat:`, `refactor:`, `fix:`, `docs:`, `chore:`)

## Lifecycle

1. **Planning**: create `00-overview.md` with diagnosis and task table. Create each `T{N}-{slug}.md` with objective, scope (allowed/forbidden files), acceptance criteria, and test scenarios. No practical code in this phase.
2. **Execution**: each task becomes a branch, follows TDD (red -> green -> refactor -> verification), the executing session updates the **Execution log** inside the T-file.
3. **Completion**: PR opened against main. After merge, update status in `00-overview.md` and `PROGRESS.md` to `[x] Completed YYYY-MM-DD (#PR -> hash)`.
4. **Archival** (when ALL tasks in the feature are completed): see section below.

## Archival policy — NEVER delete

Completed tasks **are not deleted**. Two options, in preference order:

- **Option A (default): in-place**. Leave the folder where it is, update `00-overview.md` header with `**Status:** COMPLETED on YYYY-MM-DD`. `grep` still finds it, git blame preserves history.
- **Option B: move to `_archive/`**. Only when `docs/tasks/` root gets cluttered (5+ completed features competing with active ones). `git mv docs/tasks/{feature} docs/tasks/_archive/{feature}`.

**Never `rm -rf`.** Reasons:

- **Non-reconstructable context**: non-obvious decisions, trade-offs, incidents, workarounds that became hacks in the code. If someone deletes the T-file that explains why a specific hack exists, the next developer will "simplify" it and break things.
- **Onboarding**: new devs (or Claude in future sessions) read `docs/tasks/{completed-feature}/` to understand how we did that feature. Faster than reading 30 commits with `git log`.
- **Pending follow-ups**: sub-tasks discovered during execution stay registered in the feature's `00-overview.md`. Deleting the folder loses the tech debt list.
- **Audit**: when something breaks 3 months later, the first instinct should be "which feature touched this area?". A live folder answers in 1 second; git log takes 10+ minutes.
- **Zero cost**: markdown is text. All tasks of a feature together fit in ~100KB. Not worth the risk of losing context to save that.

Git preserves content theoretically — but `CLAUDE.md` doesn't read `git log`, and neither do you, most of the time.
