#!/bin/sh
# Tests kit-release.sh on a made-up list of the kit's releases (no network).
#
#   ./test-kit-release.sh
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
pass=0 fail=0
# check <what> <expected output> <argument...>
check() {
    what=$1 want=$2
    shift 2
    got=$(KIT_RELEASES=$TMP/releases.json "$HERE/kit-release.sh" "$@" 2> /dev/null) || got="(fails)"
    if [ "$got" = "$want" ]; then
        echo "PASS  $what"; pass=$((pass + 1))
    else
        echo "FAIL  $what: $got, not $want"; fail=$((fail + 1))
    fi
}

P=aaaaaaaaaaaa1111 Q=bbbbbbbbbbbb2222
cat > "$TMP/releases.json" << EOF
[
 {"tag_name": "web-${P%????}-cccccccccccc", "draft": true, "published_at": "2026-10-26T10:00:00Z", "body": ""},
 {"tag_name": "web-${P%????}-someone-else", "draft": false, "published_at": "2026-10-25T10:00:00Z", "body": ""},
 {"tag_name": "web-${P%????}-dddddddddddd", "draft": false, "published_at": "2026-10-22T10:00:00Z", "body": "WITHDRAWN: broke the login; use web-${P%????}-eeeeeeeeeeee"},
 {"tag_name": "web-${P%????}-eeeeeeeeeeee", "draft": false, "published_at": "2026-10-21T10:00:00Z", "body": "built"},
 {"tag_name": "xrdp-preview-ffffffffffff-eeeeeeeeeeee", "draft": false, "published_at": "2026-10-23T10:00:00Z", "body": ""},
 {"tag_name": "web-${P%????}", "draft": false, "published_at": "2026-10-19T10:00:00Z", "body": "before the freeze"},
 {"tag_name": "web-${Q%????}", "draft": false, "published_at": "2026-10-20T10:00:00Z", "body": ""},
 {"tag_name": "web-not-a-commit", "draft": false, "published_at": "2026-10-24T10:00:00Z", "body": ""}
]
EOF

check "newest: the newest published web-*, not withdrawn, not a draft" "web-${P%????}-eeeeeeeeeeee"
check "a page commit: its newest build" "web-${P%????}-eeeeeeeeeeee" "$P"
check "a short commit works too" "web-${P%????}-eeeeeeeeeeee" aaaaaaa
check "a commit with only the older name" "web-${Q%????}" "$Q"
check "a commit the kit never built" "(fails)" 0123456789ab
check "not a commit" "(fails)" 'web-x;rm'
echo '[]' > "$TMP/releases.json"
check "no releases at all" "(fails)"

echo "passed $pass, failed $fail"
[ "$fail" = 0 ]
