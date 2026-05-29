#!/usr/bin/env bash
# ============================================================
# Gera os ícones do Abissal a partir dos SVGs-fonte em docs/brand/.
# Requer: rsvg-convert (librsvg) + magick (ImageMagick).
# Idempotente — pode rodar quantas vezes quiser.
# Fonte da verdade do logo: docs/superpowers/specs/2026-05-29-identidade-visual-design.md
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/../.."

ICON="docs/brand/abissal-icon.svg"
MASK="docs/brand/abissal-icon-maskable.svg"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

for bin in rsvg-convert magick; do
  command -v "$bin" >/dev/null || { echo "ERRO: '$bin' ausente no PATH"; exit 1; }
done

echo "→ apple-icon (180×180)"
rsvg-convert -w 180 -h 180 "$ICON" -o app/apple-icon.png

echo "→ PWA icon-192"
rsvg-convert -w 192 -h 192 "$ICON" -o public/icons/icon-192.png

echo "→ PWA icon-512"
rsvg-convert -w 512 -h 512 "$ICON" -o public/icons/icon-512.png

echo "→ PWA icon-512-maskable"
rsvg-convert -w 512 -h 512 "$MASK" -o public/icons/icon-512-maskable.png

echo "→ favicon.ico (16/32/48)"
rsvg-convert -w 16 -h 16 "$ICON" -o "$TMP/16.png"
rsvg-convert -w 32 -h 32 "$ICON" -o "$TMP/32.png"
rsvg-convert -w 48 -h 48 "$ICON" -o "$TMP/48.png"
magick "$TMP/16.png" "$TMP/32.png" "$TMP/48.png" app/favicon.ico

echo "→ public/icons/icon.svg (mark novo)"
cp "$ICON" public/icons/icon.svg

echo "OK — ícones gerados."
