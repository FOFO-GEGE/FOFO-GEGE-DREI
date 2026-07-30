#!/usr/bin/env bash
# Runs the MIRROIR suite against a throwaway copy of docs/ whose Supabase
# client is swapped for the in-memory mock in this directory. Nothing here
# touches the real project.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
PORT="${MIRROIR_TEST_PORT:-8811}"

cleanup() {
  [[ -n "${SERVER_PID:-}" ]] && kill "$SERVER_PID" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

cp -r "$ROOT/docs/." "$WORK/"
rm -rf "$WORK/kazajob"
cp "$ROOT/tests/supabase-mock.js" "$WORK/vendor/supabase.js"

python3 -m http.server "$PORT" --directory "$WORK" >/dev/null 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 40); do
  curl -fsS -o /dev/null "http://localhost:$PORT/" && break
  sleep 0.25
done

export MIRROIR_TEST_BASE="http://localhost:$PORT"
status=0
for spec in "$ROOT"/tests/*.spec.js; do
  echo "── $(basename "$spec")"
  node "$spec" || status=1
done
exit $status
