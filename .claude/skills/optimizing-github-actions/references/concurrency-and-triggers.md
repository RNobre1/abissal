# Concurrency, triggers, and path filters

Reference consumed by the `optimizing-github-actions` skill when the topic is workflow execution control.

## Concurrency groups

`concurrency` groups runs under the same key; configuration decides whether to cancel in-progress or enqueue.

### Canonical pattern

| Workflow | `group` | `cancel-in-progress` | Reason |
|----------|---------|----------------------|--------|
| CI on PR | `${{ github.workflow }}-${{ github.ref }}` | `true` | Push to PR cancels previous run — savings + faster feedback |
| CI on push to main | `${{ github.workflow }}-${{ github.ref }}` | `false` | Deploy gate — never cancel |
| Deploy | `deploy-${{ github.ref }}` | `false` | NEVER cancel rollout in progress |
| Hybrid (PR + push) | `${{ github.workflow }}-${{ github.ref }}` | `${{ github.event_name == 'pull_request' }}` | PR cancels, push doesn't |

### Syntax

```yaml
# CI on PR (typical default)
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

# Deploy (NEVER cancel)
concurrency:
  group: deploy-${{ github.ref }}
  cancel-in-progress: false
```

### Why deploy never cancels

Cancelling a deploy in progress can leave prod in an inconsistent state:
- Migration partially applied (some tables migrated, others not).
- Backend deployed to v2 while frontend still expects v1.
- Build artifact uploaded to CDN but DNS not pointing yet.

`cancel-in-progress: false` enqueues — next push waits for current deploy to finish.

### Concurrency with `wait-on-check-action`

A common pattern: a `deploy.yml` waits for a consolidator check (e.g., `Unit + Component Tests (merge)`) via `lewagon/wait-on-check-action` (SHA-pinned of course). If the check comes back `skipped` (because some shard failed and the merge job was skipped), the `wait-on` correctly fails — gate works.

```yaml
- name: Wait for CI to pass
  uses: lewagon/wait-on-check-action@<SHA-PIN> # vN.N.N
  with:
    ref: ${{ github.sha }}
    check-name: 'Unit + Component Tests (merge)'   # Consolidator job, NOT individual shard
    repo-token: ${{ secrets.GITHUB_TOKEN }}
    wait-interval: 10
```

## Triggers — what to avoid

### Anti-pattern 1: duplicate trigger on the same SHA

```yaml
# ❌ CI runs 2x on the same SHA when feature PR → dev merges
on:
  pull_request:
    branches: [main, dev]
  push:
    branches: [main, dev]
```

Feature PR to dev merges: (1) PR already ran CI; (2) merge generates new `push` event on dev — CI runs **again** on the same code. Doubled cost.

```yaml
# ✅ CI runs only on PR; push only on main (deploy gate + direct hotfix)
on:
  pull_request:
    branches: [main, dev]
  push:
    branches: [main]
```

`push: branches: [main]` kept to:
1. Serve as gate for `deploy.yml` (deploy waits for CI to pass on push to main).
2. Cover direct hotfix to main without PR (rare but possible).

### Anti-pattern 2: expensive workflow without path filter

```yaml
# ❌ Expensive workflow (LLM, heavy build) runs on EVERY PR
on:
  pull_request:
```

```yaml
# ✅ Only runs when relevant files change
on:
  pull_request:
    paths:
      - 'src/lib/relevant/**'
      - 'tests/eval/**'
      - '.github/workflows/expensive.yml'
  workflow_dispatch:    # Manual trigger for re-run
```

### Anti-pattern 3: expensive workflow on push (pays 2x)

```yaml
# ❌ Workflow runs on PR to dev + push to dev = 2x same SHA = 2x cost
on:
  pull_request:
    branches: [dev]
    paths: ['src/lib/expensive/**']
  push:
    branches: [dev]
    paths: ['src/lib/expensive/**']
```

```yaml
# ✅ PR-only. workflow_dispatch covers ad-hoc re-runs.
on:
  pull_request:
    branches: [dev]
    paths: ['src/lib/expensive/**']
  schedule:
    - cron: '0 6 * * 0'   # Weekly to detect external drift
  workflow_dispatch:
```

## Path filters — native vs `dorny/paths-filter`

### Native: `paths` / `paths-ignore` on trigger

```yaml
on:
  push:
    paths:
      - 'src/**'
      - '!src/**/*.md'   # Exclude
  pull_request:
    paths-ignore:
      - 'docs/**'
      - '*.md'
```

**Skips the entire workflow** if nothing relevant changed.

### Action `dorny/paths-filter` (or `step-security/paths-filter`)

```yaml
on:
  pull_request:

jobs:
  changes:
    runs-on: ubuntu-latest
    outputs:
      frontend: ${{ steps.filter.outputs.frontend }}
      backend: ${{ steps.filter.outputs.backend }}
    steps:
      - uses: dorny/paths-filter@v3
        id: filter
        with:
          filters: |
            frontend:
              - 'src/**'
              - 'package.json'
            backend:
              - 'server/**'
              - 'api/**'

  test-frontend:
    needs: changes
    if: needs.changes.outputs.frontend == 'true'
    runs-on: ubuntu-latest
    steps:
      - run: npm test

  test-backend:
    needs: changes
    if: needs.changes.outputs.backend == 'true'
    runs-on: ubuntu-latest
    steps:
      - run: npm run test:integration
```

**Workflow always runs**; specific jobs skip conditionally.

### Decision matrix

| Case | Use | Reason |
|------|-----|--------|
| Whole workflow skips if nothing relevant changed | Native `paths` | Simpler |
| Required status check on PR + workflow sometimes skips | AVOID native `paths` | Native = `skipped` check = blocks required status check |
| Specific jobs run conditionally, others always | `dorny/paths-filter` or `step-security/paths-filter` | Job-level with boolean flags |
| Post-tj-actions hardening | `step-security/paths-filter` | Hardened drop-in maintained by StepSecurity |

### Critical caveat of native `paths`

If the workflow is listed as **required status check** in branch protection, and the workflow skips via `paths`, the check stays `skipped` → blocks the merge until someone runs it manually.

Solution: use `dorny/paths-filter` (workflow always runs + internal jobs skip) OR create an "always-pass" auxiliary workflow that serves as status check.

## Schedule triggers (cron)

```yaml
on:
  schedule:
    - cron: '0 6 * * 0'       # Sunday 6h UTC
    - cron: '*/30 * * * *'    # Every 30min
```

Be careful: schedules can run on any historical commit. To run only on main:

```yaml
jobs:
  scheduled-task:
    if: github.ref == 'refs/heads/main' || github.event_name != 'schedule'
    runs-on: ubuntu-latest
```

GitHub Actions schedules are **best-effort** — can be delayed by tens of minutes during peak time. Don't rely on exact timing.

### Schedule on public repo forks

Public forks inherit workflows including schedules → can cause unwanted runs on forks. GitHub auto-disables schedules on forks, but you can accidentally re-enable them.

## Workflow-dispatch (manual trigger)

```yaml
on:
  workflow_dispatch:
    inputs:
      mode:
        type: choice
        options: [eval, smoke, full]
        default: smoke
      verbose:
        type: boolean
        default: false
```

Useful for:
- Re-running expensive workflow without needing a push.
- Varying inputs (running with different mode, different dataset).
- Manually running on experimental branch.

## External references

- Official concurrency: https://docs.github.com/en/actions/using-jobs/using-concurrency
- PR vs deploy pattern: https://generalreasoning.com/blog/2025/02/05/github-actions-concurrency.html
- `dorny/paths-filter`: https://github.com/dorny/paths-filter
- `step-security/paths-filter` (hardened drop-in): https://github.com/step-security/paths-filter
- Available events: https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows
