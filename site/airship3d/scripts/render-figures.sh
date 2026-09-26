#!/usr/bin/env bash
# Rasterise the generated SVG figures to PNG (and WebP where ImageMagick can).
#
#   scripts/render-figures.sh [--width 1760] [--dark|--transparent]
#
# Two-step by design: scripts/figures.mjs produces the vectors anywhere node runs, and only this
# step needs a browser. Chromium is used rather than ImageMagick because the local ImageMagick has
# no SVG delegate — it silently misreads an SVG as MVG and fails.
#
# NOTE ON THIS MACHINE: the snap-confined Chromium can only write inside ~/snap/chromium/common,
# so the work happens there and the results are copied back. It also cannot share a profile with a
# running interactive Chromium, hence the dedicated profile directory.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."             # -> airship3d/
SRC="assets/static"
DST="assets/raster"
WIDTH=1760
BG="#0a0a0c"
while [ $# -gt 0 ]; do
  case "$1" in
    --width) WIDTH="$2"; shift 2 ;;
    --transparent) BG="transparent"; shift ;;
    --dark) BG="#0a0a0c"; shift ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done

CHROME="${CHROME:-chromium}"
WORK="${A3D_CHROME_WORK:-$HOME/snap/chromium/common/a3d-render}"
PROFILE="${A3D_CHROME_PROFILE:-$HOME/snap/chromium/common/a3d-profile}"
mkdir -p "$WORK" "$PROFILE" "$DST"

n=0
for svg in "$SRC"/*.svg; do
  base="$(basename "$svg" .svg)"
  # Height comes from the SVG's own viewBox, so the raster matches the vector exactly.
  read -r vw vh <<<"$(grep -o 'viewBox="[^"]*"' "$svg" | head -1 \
      | sed 's/viewBox="//;s/"//' | awk '{print $3, $4}')"
  h=$(awk -v w="$WIDTH" -v vw="$vw" -v vh="$vh" 'BEGIN{printf "%d", w*vh/vw}')
  cat > "$WORK/$base.html" <<EOF
<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;background:$BG}svg{display:block;width:${WIDTH}px}</style>
$(cat "$svg")
EOF
  timeout 90 "$CHROME" --headless=new --no-sandbox --hide-scrollbars --disable-gpu \
    --user-data-dir="$PROFILE" --window-size="$WIDTH,$h" \
    --screenshot="$WORK/$base.png" "file://$WORK/$base.html" >/dev/null 2>&1
  if [ -f "$WORK/$base.png" ]; then
    mv "$WORK/$base.png" "$DST/$base.png"
    # WebP where ImageMagick is present. PNG stays as the compatibility fallback.
    if command -v magick >/dev/null 2>&1; then
      magick "$DST/$base.png" -quality 88 "$DST/$base.webp" 2>/dev/null || true
    fi
    n=$((n+1))
  else
    echo "render failed: $base" >&2
  fi
  rm -f "$WORK/$base.html"
done
echo "rasterised $n figures into $DST at ${WIDTH}px wide (background $BG)"
du -sh "$DST"
