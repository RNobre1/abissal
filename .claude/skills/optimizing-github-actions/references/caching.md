# Cache layering in GitHub Actions

Reference consumed by the `optimizing-github-actions` skill when the topic is dependency/build cache.

## Three valid layers in 2025-2026

### Layer 1: `actions/cache@v4` directly

Cache for arbitrary paths. Most flexible + greatest control over key/restore-keys.

```yaml
- uses: actions/cache@v4
  id: cache-node-modules
  with:
    path: node_modules
    key: ${{ runner.os }}-node-${{ hashFiles('package-lock.json') }}
    restore-keys: |
      ${{ runner.os }}-node-
```

`restore-keys` defines fallback hierarchy: if exact key doesn't match, try the first `restore-keys`, then the second, etc. Useful for partial hits when the lockfile changed slightly.

### Layer 2: built-in cache in `setup-node@v4`

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 20
    cache: npm                # Caches ~/.npm (NOT node_modules)
    cache-dependency-path: package-lock.json
```

**Important**: `cache: npm` caches `~/.npm` (download cache), NOT `node_modules`. You still pay `npm ci` (resolve + symlinks + postinstall) on each job. Faster than no cache, but slower than `actions/cache` on `node_modules`.

### Layer 3: combine (setup job + parallel jobs restore)

Recommended pattern for projects with multiple parallel jobs:

```yaml
jobs:
  setup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - uses: actions/cache@v4
        id: cache
        with:
          path: node_modules
          key: ${{ runner.os }}-node-${{ hashFiles('package-lock.json') }}
      - if: steps.cache.outputs.cache-hit != 'true'
        run: npm ci

  lint:
    needs: setup
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - uses: actions/cache@v4
        with:
          path: node_modules
          key: ${{ runner.os }}-node-${{ hashFiles('package-lock.json') }}
          fail-on-cache-miss: true   # If miss, fail — node_modules already set up in `setup`
      - run: npm run lint

  # test, typecheck, etc — same pattern
```

`fail-on-cache-miss: true` ensures `setup` already ran (if it failed, parallel jobs fail fast).

## Decision matrix

| Case | Layer | Reason |
|------|-------|--------|
| Cache `node_modules` (with heavy symlinks/postinstall) | 1 (`actions/cache`) | Skips `npm ci` in parallel jobs |
| Cache only `~/.npm` (skips download but runs `npm ci`) | 2 (`setup-node` native cache) | Official default, simple |
| Cache Playwright browsers (~250MB) | 1 in `~/.cache/ms-playwright` | `setup-node` doesn't cover |
| Cache build outputs (`dist/`) between jobs | 1 in build path | Same |
| Cache heavy Docker image (>500MB) | **DON'T cache** if hit rate < 50% | Documented anti-pattern — measure empirically |

## Anti-patterns

### 1. Cache of large binary payload in parallel jobs (write contention)

**Documented anti-pattern**: caching multiple-hundred-MB binary tarballs (e.g., `docker save`) under the same key from multiple jobs running in parallel. Symptoms include tarball corruption (e.g., "Wrote only X of Y bytes") and cache misses despite seemingly correct keys, while still paying the heavy save/restore cost on every run.

**Generalization**: caching large binary payload (>500MB) in multiple parallel jobs under the same `key` requires empirical measurement. Before keeping cache, validate:
1. Cache hit rate > 50% (measure over 5-10 runs).
2. Restore cost < cost of regenerating from scratch.

If either fails, the cache is net negative. Remove it.

**Safe alternative for caching Docker images**: have a SINGLE setup job build + save the image, then have parallel jobs only RESTORE (read-only). Read-only restore in parallel does not have the race condition that write-parallel does:

```yaml
# In setup job (writes once):
- name: Build + save Docker image
  if: steps.docker-cache.outputs.cache-hit != 'true'
  run: |
    docker build -t myapp/runner:v1 docker/
    docker save myapp/runner:v1 -o /tmp/runner-image.tar

# In parallel shards (read-only restore):
- name: Restore Docker image cache
  uses: actions/cache@v4
  with:
    path: /tmp/runner-image.tar
    key: ${{ needs.setup.outputs.docker-cache-key }}
    fail-on-cache-miss: true
- name: Load Docker image
  run: docker load -i /tmp/runner-image.tar
```

### 2. `key` without enough entropy

```yaml
# ❌ Same key on different PRs — cache collides
- uses: actions/cache@v4
  with:
    path: node_modules
    key: node_modules

# ✅ Key derived from lockfile
- uses: actions/cache@v4
  with:
    path: node_modules
    key: ${{ runner.os }}-node-${{ hashFiles('package-lock.json') }}
```

### 3. `restore-keys` without hierarchical fallback

```yaml
# ❌ No restore-keys — cache miss = npm ci from scratch
- uses: actions/cache@v4
  with:
    path: node_modules
    key: ${{ runner.os }}-node-${{ hashFiles('package-lock.json') }}

# ✅ Fallback hierarchy — if lockfile changed slightly, partial hit is worth it
- uses: actions/cache@v4
  with:
    path: node_modules
    key: ${{ runner.os }}-node-${{ hashFiles('package-lock.json') }}
    restore-keys: |
      ${{ runner.os }}-node-
```

### 4. Caching files that change every run

```yaml
# ❌ Caching coverage report (changes every run)
- uses: actions/cache@v4
  with:
    path: coverage/
    key: coverage-${{ github.sha }}   # Unique SHA = guaranteed cache miss
```

If it changes every run, don't cache it. Use `actions/upload-artifact` if you need to pass between jobs.

## Cross-OS cache

Be careful: `actions/cache` by default restores cache from the same OS. Cache created on `ubuntu-22.04` doesn't restore on `ubuntu-24.04` (different runners). Hence `${{ runner.os }}` in the key.

To force cross-OS (rarely the case): `enableCrossOsArchive: true` (Windows-Linux experimental compat).

## Storage cost

GitHub Actions cache has a limit of **10GB per repo**. Above that, less recent items are evicted (LRU). In practice:
- Small repos: don't worry.
- Large repos (multiple OS, several toolchains, browsers, etc.): monitor via `gh api repos/{owner}/{repo}/actions/cache/usage`.
- Clean old cache via `gh cache delete` or GitHub UI.

## External references

- `actions/cache@v4` README: https://github.com/actions/cache
- Official caching doc: https://docs.github.com/en/actions/using-workflows/caching-dependencies-to-speed-up-workflows
- `setup-node` cache: https://github.com/actions/setup-node#caching-global-packages-data
