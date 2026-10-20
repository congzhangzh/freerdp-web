#!/bin/sh
# Which of the release kit's pre-releases holds a tested web client; prints its tag:
#
#   ./kit-release.sh              the newest web-* pre-release
#   ./kit-release.sh <commit>     the newest the kit built for this page commit (7 or more
#                                 hex digits): web-<commit, 12>-<kit commit, 12>, or the
#                                 older web-<commit, 12>
#
# The kit publishes each pre-release once and never replaces its files (its
# docs/RELEASE.md, "Frozen releases"); a new build of the same page is a new tag, so the
# newest published one wins. One whose notes start with WITHDRAWN is skipped. GH_TOKEN,
# when set, is sent (more API calls an hour); KIT_RELEASES=<file> reads the release list
# from a file instead (test-kit-release.sh).
set -eu
exec python3 - "${1:-}" << 'EOF'
import json, os, re, sys, urllib.request

KIT = "congzhangzh/rdp-release-kit"
commit = sys.argv[1].lower()
if commit and not re.fullmatch(r"[0-9a-f]{7,40}", commit):
    sys.exit(f"kit-release.sh: not a commit: {commit}")


def releases():
    if os.environ.get("KIT_RELEASES"):
        with open(os.environ["KIT_RELEASES"]) as f:
            yield from json.load(f)
        return
    page = 1
    while True:
        req = urllib.request.Request(
            f"https://api.github.com/repos/{KIT}/releases?per_page=100&page={page}",
            headers={"Accept": "application/vnd.github+json"})
        if os.environ.get("GH_TOKEN"):
            req.add_header("Authorization", "Bearer " + os.environ["GH_TOKEN"])
        with urllib.request.urlopen(req, timeout=30) as r:
            batch = json.load(r)
        if not batch:
            return
        yield from batch
        page += 1


def wanted(r):
    m = re.fullmatch(r"web-([0-9a-f]{12})(-[0-9a-f]{12})?", r["tag_name"])
    return (m and not r.get("draft") and r.get("published_at")
            and not (r.get("body") or "").startswith("WITHDRAWN")
            and m.group(1).startswith(commit[:12]))


found = sorted(filter(wanted, releases()), key=lambda r: r["published_at"], reverse=True)
if not found:
    sys.exit("kit-release.sh: the kit has no tested client"
             + (f" for {commit}: pin it in the kit's sources.lock first" if commit else ""))
print(found[0]["tag_name"])
EOF
