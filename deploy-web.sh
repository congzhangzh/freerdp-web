#!/bin/bash
# Copy the page files (web/) into dist/ and dist-ubsan/ and bump the IWA manifest's
# patch version, because Chrome only updates or reinstalls an IWA whose version is newer.
set -euo pipefail
cd "$(dirname "$0")"
python3 - <<'PY'
import json
p = "web/.well-known/manifest.webmanifest"
m = json.load(open(p))
major, minor, patch = (int(x) for x in m["version"].split("."))
m["version"] = f"{major}.{minor}.{patch + 1}"
json.dump(m, open(p, "w"), indent=2)
print("manifest version", m["version"])
PY
V=$(python3 -c 'import json; print(json.load(open("web/.well-known/manifest.webmanifest"))["version"])')
for d in dist dist-ubsan; do
  [ -d "$d" ] || continue
  cp -r web/. "$d/"
  # cache-busting: the page loads engine.js?v=<version>, which loads the runtime with the same
  # query (workers inherit the URL)
  sed -i "s|<script src=\"engine.js\"></script>|<script src=\"engine.js?v=$V\"></script>|" "$d/index.html"
  # precompressed copies for serve.py (rebuilt when the original is newer)
  for f in "$d/sdl-freerdp.wasm" "$d/sdl-freerdp.js" "$d/jspi/sdl-freerdp.wasm" "$d/jspi/sdl-freerdp.js"; do
    [ -f "$f" ] && { [ "$f.gz" -nt "$f" ] || gzip -9 -k -f "$f"; }
  done
done
echo "deployed web/ -> dist/ dist-ubsan/"
