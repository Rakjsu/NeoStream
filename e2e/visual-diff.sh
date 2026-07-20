#!/usr/bin/env bash
# 🖼️ Item 42: regressão visual — compara as screenshots do E2E com as
# baselines versionadas em e2e/baselines (ImageMagick, presente no runner).
# Roda NÃO-BLOQUEANTE (continue-on-error no workflow): regressões aparecem
# no summary do job e os diffs viram artifact; endurecer quando estabilizar.
#
# Pra atualizar as baselines após uma mudança visual INTENCIONAL: baixe o
# artifact app-screenshots do run verde e substitua os PNGs em e2e/baselines.
set -u
shopt -s nullglob

BASE_DIR="e2e/baselines"
SHOT_DIR="screenshots"
DIFF_DIR="screenshots/visual-diff"
THRESHOLD_PCT="1.0"   # % de pixels diferentes tolerada por tela
FUZZ="10%"            # tolerância por pixel (antialiasing/fontes do runner)

SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"
mkdir -p "$DIFF_DIR"
fail=0

{
  echo "## 🖼️ Regressão visual (fuzz ${FUZZ}, limiar ${THRESHOLD_PCT}%)"
  echo "| Tela | Pixels diferentes | Status |"
  echo "|---|---|---|"
} >> "$SUMMARY"

for shot in "$SHOT_DIR"/*.png; do
  name="$(basename "$shot")"
  base="$BASE_DIR/$name"
  if [ ! -f "$base" ]; then
    echo "| $name | — | ⚪ sem baseline |" >> "$SUMMARY"
    continue
  fi
  total=$(identify -format "%[fx:w*h]" "$base" 2>/dev/null || echo 0)
  ae=$(compare -metric AE -fuzz "$FUZZ" "$base" "$shot" "$DIFF_DIR/$name" 2>&1 || true)
  # compare imprime o AE no stderr; dimensões diferentes viram texto → trata como regressão
  case "$ae" in (*[!0-9]*) ae=999999999;; esac
  if [ "${total:-0}" -gt 0 ]; then
    pct=$(awk -v a="$ae" -v t="$total" 'BEGIN { printf "%.3f", (a / t) * 100 }')
  else
    pct="999"
  fi
  over=$(awk -v p="$pct" -v th="$THRESHOLD_PCT" 'BEGIN { print (p + 0 > th + 0) ? 1 : 0 }')
  if [ "$over" = "1" ]; then
    echo "| $name | ${pct}% | 🔴 acima do limiar |" >> "$SUMMARY"
    fail=1
  else
    echo "| $name | ${pct}% | 🟢 |" >> "$SUMMARY"
    rm -f "$DIFF_DIR/$name"
  fi
done

if [ "$fail" = "1" ]; then
  echo "Diferenças visuais acima do limiar — confira o artifact visual-diffs." >> "$SUMMARY"
fi
exit $fail
