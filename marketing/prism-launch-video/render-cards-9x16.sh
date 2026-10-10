#!/usr/bin/env bash
# Renders the vertical cards and caption lines to media/cards-9x16/*.png at 2160x3840.
set -euo pipefail
cd "$(dirname "$0")"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
OUT=media/cards-9x16
mkdir -p "$OUT"
SRC="file://$PWD/cards/cards.html"

shoot() { # name query
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=3 \
    --default-background-color=00000000 --window-size=720,1280 --virtual-time-budget=1500 \
    --screenshot="$OUT/$1.png" "$SRC?v=1&$2" >/dev/null 2>&1
  echo "$OUT/$1.png"
}

shots=(
  "01-setup:1" "01-setup:2"
  "02-calendar:1" "02-calendar:2" "02-calendar:3"
  "03-adapt:1" "03-adapt:2"
  "04-carousel:99" "05-reel:99"
  "06-approve:1" "06-approve:2"
  "07-published:1" "07-published:2" "07-published:3" "07-published:4"
  "title:99" "end:99" "title-overlay:99"
)
for s in "${shots[@]}"; do
  card="${s%%:*}"; stage="${s##*:}"
  name="$card"; [[ "$stage" != 99 ]] && name="$card-s$stage"
  shoot "$name" "card=$card&stage=$stage"
done

# Caption lines: id<TAB>start<TAB>end<TAB>text
while IFS=$'\t' read -r cid _ _ text; do
  [[ -z "$cid" ]] && continue
  shoot "sub-$cid" "card=sub&text=$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$text")"
done < captions.tsv
