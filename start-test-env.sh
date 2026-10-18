#!/bin/bash
# Start the local test environment for the browser client (idempotent):
#   8080  serve.py dist/         (COOP/COEP, gzip)
#   6081  websockify -> 13390    (CI xrdp container grd-wasm-xrdp-ci, used by the test-*.mjs scripts)
# Logs and pids: ./out/env-*.log, ./out/env-*.pid
set -u
HERE=$(cd "$(dirname "$0")" && pwd); O=$HERE/out; mkdir -p "$O"
up() { ss -ltn | grep -q "127.0.0.1:$1 "; }
[ "$(docker inspect -f '{{.State.Running}}' grd-wasm-xrdp-ci 2>/dev/null)" = true ] || docker start grd-wasm-xrdp-ci >/dev/null
up 8080 || { nohup python3 "$HERE/serve.py" 8080 "$HERE/dist" > "$O/env-serve.log" 2>&1 & echo $! > "$O/env-serve.pid"; }
up 6081 || { nohup uvx websockify 127.0.0.1:6081 127.0.0.1:13390 > "$O/env-websockify-ci.log" 2>&1 & echo $! > "$O/env-websockify-ci.pid"; }
for i in $(seq 30); do up 8080 && up 6081 && up 13390 && break; sleep 1; done
for p in 8080 6081 13390; do up $p && echo "$p up" || echo "$p DOWN"; done
