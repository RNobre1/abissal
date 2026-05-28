# Task: {{SHORT TITLE}}

> **Session:** Terminal {{N}} of {{total}}
> **Branch:** `feat/{{feature-slug}}-T{{N}}`
> **Status:** `[ ] Planning` `[ ] In progress` `[ ] Tests passing` `[ ] Ready for review`

---

## Objective

{{One or two sentences saying exactly what this task delivers. No "also", no elastic scope.}}

---

## Required context

- **Larger feature:** [00-overview.md](00-overview.md)
- **What other sessions are doing:** {{short summary of parallel tasks and why they won't conflict — or "None" if this task is solo}}
- **Decisions already made:** {{relevant ADRs, patterns chosen in the overview — avoid re-deciding here}}
- **Relevant CLAUDE.md sections:** {{list of sections the session should consult before starting}}

---

## Files ALLOWED to touch

```
{{exact/path/1}}
{{exact/path/2}}
```

> Be restrictive. An explicit list prevents scope creep during execution.

---

## Files FORBIDDEN (other sessions or critical files)

```
{{path/that/must/not/change}}
```

> If you need to touch something here, **stop and alert** (see Blockers).

---

## Execution order (TDD mandatory)

### Phase 1 — Tests first (RED)

- [ ] Create/expand test file at `{{path}}` with the scenarios from "Mandatory test scenarios"
- [ ] Run: tests fail (red) for the right reasons (not import/config errors)
- [ ] `git commit -m "test: {{what}} scenarios"`

### Phase 2 — Implementation (GREEN)

- [ ] {{concrete step 1}}
- [ ] {{concrete step 2}}
- [ ] {{concrete step 3}}
- [ ] `git commit -m "{{feat|fix|refactor}}: {{what}}"`

### Phase 3 — Refactoring (REFACTOR)

- [ ] Remove duplication, extract helpers if needed
- [ ] Run linter — no errors
- [ ] `git commit -m "refactor: {{what}}"` — **only if real changes**, don't force empty commit

### Phase 4 — Final verification

- [ ] All test suites pass (see project's CLAUDE.md for commands)
- [ ] Linter passes
- [ ] Type checker passes (if typed language)
- [ ] No files outside scope were modified (`git diff --stat main..HEAD`)
- [ ] No debug logs left, no new unttracked TODOs

---

## Acceptance criteria

- [ ] {{observable criterion 1 — provable via test or quick diff read}}
- [ ] {{observable criterion 2}}
- [ ] {{observable criterion 3}}

---

## Mandatory test scenarios

```
{{component or function under test}}
  - {{scenario 1 — happy path}}
  - {{scenario 2 — error or refusal}}
  - {{scenario 3 — edge case that caused a bug before or is known fragile}}
```

---

## Blockers — stop and alert the user if you encounter

- Need to create migration or alter schema without warning
- Need to touch a file outside the declared scope
- Pre-existing critical bug blocking the task
- Any operation against production environment
- Conflict with parallel branch (don't resolve alone)

---

## Execution log

> Filled during execution by the session running the task. Leave a trace of the reasoning, not just the commits.

- **Phase 1 (red):** {{what was written + commit hash}}
- **Phase 2 (green):** {{implementation summary + commit hash}}
- **Phase 3 (refactor):** {{what changed or "not applicable"}}
- **Phase 4 (verification):** {{lint/test/type check results}}

### Incidents / deviations

{{Anything non-obvious that came up during execution. Examples: mock that broke legacy tests and required a proxy; race condition that only appeared with local DB running; pre-existing bug that needed a workaround. This block is the memory of "why it's like this".}}

---

## State on pause

> When the session needs to stop mid-task, fill this for the next session to resume.

- **Done:** {{summary}}
- **In progress:** {{summary}}
- **Exact next step:** {{file to open or command to run}}
- **Tests:** {{current count: X passing, Y pending}}

---

## Notes for review session

- **Trade-offs taken:** {{decision X vs Y and why}}
- **Deferred to other tasks:** {{what was deferred and where it's recorded}}
- **Known risks:** {{what might go wrong after merge}}
