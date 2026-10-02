#!/usr/bin/env bash
# Run the browser integration suite headless and report.
#
#   scripts/browser-tests.sh [port]
#
# Serves the pinkrobotics site root on a local port, drives Chromium with software WebGL (so it
# runs on a box whose GPUs are busy — which this one always is), and greps the machine-readable
# result attribute out of the dumped DOM.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."          # -> pinkrobotics/
PORT="${1:-8791}"
CHROME="${CHROME:-chromium}"

if ! curl -sf -o /dev/null "http://127.0.0.1:$PORT/airship3d/airship3d.js"; then
  python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
  SERVER=$!
  trap 'kill $SERVER 2>/dev/null || true' EXIT
  sleep 1
fi

# The snap-confined Chromium can only write a profile under snap/chromium/common in the home directory.
PROFILE="${A3D_CHROME_PROFILE:-$HOME/snap/chromium/common/a3d-profile}"
mkdir -p "$PROFILE"

# --disk-cache-size=1 because the module graph is served from a plain static server: without it a
# second run can silently test the previous run's code.
DOM=$(timeout 300 "$CHROME" --headless=new --no-sandbox \
  --disk-cache-size=1 --media-cache-size=1 \
  --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader \
  --user-data-dir="$PROFILE" --virtual-time-budget=120000 --dump-dom \
  "http://127.0.0.1:$PORT/airship3d/tests/browser.html" 2>/dev/null)

RESULT=$(printf '%s' "$DOM" | grep -oE 'data-a3d-result="[^"]*"' | head -1 | sed 's/.*="//;s/"$//')
FAILS=$(printf '%s' "$DOM" | grep -oE 'data-a3d-failures="[^"]*"' | head -1 | sed 's/.*="//;s/"$//')

if [ -z "$RESULT" ]; then
  echo "browser tests: NO RESULT (the page did not finish)" >&2
  exit 1
fi
echo "browser tests: $RESULT"
[ -n "$FAILS" ] && echo "failures: $FAILS"
case "$RESULT" in *"fail=0"*) exit 0 ;; *) exit 1 ;; esac
