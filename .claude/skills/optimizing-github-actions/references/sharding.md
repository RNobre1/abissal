# Matrix sharding in GitHub Actions: Vitest + Playwright

Reference consumed by the `optimizing-github-actions` skill when the topic is test sharding.

## Basic concept

Sharding = splitting the test suite into N parts that run in parallel. Reduces wall-clock time linearly (up to a point).

GitHub Actions implements this via `strategy.matrix`:

```yaml
strategy:
  fail-fast: false   # Don't cancel other shards if one fails — you want to see EVERYTHING that breaks
  matrix:
    shard: [1, 2, 3]   # 3 shards
```

Each shard runs as a separate job. Reporter can be:
1. **Independent per shard** — each shard uploads its own report (HTML, JSON), no merge. Simpler.
2. **Blob reporter + merge job** — each shard uploads `blob.json`, a consolidator job merges into a single HTML report. Required if you want one unified HTML for debugging.

## Vitest sharding

### IMPORTANT: minimum version is v2.0.0

Blob reporter was introduced in **Vitest v2.0.0** (release 8 Jul 2024, via PR #5663). Does NOT exist in v1.x.

Projects on Vitest 1.x need to upgrade first. Without upgrade, the only way to shard is using JSON reporter and merging manually — caveats with coverage and snapshot tracking.

### Canonical syntax

```yaml
jobs:
  unit-shard:
    strategy:
      fail-fast: false
      matrix:
        shard: [1, 2, 3]
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - name: Run shard ${{ matrix.shard }}/3
        run: |
          npx vitest run \
            --reporter=blob \
            --coverage \
            --shard=${{ matrix.shard }}/3
        env:
          # Coverage threshold does NOT work correctly on individual shards
          # (each shard sees partial coverage). Skip threshold here; apply only on merge.
          COVERAGE_SKIP_THRESHOLDS: 1
      - name: Upload blob report
        uses: actions/upload-artifact@v4
        with:
          name: vitest-blob-${{ matrix.shard }}    # Unique name required in v4
          path: .vitest-reports/blob-*.json
          retention-days: 1

  unit-merge:
    needs: unit-shard
    if: ${{ !cancelled() }}   # Run even if some shard failed — want to see merged report
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - name: Download all blobs
        uses: actions/download-artifact@v4
        with:
          path: .vitest-reports
          pattern: vitest-blob-*
          merge-multiple: true   # v4 doesn't merge automatically
      - name: Merge reports
        run: npx vitest --merge-reports --coverage --reporter=default
        # Real coverage threshold applied HERE (not on shards)
```

### How Vitest splits

Vitest splits **test files**, not test cases. If there are 1000 files and `--shard=1/4`, runs ~250 files regardless of how many test cases each one has. Distribution is not necessarily uniform in duration — files with more test cases take longer.

### Coverage in shards (subtle but critical)

Each shard sees only its own files. Global threshold (e.g., `lines: 80`) calculated on partial shard = false negative. Official solution:

1. Set `COVERAGE_SKIP_THRESHOLDS=1` on shards (env var).
2. Each shard uploads blob with partial coverage.
3. Merge job joins everything + applies real threshold.

Without this, threshold of 80% may pass shard 1 (90% local) and fail shard 2 (70% local) without reflecting the project's real coverage.

## Playwright sharding

### Basic syntax (no blob, each shard independent)

```yaml
jobs:
  e2e-shard:
    strategy:
      fail-fast: false
      matrix:
        shard: [1, 2]
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps
      - name: Run shard ${{ matrix.shard }}/2
        run: npx playwright test --shard=${{ matrix.shard }}/2
      - name: Upload report (shard ${{ matrix.shard }})
        if: failure()   # Only upload on failure
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report-shard-${{ matrix.shard }}
          path: playwright-report/
          retention-days: 7
```

Each shard has its own separate HTML report on failure. No merge job. **This is the simpler valid configuration** — official Playwright docs confirm `--shard=N/M` works with any reporter.

### Syntax with blob + merge (unified HTML)

```yaml
# playwright.config.ts
import { defineConfig } from '@playwright/test';
export default defineConfig({
  reporter: process.env.CI ? 'blob' : 'html',
});
```

```yaml
# .github/workflows/e2e.yml
jobs:
  e2e-shard:
    strategy:
      fail-fast: false
      matrix:
        shard: [1, 2, 3]
    steps:
      # ... setup ...
      - run: npx playwright test --shard=${{ matrix.shard }}/3
      - uses: actions/upload-artifact@v4
        with:
          name: blob-report-${{ matrix.shard }}
          path: blob-report
          retention-days: 1

  e2e-merge:
    needs: e2e-shard
    if: ${{ !cancelled() }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v4
        with:
          cache: npm
      - run: npm ci
      - uses: actions/download-artifact@v4
        with:
          path: all-blob-reports
          pattern: blob-report-*
          merge-multiple: true
      - run: npx playwright merge-reports --reporter html ./all-blob-reports
      - uses: actions/upload-artifact@v4
        with:
          name: playwright-report-merged
          path: playwright-report
          retention-days: 7
```

### When to use blob vs no blob

| Situation | Recommendation |
|-----------|----------------|
| Small team, few shards (2-3), separate HTML per shard is acceptable | No blob (simpler) |
| Large team, many shards (3+), debug requires seeing EVERYTHING in ONE HTML | Blob + merge |
| Extremely fast CI (each shard <2min) | No blob (merge overhead doesn't pay) |
| Long CI (each shard >5min) with frequent debug | Blob + merge (overhead amortized) |

Official docs confirm: **`--shard=N/M` works with any reporter**. Blob is only required to merge.

## Sweet spot for number of shards

Diminishing return after 3 shards for small-medium projects:

| Shards | Ideal speedup | Real speedup (with setup overhead) |
|--------|---------------|------------------------------------|
| 1 | 1x | 1x |
| 2 | 2x | ~1.7x |
| 3 | 3x | ~2.3x |
| 4 | 4x | ~2.6x (small gain) |
| 5+ | 5x+ | plateau (overhead dominates) |

Typical overhead per shard: ~30-60s (setup runner + checkout + setup-node + npm ci [if not cached] + test runner setup). 4-way already spends ~3-4min just on overhead vs ~5-10min of real speedup.

**Simple rule**: don't add a shard if the expected speedup (5min total / N shards) is less than ~2x the overhead (60s × N).

## fail-fast: true vs false

```yaml
strategy:
  fail-fast: false   # ✅ Correct — want to see ALL broken shards
  matrix:
    shard: [1, 2, 3]
```

`fail-fast: true` (default) cancels all shards if one fails. Useful to save minutes in CI when "if one broke, all will break". But in test sharding, you want to see **all** errors to fix at once.

`fail-fast: false` in sharding is almost always right.

## Anti-pattern: matrix without real parallelism

```yaml
# ❌ Anti-pattern — all shards run against the SAME remote DB/service
strategy:
  matrix:
    shard: [1, 2, 3]
steps:
  - run: npm test -- --shard=${{ matrix.shard }}/3
    env:
      DATABASE_URL: postgres://shared-staging.example.com/test
```

All shards compete for the same DB → fixture conflicts, locks, deadlocks. Result: they run almost serially + flaky failures.

**Correct**: each shard brings up its own isolated DB (Docker isolated per job):

```yaml
strategy:
  fail-fast: false
  matrix:
    shard: [1, 2, 3]
steps:
  - run: docker compose up -d db        # Local isolated DB per job
  - run: npm test -- --shard=${{ matrix.shard }}/3
```

## External references

- Vitest reporters (blob + shard): https://vitest.dev/guide/reporters
- Vitest improving performance (sharding): https://vitest.dev/guide/improving-performance
- Vitest v2.0.0 release notes: https://github.com/vitest-dev/vitest/releases/tag/v2.0.0
- Playwright sharding: https://playwright.dev/docs/test-sharding
- Playwright sharding source: https://github.com/microsoft/playwright/blob/main/docs/src/test-sharding-js.md
