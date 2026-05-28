# `actions/upload-artifact@v4` and `actions/download-artifact@v4`

Reference consumed by the `optimizing-github-actions` skill when the topic is artifact passing between jobs.

## Breaking changes vs v3 (deployed December 2023, deprecated April 2024)

GitHub deprecated v3 of artifact actions on April 16, 2024. v3 was fully disabled on June 30, 2024. **Workflows still using v3 have been failing since June 2024**.

Essential changes that broke existing code:

### 1. Artifacts are IMMUTABLE

```yaml
# v3 (legacy) — worked: append to existing artifact
- uses: actions/upload-artifact@v3
  with:
    name: test-results
    path: shard-1/

- uses: actions/upload-artifact@v3
  with:
    name: test-results   # Same name — v3 merged automatically
    path: shard-2/

# v4 — ERROR: "Conflict: an artifact with this name already exists"
- uses: actions/upload-artifact@v4
  with:
    name: test-results
    path: shard-1/

- uses: actions/upload-artifact@v4
  with:
    name: test-results   # ❌ Fails here
    path: shard-2/
```

### 2. Names must be UNIQUE per job

In matrix with sharding, include `${{ matrix.shard }}` in the name:

```yaml
strategy:
  matrix:
    shard: [1, 2, 3]
steps:
  - run: npx vitest --shard=${{ matrix.shard }}/3 --reporter=blob
  - uses: actions/upload-artifact@v4
    with:
      name: vitest-blob-${{ matrix.shard }}   # ✅ Unique per shard
      path: .vitest-reports/
```

### 3. No automatic merge on download

v3 downloaded all artifacts with the same name and merged. v4 treats each artifact as a separate entity. To aggregate:

**Option A: pattern + merge-multiple on download**
```yaml
- uses: actions/download-artifact@v4
  with:
    path: .vitest-reports
    pattern: vitest-blob-*
    merge-multiple: true   # ✅ Joins all matches into a single directory
```

**Option B: `actions/upload-artifact/merge` sub-action**
```yaml
- uses: actions/upload-artifact/merge@v4
  with:
    name: vitest-blobs-merged
    pattern: vitest-blob-*
    delete-merged: true    # Removes individual artifacts after merge
```

### 4. Default compression changed

v3: no compression (raw upload).
v4: zstd compression (fast + economical).

For projects with small binaries, compression adds 1-3s but saves ~30-50% storage. For already-compressed binaries (zip, tarball, video), you can set `compression-level: 0` to disable.

### 5. Higher throughput, faster retention

v4 is ~10x faster on uploads and downloads (zstd + internal parallelism). But has a hard limit of **500 artifacts per job** (v3 had no explicit limit).

## Canonical pattern: matrix + merge

```yaml
jobs:
  test-shard:
    strategy:
      fail-fast: false
      matrix:
        shard: [1, 2, 3]
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v4
      - run: npm ci
      - name: Test shard ${{ matrix.shard }}/3
        run: npx vitest --reporter=blob --shard=${{ matrix.shard }}/3
      - name: Upload blob (shard ${{ matrix.shard }})
        uses: actions/upload-artifact@v4
        with:
          name: test-blob-${{ matrix.shard }}    # Unique name
          path: .vitest-reports/blob-*.json
          retention-days: 1                      # Short — only for merge

  test-merge:
    needs: test-shard
    if: ${{ !cancelled() }}                    # Run even if a shard failed
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v4
      - run: npm ci
      - name: Download all shards
        uses: actions/download-artifact@v4
        with:
          path: .vitest-reports
          pattern: test-blob-*
          merge-multiple: true                  # Joins all into one dir
      - name: Merge reports
        run: npx vitest --merge-reports
      - name: Upload final report
        uses: actions/upload-artifact@v4
        with:
          name: test-results-merged
          path: test-results.json
          retention-days: 30
```

## Anti-patterns

### Generic name without suffix

```yaml
# ❌ Fails in matrix
- uses: actions/upload-artifact@v4
  with:
    name: test-results
```

### Reusing `name` between jobs

```yaml
# ❌ Job A
- uses: actions/upload-artifact@v4
  with:
    name: build-output

# ❌ Job B (in another workflow or another job of the same workflow)
- uses: actions/upload-artifact@v4
  with:
    name: build-output   # Fails — already exists in run
```

### Forgetting `if: failure()` on debug artifacts

```yaml
# ❌ Uploads heavy artifact on EVERY run, even passing
- uses: actions/upload-artifact@v4
  with:
    name: playwright-traces
    path: test-results/
    
# ✅ Only uploads when there's a failure to debug
- uses: actions/upload-artifact@v4
  if: failure()
  with:
    name: playwright-traces
    path: test-results/
```

## Migration from v3 to v4

1. Bump version in all `actions/upload-artifact@v3` → `@v4` and `actions/download-artifact@v3` → `@v4`.
2. For each upload in matrix, ensure unique name (include `${{ matrix.shard }}` or similar).
3. For each download that depended on automatic merge, migrate to `pattern: ...` + `merge-multiple: true`.
4. Check if any step uses `actions/upload-artifact/merge` (only exists in v4) — can simplify legacy manual merge code.
5. If any job uploads many artifacts (>500), review — possibly consolidate before upload.

## External references

- Official v4 README: https://github.com/actions/upload-artifact
- Issue documenting breaking change: https://github.com/actions/upload-artifact/issues/493
- Official v3 deprecation changelog: https://github.blog/changelog/2024-04-16-deprecation-notice-v3-of-the-artifact-actions/
- Official migration guide: https://github.com/actions/upload-artifact/blob/main/docs/MIGRATION.md
