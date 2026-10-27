#!/bin/sh
# The demo videos of the splash, for a local preview (site.sh), put into
# <site>/demo/ with demo.json:
#
#   ./fetch-media.sh <site dir>
#
# From the release kit's newest demo-* pre-release: the kit records them in
# CI with its newest tested client and its xrdp, and publishes each set
# once (its demo.json names what they were recorded with). Each file is
# checked against the pre-release's SHA256SUMS. Each video gets its lasting
# address ("id", "aliases" in demo.json) from the kit's own table,
# build/site-anchors.json, which the published site uses too: the kit
# publishes the site, so the addresses are its (until 2026-10-27 they were
# media.json's here). Downloads are kept in ~/.cache/freerdp-web/media by
# SHA-256, so the next run is instant. Not in git: binaries this size belong
# to a release. GH_TOKEN, when set, is sent (more API calls an hour).
set -eu
SITE=${1:?usage: $0 <site dir>}
HERE=$(cd "$(dirname "$0")" && pwd)
CACHE=${XDG_CACHE_HOME:-$HOME/.cache}/freerdp-web/media
mkdir -p "$SITE/demo" "$CACHE"
python3 - "$SITE/demo" "$CACHE" <<'PY'
import hashlib, json, os, sys, urllib.request
out, cache = sys.argv[1:3]
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


tag = newest_demo()
if not tag:
    sys.exit("the kit has no demo-* pre-release: NO_MEDIA=1 ./site.sh leaves the videos out")
base = f"https://github.com/{KIT}/releases/download/{tag}/"
sums = {}
for line in get(base + "SHA256SUMS").decode().splitlines():
    sha, name = line.split(None, 1)
    sums[name.lstrip("*")] = sha
demo = json.loads(fetch(base, "demo.json", sums["demo.json"]))
files = [os.path.basename(v[k]) for v in demo["videos"] for k in ("src", "poster")]
files = {name: sums[name] for name in files}
# each demo's lasting address: the kit's table, as on the published site
anchors = json.loads(get(f"https://raw.githubusercontent.com/{KIT}/main/build/site-anchors.json"))
anchors = {k: v for k, v in anchors.items() if not k.startswith("_")}
for v in demo["videos"]:
    name = os.path.splitext(os.path.basename(v["src"]))[0]
    for key, names in anchors.items():
        if name in names:
            v["id"], v["aliases"] = key, names
    if "id" not in v:
        print(f"warning: {name} has no address in the kit's build/site-anchors.json; here it is #{name}", file=sys.stderr)
for name, sha in files.items():
    data = fetch(base, name, sha)
    open(f"{out}/{name}", "wb").write(data)
    print(f"demo/{name}: {len(data) // 1024} KiB, checked")
json.dump(demo, open(f"{out}/demo.json", "w"), indent=2, ensure_ascii=False)
print(f"demo videos from {tag} (the kit's newest)")
PY
