# Reusable workflows vs composite actions

Reference consumed by the `optimizing-github-actions` skill when the topic is DRY/logic reuse between workflows.

## Four "action" types in GitHub Actions

| Type | What it is | Where it lives |
|------|------------|----------------|
| **JavaScript action** | JS code run on the runner | Separate repo, `action.yml` + `index.js` |
| **Docker action** | Docker image run on the runner | Separate repo, `action.yml` + `Dockerfile` |
| **Composite action** | Sequence of reusable steps | Separate repo OR `.github/actions/<name>/action.yml` in current repo |
| **Reusable workflow** | Entire reusable workflow | `.github/workflows/<name>.yml` in current repo with `on: workflow_call` |

JS and Docker actions are out of scope for this reference (used when you need complex logic that deserves code, not YAML). This reference focuses on composite actions vs reusable workflows.

## Decision matrix

| Case | Use | Reason |
|------|-----|--------|
| Reuse across **multiple jobs** with possibly different runners | Reusable workflow | Defines complete jobs with their own runners |
| Reuse of steps **inside 1 job** (e.g., setup-node + cache + npm ci) | Composite action | Lighter, no new runner |
| Steps need inherited `secrets:` | Reusable workflow | Supports `secrets: inherit` |
| Steps need complex `outputs` (objects) | Reusable workflow | More expressive `outputs` |
| Granular logging per step | Reusable workflow | Composite is logged as ONE step |
| Deep nesting (up to 10 levels) | Composite action | Reusable can't call another reusable |
| Reuse across org repos | Reusable workflow OR public composite action | Both supported |

## Composite action — example

`.github/actions/setup-node-and-deps/action.yml`:

```yaml
name: 'Setup Node + Deps'
description: 'Setup Node 20 + restore node_modules cache + npm ci on cache miss'
inputs:
  node-version:
    description: 'Node version'
    default: '20'
runs:
  using: composite
  steps:
    - uses: actions/setup-node@v4
      with:
        node-version: ${{ inputs.node-version }}
    
    - uses: actions/cache@v4
      id: cache
      with:
        path: node_modules
        key: ${{ runner.os }}-node-${{ inputs.node-version }}-${{ hashFiles('package-lock.json') }}
    
    - if: steps.cache.outputs.cache-hit != 'true'
      shell: bash
      run: npm ci
```

Use in workflow:

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: ./.github/actions/setup-node-and-deps
        with:
          node-version: '20'
      - run: npm test
```

**Advantages**:
- Encapsulates 3-4 steps into one "function".
- Lives in the same repo (no separate versioning).
- No new runner spawn (same machine).

**Limitations**:
- Logged as ONE step in the UI (loses granularity).
- No native `secrets:` — you have to pass as `inputs` (caution: inputs appear in logs!).
- `if:` at the level of an internal step in composite has subtle behavior — always test.

## Reusable workflow — example

`.github/workflows/test-suite.yml`:

```yaml
name: Test Suite (reusable)

on:
  workflow_call:
    inputs:
      node-version:
        type: string
        default: '20'
      test-command:
        type: string
        required: true
    secrets:
      API_KEY:
        required: false
    outputs:
      coverage:
        description: 'Coverage percentage'
        value: ${{ jobs.test.outputs.coverage }}

jobs:
  test:
    runs-on: ubuntu-latest
    outputs:
      coverage: ${{ steps.coverage.outputs.value }}
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ inputs.node-version }}
      - run: npm ci
      - run: ${{ inputs.test-command }}
        env:
          API_KEY: ${{ secrets.API_KEY }}
      - id: coverage
        run: echo "value=$(jq '.total.lines.pct' coverage/coverage-summary.json)" >> $GITHUB_OUTPUT
```

Use in another workflow:

```yaml
jobs:
  unit-tests:
    uses: ./.github/workflows/test-suite.yml
    with:
      test-command: npm run test:unit
    secrets:
      API_KEY: ${{ secrets.API_KEY }}

  integration-tests:
    uses: ./.github/workflows/test-suite.yml
    with:
      test-command: npm run test:integration
    secrets: inherit   # Total inheritance — careful
```

**Advantages**:
- Entire workflow encapsulated (jobs + runners + steps + outputs).
- Supports native `secrets:` with `inherit`.
- Logged with full granularity (each step appears individually).
- Expressive outputs (pass to parent workflows).

**Limitations**:
- New runner for each call (overhead ~30-60s setup).
- Cannot call another reusable workflow (no nesting).
- `secrets: inherit` grants total inheritance — watch the scope.

## `secrets: inherit` — when it's dangerous

```yaml
# Workflow A calls workflow B (reusable):
jobs:
  call-b:
    uses: my-org/shared-actions/.github/workflows/deploy.yml@main
    secrets: inherit   # ❌ If shared-actions/deploy.yml is malicious, gets EVERYTHING
```

`inherit` passes ALL secrets from workflow A to B. If B is a third-party repo (or your reusable workflow but with third-party code), big risk.

**Solution**: pass explicit secrets:

```yaml
jobs:
  call-b:
    uses: my-org/shared-actions/.github/workflows/deploy.yml@main
    secrets:
      AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
      AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
      # API_KEY NOT passed — B doesn't need it
```

## When NOT to use either

If the logic is used in ONE place only, it's not DRY yet. Premature abstraction costs more than the copy-paste did.

YAGNI applies: extract to reusable/composite when you already have 3+ workflows doing the same thing, not on the second.

## Advanced patterns

### Reusable workflow + matrix

```yaml
jobs:
  test-matrix:
    strategy:
      matrix:
        node: [18, 20, 22]
    uses: ./.github/workflows/test-suite.yml
    with:
      node-version: ${{ matrix.node }}
      test-command: npm test
```

### Composite action with outputs

```yaml
runs:
  using: composite
  steps:
    - id: detect-changes
      shell: bash
      run: |
        if git diff --name-only HEAD~1 | grep -q '^src/'; then
          echo "frontend=true" >> $GITHUB_OUTPUT
        fi

outputs:
  frontend:
    description: 'True if frontend changed'
    value: ${{ steps.detect-changes.outputs.frontend }}
```

### Composite calling other composites (10-level limit)

Composites can be nested — useful to assemble layers (`base-setup` → `node-setup` → `node-with-cache`). Be careful with debugging: deep nesting hinders tracing.

## External references

- Official reusing workflows doc: https://docs.github.com/en/actions/sharing-automations/reusing-workflows
- Official composite actions doc: https://docs.github.com/en/actions/sharing-automations/creating-actions/creating-a-composite-action
- Composite vs reusable comparison: https://docs.github.com/en/actions/sharing-automations/avoiding-duplication
- Custom actions overview: https://docs.github.com/en/actions/sharing-automations/creating-actions/about-custom-actions
