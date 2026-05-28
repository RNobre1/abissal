# {{Feature}} — Terminal Prompts

> Self-contained prompts for parallel execution in multiple terminals or worktrees. Each prompt should be copy-pasteable into a fresh Claude Code session.

---

## Terminal 1 — T1: {{Task name}}

```
Read the file docs/tasks/{{feature-slug}}/T1-{{name}}.md and execute the task described.

Branch: feat/{{feature-slug}}-T1 (create from main).

Required context:
- docs/tasks/{{feature-slug}}/00-overview.md (the feature's overall plan)
- CLAUDE.md (project conventions)

Methodology: TDD absolute, pair programming, conventional commits, ask before assuming.

Scope limits:
- Only touch files listed in the T-file under "Files ALLOWED to touch"
- NEVER touch files listed under "Files FORBIDDEN"
- Read-only operations don't need approval (git status, ls, cat, grep)
- State-changing operations (create/delete files, git push, commit) need explicit OK

When done: open PR to main. Do not self-merge.
```

---

## Terminal 2 — T2: {{Task name}}

```
{{Same structure, substituting T1 for T2 and the respective files}}
```

---

## Coordination rules

- Each terminal uses its own branch: `feat/{{feature-slug}}-T{N}`
- Do not rebase across parallel branches mid-flight
- If a task depends on another (per the overview table), wait for the dependency PR to merge before starting
- PROGRESS.md is updated on merge, not during development (avoids conflicts)
