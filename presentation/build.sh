#!/bin/sh
# Собирает PDF из deck.html. Скриншоты кладутся в screens/ под именами
# shield, twin3d, forecast, passport, lab, exec, effect (.png или .jpg);
# пока файла нет, на слайде остаётся рамка «Место для скриншота».
set -e
cd "$(dirname "$0")"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
OUT="ceres-dvoinik-zavoda.pdf"
"$CHROME" --headless=new --no-pdf-header-footer --virtual-time-budget=10000 \
  --print-to-pdf="$PWD/$OUT" "file://$PWD/deck.html" 2>/dev/null
echo "Готово: $PWD/$OUT"
