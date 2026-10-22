#!/bin/sh
# The demo videos of the splash, put into <site>/demo/ with demo.json:
#
#   ./fetch-media.sh <site dir>
#
# From the release kit's newest demo-* pre-release: the kit records them in
# CI with its newest tested client and xrdp preview, and publishes each set
# once (its demo.json names what they were recorded with). Each file is
# checked against the pre-release's SHA256SUMS. Without one (or with
# MEDIA=pinned), from this repository's media release that media.json pins,
# each file checked against its SHA-256 there. Downloads are kept in
# ~/.cache/freerdp-web/media by SHA-256, so the next run is instant. Not in
# git: binaries this size belong to a release. GH_TOKEN, when set, is sent
# (more API calls an hour).
set -eu
SITE=${1:?usage: $0 <site dir>}
HERE=$(cd "$(dirname "$0")" && pwd)
CACHE=${XDG_CACHE_HOME:-$HOME/.cache}/freerdp-web/media
mkdir -p "$SITE/demo" "$CACHE"
python3 - "$HERE/media.json" "$SITE/demo" "$CACHE" "${MEDIA:-kit}" <<'PY'
import hashlib, json, os, sys, urllib.request
spec_file, out, cache, mode = sys.argv[1:5]
KIT = "congzhangzh/rdp-release-kit"


def get(url, api=False):
    req = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json"} if api else {})
    if api and os.environ.get("GH_TOKEN"):
        req.add_header("Authorization", "Bearer " + os.environ["GH_TOKEN"])
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def fetch(base, name, sha):
    """A file by its SHA-256: from the cache, or downloaded and checked."""
    kept = os.path.join(cache, sha)
    data = open(kept, "rb").read() if os.path.exists(kept) else b""
    if hashlib.sha256(data).hexdigest() != sha:
        data = get(base + name)
        got = hashlib.sha256(data).hexdigest()
        if got != sha:
            sys.exit(f"{name}: SHA-256 {got}, expected {sha}")
        open(kept, "wb").write(data)
    return data


def newest_demo():
    """The kit's newest published demo-* pre-release, not withdrawn."""
    page, found = 1, []
    while True:
        batch = json.loads(get(f"https://api.github.com/repos/{KIT}/releases?per_page=100&page={page}", True))
        if not batch:
            break
        found += [r for r in batch if r["tag_name"].startswith("demo-") and not r.get("draft")
                  and r.get("published_at") and not (r.get("body") or "").startswith("WITHDRAWN")]
        page += 1
    return max(found, key=lambda r: r["published_at"])["tag_name"] if found else None


tag = newest_demo() if mode == "kit" else None
if tag:
    base = f"https://github.com/{KIT}/releases/download/{tag}/"
    sums = {}
    for line in get(base + "SHA256SUMS").decode().splitlines():
        sha, name = line.split(None, 1)
        sums[name.lstrip("*")] = sha
    demo = json.loads(fetch(base, "demo.json", sums["demo.json"]))
    files = [os.path.basename(v[k]) for v in demo["videos"] for k in ("src", "poster")]
    files = {name: sums[name] for name in files}
    source = f"{tag} (the kit's newest demo videos)"
else:
    spec = json.load(open(spec_file))
    base = f"https://github.com/{spec['repository']}/releases/download/{spec['release']}/"
    demo, files = {"videos": spec["videos"]}, spec["files"]
    source = f"{spec['release']} (media.json)"
for name, sha in files.items():
    data = fetch(base, name, sha)
    open(f"{out}/{name}", "wb").write(data)
    print(f"demo/{name}: {len(data) // 1024} KiB, checked")
json.dump(demo, open(f"{out}/demo.json", "w"), indent=2, ensure_ascii=False)
print(f"demo videos from {source}")
PY
