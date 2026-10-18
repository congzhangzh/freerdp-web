#!/bin/sh
# The demo videos of the splash (media.json): downloaded from this repository's
# release (once: kept in ~/.cache/freerdp-web/media by SHA-256), checked, put into
# <site>/demo/ with demo.json. Not in git: binaries this size belong to a release.
#
#   ./fetch-media.sh <site dir>
set -eu
SITE=${1:?usage: $0 <site dir>}
HERE=$(cd "$(dirname "$0")" && pwd)
CACHE=${XDG_CACHE_HOME:-$HOME/.cache}/freerdp-web/media
mkdir -p "$SITE/demo" "$CACHE"
python3 - "$HERE/media.json" "$SITE/demo" "$CACHE" <<'PY'
import hashlib, json, os, sys, urllib.request
spec, out, cache = json.load(open(sys.argv[1])), sys.argv[2], sys.argv[3]
base = f"https://github.com/{spec['repository']}/releases/download/{spec['release']}/"
for name, sha in spec["files"].items():
    kept = os.path.join(cache, sha)
    data = open(kept, "rb").read() if os.path.exists(kept) else b""
    if hashlib.sha256(data).hexdigest() != sha:
        data = urllib.request.urlopen(base + name, timeout=120).read()
        got = hashlib.sha256(data).hexdigest()
        if got != sha:
            sys.exit(f"{name}: SHA-256 {got}, expected {sha}")
        open(kept, "wb").write(data)
    open(f"{out}/{name}", "wb").write(data)
    print(f"demo/{name}: {len(data) // 1024} KiB, checked")
json.dump({"videos": spec["videos"]}, open(f"{out}/demo.json", "w"), indent=2)
PY
