#!/bin/sh
# Which of the release kit's pre-releases holds a tested web client; prints its tag:
#
#   ./kit-release.sh              the newest web-* pre-release
#   ./kit-release.sh <commit>     the newest the kit built for this page commit (7 or more
#                                 hex digits)
#
# Names: web-<YYYYMMDD>.<N>-<kit commit, 12> since 21 October 2026, keyed "Web client for
# freerdp-web <page commit, 12> (kit <kit commit, 12>)": until 27 October the key is the
# title; from 28 October it is a line "<!-- kit-key: <key> -->" in the notes, and the title
# "Web client <tag>". Before, web-<page commit, 12>-<kit commit, 12> and web-<page commit,
# 12>, which name the page commit themselves.
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


def page(r):
    """the page commit (12) a web pre-release was built for, or None"""
    tag = r.get("tag_name") or ""
    if re.fullmatch(r"web-[0-9]{8}\.[0-9]+-[0-9a-f]{12}", tag):
        key = r"Web client for freerdp-web ([0-9a-f]{12}) \(kit [0-9a-f]{12}\)"
        m = (re.fullmatch(key, r.get("name") or "")
             or re.search(r"<!-- kit-key: " + key + r" -->", r.get("body") or ""))
        return m and m.group(1)
    m = re.fullmatch(r"web-([0-9a-f]{12})(-[0-9a-f]{12})?", tag)
    return m and m.group(1)
def wanted(r):
    p = page(r)
    return (p and not r.get("draft") and r.get("published_at")
            and not (r.get("body") or "").startswith("WITHDRAWN")
            and p.startswith(commit[:12]))


found = sorted(filter(wanted, releases()), key=lambda r: r["published_at"], reverse=True)
if not found:
    sys.exit("kit-release.sh: the kit has no tested client"
             + (f" for {commit}: pin it in the kit's sources.lock first" if commit else ""))
print(found[0]["tag_name"])
EOF
