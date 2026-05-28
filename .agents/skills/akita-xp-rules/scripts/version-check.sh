#!/usr/bin/env bash
# version-check.sh — compara versao local de xp-stack com npm registry.
# Imprime banner se outdated. Cache 24h em .xp-stack/version-check-cache.json.
# Silent fail se sem rede ou jq ausente — nao trava session.

set -euo pipefail

PROJECT_ROOT="${1:-$(pwd)}"
CACHE_FILE="$PROJECT_ROOT/.xp-stack/version-check-cache.json"
LOCAL_VERSION_FILE="$PROJECT_ROOT/.xp-stack/version"
NPM_URL="https://registry.npmjs.org/xp-stack/latest"
CACHE_TTL_HOURS=24

# Skip if no local install
[ -f "$LOCAL_VERSION_FILE" ] || exit 0

LOCAL_VERSION=$(cat "$LOCAL_VERSION_FILE" 2>/dev/null || echo "unknown")

# Check cache freshness (skip if checked in last CACHE_TTL_HOURS)
if [ -f "$CACHE_FILE" ]; then
  if command -v jq >/dev/null 2>&1; then
    CACHE_TS=$(jq -r '.checked_at // ""' "$CACHE_FILE" 2>/dev/null || echo "")
    if [ -n "$CACHE_TS" ]; then
      NOW_EPOCH=$(date +%s)
      CACHE_EPOCH=$(date -d "$CACHE_TS" +%s 2>/dev/null || echo 0)
      AGE_HOURS=$(( (NOW_EPOCH - CACHE_EPOCH) / 3600 ))
      if [ "$AGE_HOURS" -lt "$CACHE_TTL_HOURS" ]; then
        # Cache fresh — read remote from cache instead of refetching
        REMOTE_VERSION=$(jq -r '.remote_version // ""' "$CACHE_FILE" 2>/dev/null || echo "")
        if [ -n "$REMOTE_VERSION" ] && [ "$LOCAL_VERSION" != "$REMOTE_VERSION" ]; then
          echo ""
          echo "xp-stack: nova versao disponivel ($REMOTE_VERSION). Voce esta em $LOCAL_VERSION."
          echo "Update: npx xp-stack update --yes --take-theirs"
          echo ""
        fi
        exit 0
      fi
    fi
  fi
fi

# Fetch remote version (silent fail)
if command -v curl >/dev/null 2>&1; then
  REMOTE_VERSION=$(curl -fsS --max-time 3 "$NPM_URL" 2>/dev/null | sed -n 's/.*"version":"\([^"]*\)".*/\1/p' | head -1)
elif command -v wget >/dev/null 2>&1; then
  REMOTE_VERSION=$(wget -qO- --timeout=3 "$NPM_URL" 2>/dev/null | sed -n 's/.*"version":"\([^"]*\)".*/\1/p' | head -1)
else
  exit 0  # Silent: nao tem fetcher
fi

[ -n "$REMOTE_VERSION" ] || exit 0  # Silent: sem rede

# Update cache
mkdir -p "$(dirname "$CACHE_FILE")"
NOW_ISO=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
cat > "$CACHE_FILE" <<JSON
{
  "checked_at": "$NOW_ISO",
  "local_version": "$LOCAL_VERSION",
  "remote_version": "$REMOTE_VERSION"
}
JSON

# Compare + banner
if [ "$LOCAL_VERSION" != "$REMOTE_VERSION" ]; then
  echo ""
  echo "xp-stack: nova versao disponivel ($REMOTE_VERSION). Voce esta em $LOCAL_VERSION."
  echo "Update: npx xp-stack update --yes --take-theirs"
  echo ""
fi
