#!/bin/sh
# A ready-to-run site from this checkout's page and a client someone already built, so
# work on the page never waits for a WebAssembly build:
#
#   ./site.sh                     the client of the release kit's newest pre-release (web-*)
#   ./site.sh kit:<page commit>   the client the kit built and tested for that page commit
#                                 (its newest build of it: kit-release.sh)
#   ./site.sh <dir>               a local client, e.g. ../rdp-release-kit/dist/wasm/web
#
# The site goes to dist/site/ (SITE=<dir> for another place): the client (sdl-freerdp.js,
# .wasm, licenses, MANIFEST), this checkout's web/ over it, and the demo videos of the
# splash (NO_MEDIA=1 leaves them out). Downloads are checked against their SHA-256 and kept
# in ~/.cache/freerdp-web, so the next run is instant. Then:
#
#   python3 serve.py 8180 dist/site       open http://localhost:8180
#   node test-page.mjs dist/site          the page with that client, in Chrome
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
SITE=${SITE:-$HERE/dist/site}
CACHE=${XDG_CACHE_HOME:-$HOME/.cache}/freerdp-web
KIT=congzhangzh/rdp-release-kit
FROM=${1:-kit}

case $FROM in
kit | kit:*)
    # the kit never replaces a pre-release's files, so one download per tag is enough
    if [ "$FROM" = kit ]; then
        tag=$("$HERE/kit-release.sh")
    else
        tag=$("$HERE/kit-release.sh" "${FROM#kit:}")
    fi
    dir=$CACHE/kit/$tag
    mkdir -p "$dir"
    if ! (cd "$dir" && sha256sum -c --quiet freerdp-web-page.zip.sha256 2> /dev/null); then
        echo "== the kit's tested client: $tag" >&2
        base=https://github.com/$KIT/releases/download/$tag
        curl -fsSL -o "$dir/freerdp-web-page.zip.sha256" "$base/freerdp-web-page.zip.sha256"
        curl -fsSL -o "$dir/freerdp-web-page.zip" "$base/freerdp-web-page.zip"
        (cd "$dir" && sha256sum -c --quiet freerdp-web-page.zip.sha256)
    fi
    rm -rf "${SITE:?}"; mkdir -p "$SITE"
    (cd "$SITE" && python3 -m zipfile -e "$dir/freerdp-web-page.zip" .)
    client="$tag ($(sed -n 's/^page: //p' "$SITE/MANIFEST"))"
    echo "$tag" > "$SITE/CLIENT"   # which of the kit's pre-releases the client came from
    ;;
*)
    [ -f "$FROM/sdl-freerdp.wasm" ] || { echo "no client in $FROM (sdl-freerdp.wasm)" >&2; exit 1; }
    src=$(cd "$FROM" && pwd)
    rm -rf "${SITE:?}"; mkdir -p "$SITE"
    cp -r "$src/." "$SITE/"
    client=$src
    ;;
esac

# this checkout's page over the client's
cp -r "$HERE/web/." "$SITE/"
rm -rf "$SITE/tests"
rev=$(git -C "$HERE" rev-parse HEAD 2> /dev/null || echo "?")
git -C "$HERE" diff --quiet HEAD 2> /dev/null || rev="$rev, with uncommitted changes"
printf '\npage from site.sh: this checkout, %s\n' "$rev" >> "$SITE/MANIFEST"

[ -n "${NO_MEDIA:-}" ] || "$HERE/fetch-media.sh" "$SITE" > /dev/null
echo "site: $SITE"
echo "  client: $client"
echo "  page:   this checkout ($rev)"
echo "  serve:  python3 serve.py 8180 $SITE    test: node test-page.mjs $SITE"
