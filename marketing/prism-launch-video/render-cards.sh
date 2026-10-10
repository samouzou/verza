#!/usr/bin/env bash
# Renders every card/stage in cards/cards.html to media/cards/*.png at 1920x1080.
set -euo pipefail
cd "$(dirname "$0")"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
OUT=media/cards
mkdir -p "$OUT"
SRC="file://$PWD/cards/cards.html"

shots=(
  "01-setup:1" "01-setup:2"
  "02-calendar:1" "02-calendar:2" "02-calendar:3"
  "03-adapt:1" "03-adapt:2"
  "04-carousel:99"
  "05-reel:99"
  "06-approve:1" "06-approve:2"
  "07-published:1" "07-published:2" "07-published:3" "07-published:4"
  "title:99" "end:99" "title-overlay:99"
)

for s in "${shots[@]}"; do
  card="${s%%:*}"; stage="${s##*:}"
  extra=""
  if [[ "$card" == "05-reel" && -f media/reel-frame.png ]]; then extra="&reel=../media/reel-frame.png"; fi
  name="$card"; [[ "$stage" != 99 ]] && name="$card-s$stage"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
    --default-background-color=00000000 \
    --window-size=1920,1080 --virtual-time-budget=1500 \
    --screenshot="$OUT/$name.png" "$SRC?card=$card&stage=$stage$extra" >/dev/null 2>&1
  echo "$OUT/$name.png"
done
