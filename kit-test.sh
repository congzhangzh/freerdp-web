#!/bin/sh
# The release kit's login test as it was when the kit built a client, with that build's
# xrdp packages, so a site is checked by the same test the client passed:
#
#   ./kit-test.sh <kit pre-release> [dir]   e.g. ./kit-test.sh web-20261025.12-b59d7a0f41c2
#
# Clones the kit into <dir> (default kit/) at the commit in the pre-release's KIT_COMMIT and
# puts the pre-release's .deb packages into <dir>/dist/xrdp/debian-13/, where the kit's
# test/wasm-session.sh looks for them. Then:
#
#   kit/test/wasm-session.sh <site dir> rdp-gateway.sh                the site's files, served here
#   WASM_ENGINE=jspi kit/test/wasm-session.sh <site dir> rdp-gateway.sh   the same with its JSPI build
#   PAGE_URL=<url>/index.html kit/test/wasm-session.sh - rdp-gateway.sh   a published site
#
# GH_TOKEN, when set, is sent to the API (more calls an hour).
set -eu
tag=${1:?usage: kit-test.sh <kit pre-release> [dir]}
dir=${2:-kit}
KIT=congzhangzh/rdp-release-kit
base=https://github.com/$KIT/releases/download/$tag
kit=$(curl -fsSL "$base/KIT_COMMIT")
git clone -q "https://github.com/$KIT.git" "$dir"
git -C "$dir" -c advice.detachedHead=false checkout -q "$kit"
mkdir -p "$dir/dist/xrdp/debian-13"
auth=${GH_TOKEN:+Authorization: Bearer $GH_TOKEN}
for name in $(curl -fsSL ${auth:+-H "$auth"} "https://api.github.com/repos/$KIT/releases/tags/$tag" |
        python3 -c 'import json,sys; print(" ".join(a["name"] for a in json.load(sys.stdin)["assets"] if a["name"].endswith(".deb")))'); do
    curl -fsSL -o "$dir/dist/xrdp/debian-13/$name" "$base/$name"
done
echo "kit-test.sh: the kit at ${kit%"${kit#????????????}"} in $dir/, with $(find "$dir/dist/xrdp/debian-13" -name "*.deb" | wc -l) packages of $tag"
