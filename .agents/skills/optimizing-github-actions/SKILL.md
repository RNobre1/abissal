---
name: optimizing-github-actions
description: Reviews and optimizes GitHub Actions workflows for performance (cache layering, matrix sharding with Vitest 2.x+/Playwright blob+merge), quality (gate separation, observability via STEP_SUMMARY), security (SHA pinning of third-party actions, OIDC instead of long-lived secrets, pull_request_target hardening, persist-credentials hardening), and avoids documented anti-patterns (parallel cache corruption, eval gates without baseline, duplicate CI runs on same SHA). Use when editing any file under .github/workflows/, when adding or removing CI jobs, when triaging slow CI, when reviewing third-party action updates, or when discussing supply chain security of GitHub Actions (SHA pinning, OIDC, third-party action updates).
paths: .github/workflows/**
allowed-tools: Read, Grep, Glob, Bash(gh workflow:*), Bash(gh run:*), Bash(git log:*), Bash(git show:*)
---

> **Pra engines sem skill loading (Cursor, Codex sem MCP):** leia este file inteiro e siga as instrucoes como se fossem suas. Voce nao precisa "invocar" — apenas obedeca. Cursor e Codex que tem `xp-stack` instalado via npm leem este SKILL.md em `.cursor/rules/` ou `.codex/skills/`.

Voce eh o Auditor de CI. Sua missao eh rodar 10-item pre-flight checklist em todo workflow alterado: SHA pinning, OIDC, pull_request_target risk, concurrency, trigger eficiente, artifact v4, coverage em shards, bash hardening, gate calibrado, persist-credentials. Bloqueie merge se algum item criticar falhar.

# Optimizing GitHub Actions Workflows

Prescriptive skill for any edit in `.github/workflows/*.yml`. Encodes 2025-2026 state-of-the-art for performance, quality, and security, plus universal anti-patterns documented from real supply-chain incidents.

## When to use

Auto-activated via the `paths: .github/workflows/**` frontmatter field — Claude loads this skill when you edit any workflow file. Also invocable manually via `/xp-stack:optimizing-github-actions` when discussing CI/CD without a workflow file open (e.g., SHA pinning, OIDC migration, runner cost analysis).

| Situation | Action | Sub-file to read |
|-----------|--------|------------------|
| Editing any `.github/workflows/*.yml` | Run the 10-item pre-flight checklist below | — |
| Adding a third-party action | Validate SHA pin + check recent supply-chain incidents | [`references/security.md`](references/security.md) |
| Adding/changing test sharding | Vitest blob or independent reporter — depends | [`references/sharding.md`](references/sharding.md) |
| Adding `actions/upload-artifact` or `download-artifact` | Validate unique names per job (v4 breaking) | [`references/artifacts-v4.md`](references/artifacts-v4.md) |
| Triaging slow CI | Measure baseline BEFORE proposing optimization | [`references/caching.md`](references/caching.md) + Iron Law |
| Touching expensive workflow (LLM, long build) | PR-only, no push trigger | Item 5b of checklist |
| Refactoring for reuse | Reusable workflow vs composite action | [`references/reuse-patterns.md`](references/reuse-patterns.md) |
| Configuring concurrency / triggers | PR cancel-in-progress true, deploy false | [`references/concurrency-and-triggers.md`](references/concurrency-and-triggers.md) |
| Adding pipeline dashboard | STEP_SUMMARY + sticky comment | [`references/observability.md`](references/observability.md) |

## The Iron Law

```
1. Before merging any change to .github/workflows/*.yml, run the 10-point pre-flight checklist below.
2. Before suggesting a "speed up CI" optimization, MEASURE BASELINE first via `gh run view --log` or the Actions UI. No guesses.
3. Before adding a third-party action, SHA-pin it. No exceptions for "trusted org".
```

Violating these three rules has caused real production incidents documented across the industry: Docker cache corruption costing 5min/job with no hit, duplicate CI runs on the same SHA wasting minutes, eval gates without baseline failing every PR.

## Pre-flight checklist (10 items — run on every workflow edit)

Copy this section when reviewing an edit. Each item has a one-line rationale + reference. Items without `OK` in your review = fix before proposing the PR.

1. **SHA pinning of third-party actions**. Does every third-party action (`uses: org/action@...`) use a 40-char full-length SHA + `# vN.N.N` comment? Official GitHub actions (`actions/*`) may use major version but should be marked `# OK: official`. **Reason:** tj-actions/changed-files (CVE-2025-30066, March 2025) — attacker rewrote 350+ tags to point at malicious commit, ~23k repos compromised. Git tags are mutable. → [`references/security.md`](references/security.md)

2. **OIDC for cloud auth**. Does the workflow authenticate to AWS/GCP/Azure? If yes, does it use `permissions: id-token: write` + `aws-actions/configure-aws-credentials` (or equivalent) instead of `${{ secrets.AWS_ACCESS_KEY_ID }}`? **Reason:** OIDC = ephemeral JWT, no duplicated credential, automatic rotation, granular control via trust policy. Long-lived secrets are only justifiable for services without OIDC support. → [`references/security.md`](references/security.md)

3. **`pull_request_target` hardening**. If the trigger is `pull_request_target`, does the workflow NOT check out the PR head (`ref: ${{ github.event.pull_request.head.sha }}`) without extreme sandboxing? **Reason:** classic RCE vector — `pull_request_target` runs with base repo secrets; checkout PR head + run code (npm install, build) = attacker via fork gets shell on runner with secrets. → [`references/security.md`](references/security.md)

4. **Concurrency**. Do PR workflows have `concurrency.group: ${{ github.workflow }}-${{ github.ref }}` + `cancel-in-progress: true`? Do deploy workflows have `cancel-in-progress: false`? **Reason:** PR cancels previous run (savings + faster feedback); deploy NEVER cancels in-progress (risk of inconsistent prod state). → [`references/concurrency-and-triggers.md`](references/concurrency-and-triggers.md)

5. **Trigger efficiency** (two sub-items — both):
   - **5a. Duplicate trigger on the SAME SHA**. Is the trigger `pull_request: [main, dev]` BUT NOT `push: [main, dev]`? Push to dev would run CI 2x when a feature PR → dev merges (PR already tested + push generates new event). Keep `push` only on `main` (covers direct hotfix + serves as deploy gate). **Reason:** universal duplication anti-pattern; same SHA paid twice in minutes and money.
   - **5b. Expensive workflow**. Does an LLM/heavy-Docker/long-build workflow run PR-only (no push trigger)? Cost ($, minutes) scales linearly with triggers; same SHA was already evaluated in the PR. **Reason:** evals/builds costing real $ should not run twice on the same code.

6. **Artifact naming (v4)**. Does each `actions/upload-artifact@v4` have a UNIQUE name (including `${{ matrix.shard }}` when applicable)? Does the consolidator job use `pattern: ...-*` + `merge-multiple: true` or the `merge` sub-action? **Reason:** v4 broke compat with v3 (Dec 2023): artifacts are immutable, unique names required, no automatic merge. → [`references/artifacts-v4.md`](references/artifacts-v4.md)

7. **Coverage threshold in sharded tests**. Is the coverage threshold NOT being applied on individual shards? Each shard sees partial coverage = false negative. Threshold only on the merge job (Vitest: `COVERAGE_SKIP_THRESHOLDS=1` on shards + `--merge-reports` + real threshold on merge). **Reason:** math — 1/3 of files = 1/3 of absolute coverage. → [`references/sharding.md`](references/sharding.md)

8. **Bash hardening**. Do long `run: |` scripts (>5 lines) start with `set -euo pipefail`? Do loops (`for ... in ...`) have explicit `set -e` or `|| exit` on critical commands? **Reason:** default GHA shell is `bash -eo pipefail` but `pipefail` doesn't work in all scenarios; silent failure inside a loop = one broken deploy doesn't stop the rest. → [`references/security.md`](references/security.md) (section "Bash hardening")

9. **Calibrated blocking gate**. Does any step that does `exit 1` on a numeric metric (eval, coverage, perf budget) have an empirical PoC confirming the metric DISCRIMINATES between baseline and experiment? If not, is it an informative gate (`echo "::warning::..." && exit 0`) with sticky comment? **Reason:** a hard threshold without empirical data fails healthy PRs and trains devs to bypass. Use informative mode until baseline is established. → [`references/observability.md`](references/observability.md)

10. **Checkout hardening**. Do `actions/checkout` calls in workflows that DON'T do a subsequent `git push` have `persist-credentials: false`? **Reason:** principle of least privilege. v6+ stores credentials in `$RUNNER_TEMP` (safer than `.git/config` of v3-v5), but if the step doesn't need to authenticate to Git remote, it shouldn't persist a credential at all. → [`references/security.md`](references/security.md)

## Decision matrices

### When to shard tests

| Suite | Typical volume | Recommended shards | Reporter | Merge job? |
|-------|----------------|--------------------|----------|------------|
| Vitest unit | <500 files | 1 (no shard) | default | no |
| Vitest unit | 500-2000 files | 2-3 | `blob` (v2.0.0+) | yes — `--merge-reports` |
| Vitest unit | >2000 files | 3-4 | `blob` | yes |
| Playwright e2e | <50 specs | 1 | default | no |
| Playwright e2e | 50-200 specs | 2-3 | any (blob if you want a single HTML) | optional |
| Playwright e2e | >200 specs | 3-4 | `blob` | yes — `merge-reports --reporter html` |

**Sweet spot:** 2-3 shards. 4+ has diminishing return (setup overhead × N vs speedup). Sharding without blob reporter is also valid — each shard uploads a separate artifact on failure.

### When to use OIDC vs long-lived secret

| Cloud / Service | OIDC support | Action |
|-----------------|--------------|--------|
| AWS | yes (official) | `permissions: id-token: write` + `aws-actions/configure-aws-credentials` |
| GCP | yes (official) | `google-github-actions/auth` with Workload Identity Federation |
| Azure | yes (official) | `azure/login` with `client-id` + `tenant-id` + `subscription-id` |
| HashiCorp Vault | yes (official) | `hashicorp/vault-action` with OIDC |
| GitHub Container Registry | yes (built-in) | `${{ secrets.GITHUB_TOKEN }}` is already ephemeral OIDC |
| SaaS without OIDC (most third-party APIs) | no | Long-lived API key in secret — no alternative |

For mandatory long-lived secrets, mark with explicit comment: `# OIDC not supported by <service>`.

### When to use `actions/cache@v4` vs `setup-node` native cache

| Case | Use | Reason |
|------|-----|--------|
| Cache `node_modules` (with heavy symlinks/postinstall) | `actions/cache@v4` on `node_modules` | Skips entire `npm ci` in parallel jobs |
| Cache only `~/.npm` (skips download but runs `npm ci`) | `cache: npm` in `setup-node@v4` | Official default, simple |
| Cache Playwright browsers | `actions/cache@v4` on `~/.cache/ms-playwright` | `setup-node` doesn't cover |
| Cache build outputs (dist/) | `actions/cache@v4` on build path | Same |
| Cache heavy Docker image (>500MB) | **DON'T cache** if hit rate < 50% | Documented anti-pattern (write contention + corruption in parallel) |

### When to use `dorny/paths-filter` vs native `paths`

| Case | Use | Reason |
|------|-----|--------|
| Whole workflow skips if nothing relevant changed | Native `paths`/`paths-ignore` on trigger | Simpler, native |
| Specific jobs run conditionally; others always run | `dorny/paths-filter` (or `step-security/paths-filter`) | Job-level with boolean flags |
| Required status check on PR + workflow sometimes skips | Avoid native `paths` (skip = `skipped` check = blocks merge) | Use `paths-filter` which always runs but skips internally |

Consider `step-security/paths-filter` as a hardened drop-in for `dorny/paths-filter` — aligned with post-tj-actions hardening.

### When to use reusable workflow vs composite action

| Case | Use | Reason |
|------|-----|--------|
| Reuse across **multiple jobs** with possibly different runners | Reusable workflow (`workflow_call`) | Defines complete jobs with runners |
| Reuse of steps **inside 1 job** (e.g., setup-node + cache + npm ci) | Composite action | Lighter, no new runner |
| Steps need inherited `secrets:` | Reusable workflow (supports `secrets: inherit`) | Composite has no native secrets mechanism |
| Granular logging per step | Reusable workflow | Composite is logged as ONE consolidated step |
| Deep nesting (up to 10 levels) | Composite action | Reusable can't call another reusable |

### When to `cancel-in-progress`

| Workflow | `group` | `cancel-in-progress` |
|----------|---------|----------------------|
| CI on PR | `${{ github.workflow }}-${{ github.ref }}` | `true` |
| CI on push to main | `${{ github.workflow }}-${{ github.ref }}` | `false` (deploy gate) |
| Deploy | `deploy-${{ github.ref }}` | `false` (NEVER cancel rollout) |
| Hybrid (PR + push) | `${{ github.workflow }}-${{ github.ref }}` | `${{ github.event_name == 'pull_request' }}` |
| Expensive post-merge workflows | `${{ github.workflow }}-${{ github.ref }}` | `true` (cancels rebuild on consecutive pushes) |

## Red flags (STOP — fix before proposing PR)

1. `uses: org/action@vN` (tag) without SHA pin in workflow with `secrets:` or `permissions: write` → see item 1.
2. `${{ secrets.AWS_*  }}` / `${{ secrets.GCP_* }}` / `${{ secrets.AZURE_* }}` when OIDC is supported → see item 2.
3. `on: pull_request_target` + `actions/checkout` with `ref: head.*` → BLOCKING, see item 3.
4. Duplicate trigger: `pull_request: [dev]` + `push: [dev]` → see item 5a.
5. Expensive workflow (LLM, heavy Docker) with `push` trigger → see item 5b.
6. `actions/upload-artifact@v4` without unique name in matrix → see item 6.
7. `vitest run --coverage --shard=N/M` without `COVERAGE_SKIP_THRESHOLDS` (global threshold applied to partial shard) → see item 7.
8. `run: |` with `for` loop without `set -e` or `|| exit` → see item 8.
9. `exit 1` on numeric-metric gate without empirical baseline PoC → see item 9.
10. `actions/checkout` without `persist-credentials: false` in read-only workflow → see item 10.
11. Cache of payload >500MB in parallel jobs under same `key` without measuring hit rate → see [`references/caching.md`](references/caching.md) (parallel cache corruption section).
12. `env:` at top-level with `${{ secrets.X }}` when only 1-2 steps use it → secret scope too wide, move to step level.

## Common rationalizations (and what to do instead)

| "I'll just..." | Reality | What to do |
|----------------|---------|------------|
| "...use `@v4` instead of SHA pin, it's a trusted action" | tj-actions had 23k repos trusting it. A tag can be rewritten in seconds. | SHA pin takes 30s: `gh api repos/{org}/{repo}/git/refs/tags/{tag} --jq '.object.sha'` |
| "...put the secret in workflow `env:` to simplify" | Exposes it to all steps including third-party actions | Move it to the step that uses it: `env:` at step level |
| "...check out PR head in pull_request_target, more convenient" | Classic RCE — attacker via fork gets shell | Use `pull_request` + filter on `head.repo.full_name` if you need the head |
| "...also run CI on push to dev, just to make sure the merge is OK" | PR already tested the same SHA, double cost | Trust the PR. `push` only on main (deploy gate) |
| "...activate the eval gate at 0.70 already, it's a reasonable number" | Without PoC, any number is a guess. May fail 100% of PRs | Informative mode (`::warning + exit 0`) for N PRs until baseline exists |
| "...cache this big Docker image to save 30s" | If hit rate < 50%, save cost exceeds benefit. Cache can corrupt in parallel | Measure hit rate over 5-10 runs before keeping |
| "...`persist-credentials` by default, no one will inspect it" | Subsequent third-party step can leak via `git push` or inspection | `persist-credentials: false` on read-only checkouts |

## Quick reference

**DO NOT hardcode SHA pins in this skill** — they age within days. Use the audit script to resolve tag → current SHA:

```bash
# Resolve tag to current SHA (monthly rotation)
gh api repos/actions/checkout/git/refs/tags/v5.0.0 --jq '.object.sha'

# Audit all workflows in the repo
bash ${CLAUDE_PLUGIN_ROOT}/skills/optimizing-github-actions/scripts/audit-action-pins.sh
```

Useful `gh` commands for triage:

```bash
gh workflow list                                            # List workflows
gh run list --workflow=ci.yml --limit=10                    # Last 10 CI runs
gh run view <run-id> --log                                  # Logs of a run
gh run view <run-id> --json conclusion,jobs                 # Structured status
gh api /repos/{owner}/{repo}/actions/runs/{run-id}/timing   # Time per job
```

Essential official docs:
- GitHub Actions: https://docs.github.com/en/actions
- OIDC hardening: https://docs.github.com/en/actions/concepts/security/openid-connect
- Concurrency: https://docs.github.com/en/actions/using-jobs/using-concurrency
- Vitest sharding: https://vitest.dev/guide/reporters
- Playwright sharding: https://playwright.dev/docs/test-sharding

## Evolving this skill

GitHub Actions evolves quickly (`actions/upload-artifact@v4` breaking change in Dec 2023, free ARM in Jan 2025, supply-chain incident in March 2025, `pull_request_target` change in Nov 2025). To keep this skill current:

- **Monthly:** review the SKILL.md + sub-files for outdated SHA pins and recently announced changes.
- **When GitHub announces a breaking change:** update the relevant `references/` file + bump the version footer.
- **When a new incident class appears in your project:** add it to the project's local CLAUDE.md "Lessons Learned" + add an item to the pre-flight checklist if recurring.
- **SHA pins:** DO NOT hardcode here — use `scripts/audit-action-pins.sh`.

## Additional resources

**Sub-files** (loaded on demand):
- [`references/security.md`](references/security.md) — SHA pinning, OIDC, pull_request_target, persist-credentials, secret scoping, bash hardening, tj-actions postmortem.
- [`references/sharding.md`](references/sharding.md) — Vitest blob+merge (v2.0.0+), Playwright shard with/without blob, fail-fast semantics, coverage in shards.
- [`references/artifacts-v4.md`](references/artifacts-v4.md) — Breaking changes vs v3, merge patterns, naming.
- [`references/caching.md`](references/caching.md) — `actions/cache@v4` vs `setup-node` native, restore-keys hierarchy, parallel cache corruption anti-pattern.
- [`references/concurrency-and-triggers.md`](references/concurrency-and-triggers.md) — Concurrency groups, paths-filter (native vs dorny), avoiding SHA duplication.
- [`references/observability.md`](references/observability.md) — STEP_SUMMARY, sticky comments, dashboards, calibrated gates.
- [`references/reuse-patterns.md`](references/reuse-patterns.md) — Reusable workflows vs composite actions, decision matrix.

**Examples:**
- [`examples/good-workflow.yml`](examples/good-workflow.yml) — Annotated template with SHA pins, OIDC, concurrency, correct sharding.
- [`examples/bad-workflow.yml`](examples/bad-workflow.yml) — Same workflow with red flags marked (`# RED FLAG: ...`).

**Scripts:**
- [`scripts/audit-action-pins.sh`](scripts/audit-action-pins.sh) — Iterates workflows, classifies `uses:` lines into PIN/MAJ/TAG/BAD/LOC, exit 1 if red flags.

---

**Version:** 0.2.0 (2026-04-26)
**Last audited:** 2026-04-26
