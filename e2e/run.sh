#!/bin/bash
# Build the frontend, boot the fake stack (real backend + real built frontend,
# D1 and PoYo faked so no network or keys are needed), run one test script
# against it, then tear the stack down. Usage: bash run.sh e2e.js
set -e
cd "$(dirname "$0")"
ROOT="$(cd .. && pwd)"

if [ ! -d "$ROOT/frontend/build" ]; then
  echo "Building the frontend (frontend/build not found)..."
  (cd "$ROOT/frontend" && npm run build)
fi

# Pure-maths checks first — they need no server, and a timeline model that is
# already wrong makes every browser failure below harder to read.
(cd "$ROOT" && node e2e/clip-maths.mjs)

RUN_DIR="$(mktemp -d)"
export E2E_RUN_DIR="$RUN_DIR"
python3 serve.py > "$RUN_DIR/serve.log" 2>&1 &
SERVER_PID=$!
trap 'kill -9 "$SERVER_PID" >/dev/null 2>&1' EXIT

for i in $(seq 1 30); do
  if curl -sf localhost:8123/api/ >/dev/null 2>&1; then break; fi
  sleep 1
done

node "${1:-e2e.js}"
CODE=$?
echo "server log: $RUN_DIR/serve.log"
exit $CODE
