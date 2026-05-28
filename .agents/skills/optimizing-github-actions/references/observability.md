# GitHub Actions pipeline observability

Reference consumed by the `optimizing-github-actions` skill when the topic is making CI debuggable + calibrating gates.

## `$GITHUB_STEP_SUMMARY` — markdown on the run page

Each job has a `GITHUB_STEP_SUMMARY` env var pointing to a file. Anything written to it renders as Markdown on the run page in the Actions UI. Supports GFM (tables, code blocks, headings, links, images).

### Basic pattern

```yaml
- name: Test
  run: npm test -- --reporter=json --outputFile=test-results.json

- name: Generate test summary
  if: always()   # Run even if test failed
  run: |
    {
      echo "## Test Results"
      echo ""
      echo "| Suite | Total | Passed | Failed |"
      echo "|-------|-------|--------|--------|"
      jq -r '.testResults[] | "| \(.name) | \(.numTotalTests) | \(.numPassedTests) | \(.numFailedTests) |"' test-results.json
      echo ""
      if [ "$(jq '.numFailedTests' test-results.json)" -gt 0 ]; then
        echo "### Failed tests"
        jq -r '.testResults[] | select(.numFailedTests > 0) | .testFilePath' test-results.json | sed 's/^/- /'
      fi
    } >> "$GITHUB_STEP_SUMMARY"
```

Result: when opening the run, formatted table appears at the top — no need to open the log.

### Multiple steps append

Each step can append to the same summary. Build progressively:

```yaml
- name: Build
  run: |
    npm run build
    BUILD_SIZE=$(du -sh dist/ | cut -f1)
    echo "## Build" >> "$GITHUB_STEP_SUMMARY"
    echo "- Size: $BUILD_SIZE" >> "$GITHUB_STEP_SUMMARY"

- name: Lint
  run: |
    npm run lint -- --format json --output-file lint.json
    WARNINGS=$(jq '.[] | .warningCount' lint.json | paste -sd+ | bc)
    echo "## Lint" >> "$GITHUB_STEP_SUMMARY"
    echo "- Warnings: $WARNINGS" >> "$GITHUB_STEP_SUMMARY"

- name: Coverage
  run: |
    LINES_COVERED=$(jq '.total.lines.pct' coverage/coverage-summary.json)
    echo "## Coverage" >> "$GITHUB_STEP_SUMMARY"
    echo "- Lines: $LINES_COVERED%" >> "$GITHUB_STEP_SUMMARY"
```

Official pattern recommended by GitHub: "turn GitHub Actions from a black box into a dashboard".

### Limit

Step summary has a limit of **1MB per job**. Above that, content is truncated. Use for summary, not for complete logs.

## Sticky comments on PRs

For observability that needs to be visible **outside the Actions UI** (directly on the PR), use sticky comment via `actions/github-script`.

### Pattern: create/update comment

```yaml
- name: Comment results on PR
  if: always() && github.event_name == 'pull_request'
  uses: actions/github-script@v7
  with:
    script: |
      const fs = require('fs');
      const results = JSON.parse(fs.readFileSync('eval-results.json', 'utf8'));
      
      const body = `## 🤖 Eval Results
      
      | Metric | Value | Threshold |
      |--------|-------|-----------|
      | Context Precision | ${results.cp.toFixed(2)} | 0.50 |
      | Faithfulness | ${results.f.toFixed(2)} | 0.60 |
      | Answer Relevancy | ${results.ar.toFixed(2)} | 0.50 |
      
      <sub>Last updated: ${new Date().toISOString()}</sub>
      <sub>Workflow: [\`eval.yml\`](https://github.com/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId})</sub>`;
      
      // Find existing comment
      const { data: comments } = await github.rest.issues.listComments({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.payload.pull_request.number,
      });
      
      const sticky = comments.find(c => c.user.login === 'github-actions[bot]' && c.body.includes('🤖 Eval Results'));
      
      if (sticky) {
        // Update
        await github.rest.issues.updateComment({
          owner: context.repo.owner,
          repo: context.repo.repo,
          comment_id: sticky.id,
          body,
        });
      } else {
        // Create
        await github.rest.issues.createComment({
          owner: context.repo.owner,
          repo: context.repo.repo,
          issue_number: context.payload.pull_request.number,
          body,
        });
      }
```

### When STEP_SUMMARY vs sticky comment

| Case | Mechanism |
|------|-----------|
| Result table for debugger who already entered the run | STEP_SUMMARY |
| Eval/coverage status that dev needs to see on the PR without opening Actions | Sticky comment |
| Build size, lint warnings, perf metrics — ad-hoc debug | STEP_SUMMARY |
| Notify PR author about regression | Sticky comment + automatic label |
| Summary that persists even after run expires (artifact) | Artifact (`actions/upload-artifact`) |

Generally the two are complementary — STEP_SUMMARY for detail, sticky comment for alert.

## Calibrated blocking gates

A common failure: hard-fail thresholds without empirical baseline. The metric is computed correctly but doesn't yet discriminate between healthy and regressed PRs — every PR fails, devs learn to bypass.

### Pattern: informative gate until baseline exists

```yaml
- name: Eval gate (informative until baseline)
  shell: bash
  run: |
    set -euo pipefail
    if [ "$(jq '.score' eval-results.json)" -lt "0.70" ]; then
      echo "::warning::Score below 0.70 threshold (informative — no baseline yet)"
      exit 0   # Don't block merge
    fi
```

Combine with sticky comment so the failing metric is visible without burying it in logs.

### When to flip from informative to blocking

Promote to `exit 1` only when:
1. You have empirical PoC showing the metric DISCRIMINATES (failing PR fails the gate, healthy PR passes).
2. False-positive rate < 5% over N recent runs.
3. The threshold matches actual baseline distribution (not a guess).

Until then, keep informative.

## Workflow_run event — external dashboards

For consolidated dashboards, use `workflow_run` which fires in another workflow after the first completes:

```yaml
# .github/workflows/dashboard-update.yml
on:
  workflow_run:
    workflows: ['CI', 'Eval', 'Smoke']
    types: [completed]

jobs:
  update-dashboard:
    runs-on: ubuntu-latest
    steps:
      - name: Push metrics to Datadog
        run: |
          curl -X POST https://api.datadoghq.com/api/v1/series \
            -H "DD-API-KEY: ${{ secrets.DD_API_KEY }}" \
            -d '{
              "series": [{
                "metric": "ci.duration",
                "points": [[${{ github.event.workflow_run.run_number }}, ${{ github.event.workflow_run.run_duration_ms }}]],
                "tags": ["workflow:${{ github.event.workflow_run.name }}"]
              }]
            }'
```

## Third-party tools for observability

| Tool | For | Cost |
|------|-----|------|
| Datadog CI Visibility | Dashboards, flaky test detection, perf trend | Paid — expensive |
| Trunk Flaky Tests | Detects flaky on PRs, automatic quarantine | Free tier + paid |
| BuildJet | Self-hosted managed runners (faster + cheaper) | Per use |
| Depot | Distributed cache + fast Docker builds | Per use |
| `step-security/harden-runner` | Runtime security monitoring (detected tj-actions) | Free |

## Anti-patterns

### 1. Giant log without summary

```yaml
# ❌ Dev has to open 50MB log to see "passed or not"
- run: npm test
```

```yaml
# ✅ Step summary with concise table + detailed log for debug
- run: npm test -- --reporter=json --outputFile=test.json
- run: |
    PASSED=$(jq '.numPassedTests' test.json)
    FAILED=$(jq '.numFailedTests' test.json)
    echo "## Test: $PASSED passed, $FAILED failed" >> "$GITHUB_STEP_SUMMARY"
  if: always()
```

### 2. Sticky comment overwritten on every PR

Without searching for existing comment, each run creates a NEW comment — history becomes spam.

Always search `comments.find(c => c.body.includes('<marker>'))` before creating.

### 3. Waiting for workflow to finish to see the problem

Actions UI shows steps in real-time. Logs appear as they run. To debug, open the in-progress job and follow — don't wait for it to finish.

`gh run watch <run-id>` does this from CLI.

## External references

- Official STEP_SUMMARY announcement: https://github.blog/news-insights/product-news/supercharging-github-actions-with-job-summaries/
- Official doc: https://docs.github.com/en/actions/using-workflows/workflow-commands-for-github-actions#adding-a-job-summary
- `actions/github-script`: https://github.com/actions/github-script
- `workflow_run` event: https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#workflow_run
