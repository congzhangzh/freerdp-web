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
# the names by date (since 21 October 2026): the page commit is in the title
R=cccccccccccc3333
cat > "$TMP/dated.json" << EOF
[
 {"tag_name": "web-20261022.2-999999999999", "name": "Web client for freerdp-web ${R%????} (kit 999999999999)", "draft": true, "published_at": null, "body": ""},
 {"tag_name": "web-20261022.1-888888888888", "name": "Web client for freerdp-web ${R%????} (kit 888888888888)", "draft": false, "published_at": "2026-10-22T09:00:00Z", "body": "WITHDRAWN: no; use web-20261021.2-777777777777"},
 {"tag_name": "web-20261021.2-777777777777", "name": "Web client for freerdp-web ${R%????} (kit 777777777777)", "draft": false, "published_at": "2026-10-21T12:00:00Z", "body": "built"},
 {"tag_name": "web-20261021.1-666666666666", "name": "Web client for freerdp-web ${P%????} (kit 666666666666)", "draft": false, "published_at": "2026-10-21T08:00:00Z", "body": "built"},
 {"tag_name": "web-20261021.3-555555555555", "name": "something else", "draft": false, "published_at": "2026-10-21T13:00:00Z", "body": ""},
 {"tag_name": "web-${P%????}-eeeeeeeeeeee", "draft": false, "published_at": "2026-10-20T10:00:00Z", "body": "built"}
]
EOF
cp "$TMP/dated.json" "$TMP/releases.json"
check "dated names: the newest published, not withdrawn, not a draft" "web-20261021.2-777777777777"
check "dated names: a page commit, found by the title" "web-20261021.2-777777777777" "$R"
check "dated names: newer than an older name of the same page" "web-20261021.1-666666666666" "$P"
check "dated names: a title that names no page is not a web client" "(fails)" 555555555555
# since 28 October 2026 the key is a line in the notes, and the title ends with the tag
S=dddddddddddd4444
cat > "$TMP/releases.json" << EOF
[
 {"tag_name": "web-20261028.3-444444444444", "name": "Web client web-20261028.3-444444444444", "draft": false, "published_at": "2026-10-28T12:00:00Z", "body": "built\n\n<!-- kit-key: Web client for freerdp-web ${S%????} (kit 444444444444) -->"},
 {"tag_name": "web-20261028.2-333333333333", "name": "Web client web-20261028.2-333333333333", "draft": false, "published_at": "2026-10-28T13:00:00Z", "body": "WITHDRAWN: no\n\n<!-- kit-key: Web client for freerdp-web ${S%????} (kit 333333333333) -->"},
 {"tag_name": "web-20261028.1-222222222222", "name": "Web client web-20261028.1-222222222222", "draft": false, "published_at": "2026-10-28T10:00:00Z", "body": "built"}
]
EOF
check "keyed notes: a page commit, found by the key in the notes" "web-20261028.3-444444444444" "$S"
check "keyed notes: no key, no page" "(fails)" 222222222222
echo '[]' > "$TMP/releases.json"
check "no releases at all" "(fails)"

echo "passed $pass, failed $fail"
[ "$fail" = 0 ]
