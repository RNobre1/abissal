#!/usr/bin/env bash
# audit-action-pins.sh
#
# Audits SHA pinning in GitHub Actions workflows.
# Encodes the patterns from the `optimizing-github-actions` skill (item #1 of pre-flight checklist).
#
# Iterates all `.github/workflows/*.yml` (and `.github/actions/*/action.yml` if any),
# extracts `uses: org/action@ref` lines, classifies:
#
#   [PIN]  org/action@<sha40> # vN.N.N         — OK, SHA-pinned with human version
#   [MAJ]  actions/checkout@v5  # OK official  — official actions may use major version
#   [TAG]  org/action@v3                       — RED FLAG — mutable tag without SHA
#   [BAD]  org/action@<sha40>                  — SHA-pinned but WITHOUT version comment
#   [LOC]  ./.github/actions/local             — local composite action, not SHA-pinnable
#
# Exit codes:
#   0 — no red flags (TAG=0, BAD=0)
#   1 — red flags found
#   2 — input/setup error (gh unavailable, no network, etc)
#
# Usage:
#   ./audit-action-pins.sh                    # runs in current repo
#   ./audit-action-pins.sh --resolve          # also resolves tag → current SHA via gh api
#   ./audit-action-pins.sh --json             # structured JSON output
#
# CI usage (informative, not blocking initially):
#   - run: bash ${CLAUDE_PLUGIN_ROOT}/skills/optimizing-github-actions/scripts/audit-action-pins.sh \
#          || echo "::warning::SHA pins need review"

set -euo pipefail

# --- args ---
RESOLVE_TAGS=0
JSON_OUTPUT=0
for arg in "$@"; do
  case "$arg" in
    --resolve) RESOLVE_TAGS=1 ;;
    --json)    JSON_OUTPUT=1 ;;
    -h|--help)
      sed -n '2,30p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

# --- pre-flight ---
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
WORKFLOWS_DIR="$REPO_ROOT/.github/workflows"
ACTIONS_DIR="$REPO_ROOT/.github/actions"

if [[ ! -d "$WORKFLOWS_DIR" ]]; then
  echo "Error: $WORKFLOWS_DIR does not exist (run from repo root)" >&2
  exit 2
fi

if [[ "$RESOLVE_TAGS" == "1" ]] && ! command -v gh >/dev/null 2>&1; then
  echo "Error: --resolve requires gh CLI installed" >&2
  exit 2
fi

# Official GitHub action orgs that may accept major version (low risk but not zero)
OFFICIAL_ORGS=("actions" "github" "docker" "azure" "aws-actions" "google-github-actions")

is_official() {
  local org="$1"
  for o in "${OFFICIAL_ORGS[@]}"; do
    [[ "$org" == "$o" ]] && return 0
  done
  return 1
}

# --- collect ---
declare -a FINDINGS=()
TOTAL=0
COUNT_PIN=0
COUNT_MAJ=0
COUNT_TAG=0
COUNT_BAD=0
COUNT_LOC=0

# Look in workflows + local composite actions
mapfile -t YML_FILES < <(find "$WORKFLOWS_DIR" -type f \( -name '*.yml' -o -name '*.yaml' \) 2>/dev/null; find "$ACTIONS_DIR" -type f -name 'action.yml' 2>/dev/null || true)

for file in "${YML_FILES[@]}"; do
  [[ -f "$file" ]] || continue
  rel_path="${file#$REPO_ROOT/}"

  # Get lines with `uses:`. Expected format:
  #   uses: org/action@ref
  #   uses: org/action@ref # comment
  #   uses: ./.github/actions/local
  while IFS= read -r line_with_num; do
    lineno="${line_with_num%%:*}"
    line="${line_with_num#*:}"

    # Extract value after `uses:` (until # or EOL)
    uses_value="$(echo "$line" | sed -E 's/^[[:space:]]*-?[[:space:]]*uses:[[:space:]]*//' | sed -E 's/[[:space:]]*#.*$//' | tr -d '"' | tr -d "'")"
    comment="$(echo "$line" | grep -oE '#[[:space:]]*.*$' || true)"

    [[ -z "$uses_value" ]] && continue
    TOTAL=$((TOTAL + 1))

    # Local action (composite in same repo)
    if [[ "$uses_value" == ./* || "$uses_value" == .github/* ]]; then
      COUNT_LOC=$((COUNT_LOC + 1))
      FINDINGS+=("[LOC] $rel_path:$lineno  $uses_value")
      continue
    fi

    # Parse org/action@ref
    if [[ ! "$uses_value" =~ ^([^/]+)/([^@]+)@(.+)$ ]]; then
      # Unexpected format — flag
      FINDINGS+=("[???] $rel_path:$lineno  unrecognized format: $uses_value")
      continue
    fi
    org="${BASH_REMATCH[1]}"
    action="${BASH_REMATCH[2]}"
    ref="${BASH_REMATCH[3]}"

    # SHA = 40 hex chars
    if [[ "$ref" =~ ^[a-f0-9]{40}$ ]]; then
      if [[ -n "$comment" ]]; then
        COUNT_PIN=$((COUNT_PIN + 1))
        FINDINGS+=("[PIN] $rel_path:$lineno  $org/$action@${ref:0:8}... $comment")
      else
        COUNT_BAD=$((COUNT_BAD + 1))
        FINDINGS+=("[BAD] $rel_path:$lineno  $org/$action@${ref:0:8}...  (SHA-pin without # vN.N.N)")
      fi
      continue
    fi

    # Tag (v1, v4.0.2, main, master, etc)
    if is_official "$org"; then
      COUNT_MAJ=$((COUNT_MAJ + 1))
      FINDINGS+=("[MAJ] $rel_path:$lineno  $org/$action@$ref  (official action — major OK)")
    else
      COUNT_TAG=$((COUNT_TAG + 1))
      msg="[TAG] $rel_path:$lineno  $org/$action@$ref  RED FLAG — third-party without SHA pin"

      # Try to resolve tag → current SHA
      if [[ "$RESOLVE_TAGS" == "1" ]]; then
        sha=$(gh api "repos/$org/$action/git/refs/tags/$ref" --jq '.object.sha' 2>/dev/null || echo "")
        if [[ -n "$sha" && "$sha" != "null" ]]; then
          msg="$msg → current SHA: ${sha:0:8}..."
        fi
      fi

      FINDINGS+=("$msg")
    fi
  done < <(grep -nE '^\s*-?\s*uses:\s+' "$file" 2>/dev/null || true)
done

# --- output ---
if [[ "$JSON_OUTPUT" == "1" ]]; then
  printf '{\n'
  printf '  "total": %d,\n' "$TOTAL"
  printf '  "pin": %d,\n' "$COUNT_PIN"
  printf '  "major_official": %d,\n' "$COUNT_MAJ"
  printf '  "tag_red_flag": %d,\n' "$COUNT_TAG"
  printf '  "bad_no_comment": %d,\n' "$COUNT_BAD"
  printf '  "local": %d,\n' "$COUNT_LOC"
  printf '  "findings": [\n'
  for i in "${!FINDINGS[@]}"; do
    if [[ $i -gt 0 ]]; then printf ',\n'; fi
    escaped="${FINDINGS[$i]//\"/\\\"}"
    printf '    "%s"' "$escaped"
  done
  printf '\n  ]\n'
  printf '}\n'
else
  echo "=== GitHub Actions SHA pin audit ==="
  echo "Repo: $REPO_ROOT"
  echo "Workflows scanned: ${#YML_FILES[@]}"
  echo "Total uses: $TOTAL"
  echo
  echo "Summary:"
  echo "  [PIN] SHA-pinned + comment:        $COUNT_PIN"
  echo "  [MAJ] Major version (official OK): $COUNT_MAJ"
  echo "  [LOC] Local composite action:      $COUNT_LOC"
  echo "  [BAD] SHA without version comment: $COUNT_BAD"
  echo "  [TAG] Third-party without SHA pin: $COUNT_TAG  ${COUNT_TAG:+← RED FLAG}"
  echo
  echo "Detailed findings:"
  for finding in "${FINDINGS[@]}"; do
    echo "  $finding"
  done
fi

# Exit code: 1 if there are red flags
if [[ $COUNT_TAG -gt 0 || $COUNT_BAD -gt 0 ]]; then
  exit 1
fi
exit 0
