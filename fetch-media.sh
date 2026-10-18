#!/bin/sh
# The demo videos of the splash (media.json): downloaded from this repository's
# release, checked against their SHA-256, put into <site>/demo/ with demo.json.
# Not in git: binaries this size belong to a release.
#
#   ./fetch-media.sh <site dir>
set -eu
SITE=${1:?usage: $0 <site dir>}
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$SITE/demo"
python3 - "$HERE/media.json" "$SITE/demo" <<'PY'
import hashlib, json, sys, urllib.request
spec, out = json.load(open(sys.argv[1])), sys.argv[2]
base = f"https://github.com/{spec['repository']}/releases/download/{spec['release']}/"
for name, sha in spec["files"].items():
    data = urllib.request.urlopen(base + name, timeout=120).read()
    got = hashlib.sha256(data).hexdigest()
    if got != sha:
        sys.exit(f"{name}: SHA-256 {got}, expected {sha}")
    open(f"{out}/{name}", "wb").write(data)
    print(f"demo/{name}: {len(data) // 1024} KiB, checked")
json.dump({"videos": spec["videos"]}, open(f"{out}/demo.json", "w"), indent=2)
PY
