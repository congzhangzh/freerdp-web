#!/bin/bash
# A GNOME session behind xrdp's wlup Mutter backend, for test-screens-gnome.mjs: headless
# GNOME Shell in a container whose PID 1 is systemd, xrdp built from an xrdp source tree with
# wlup, and websockify in front of it (idempotent: an existing container is replaced).
#
#   ./start-gnome-xrdp.sh <xrdp source dir> [gateway port, default 6091]
#
# The image is xrdp's wlup GNOME test bed (xrdp-wlup-mutter, built by the xrdp tree's
# wlup/test/run-all.sh). xrdp is built and set up by the first part of that tree's
# wlup/test/mutter/run-e2e-mutter.sh (up to its RDP client): the user is tester, the password
# wlup-test-pw. Container: xrdp-gnome-web; RDP on 127.0.0.1:13499; logs in ./out/gnome-*.
set -eu
SRC=$(cd "$1" && pwd)
PORT=${2:-6091}
NAME=xrdp-gnome-web
HERE=$(cd "$(dirname "$0")" && pwd)
OUT=$HERE/out/gnome-xrdp
mkdir -p "$OUT"
E2E=$SRC/wlup/test/mutter/run-e2e-mutter.sh
grep -q "^# --- RDP client in Xvfb" "$E2E" || { echo "$E2E has no RDP client section"; exit 1; }
sed '/^# --- RDP client in Xvfb/,$d' "$E2E" > "$OUT/setup.sh"
echo 'echo SETUP-DONE' >> "$OUT/setup.sh"
docker rm -f $NAME > /dev/null 2>&1 || true
docker run -d --name $NAME --privileged --cgroupns=private --tmpfs /run --tmpfs /run/lock \
    -p 127.0.0.1:13499:3389 -v "$SRC":/src:ro -v "$OUT":/out xrdp-wlup-mutter \
    /usr/lib/systemd/systemd > /dev/null
sleep 5
docker exec -d $NAME bash -c 'bash /out/setup.sh /src /out > /out/setup.log 2>&1'
for _ in $(seq 120); do grep -q SETUP-DONE "$OUT/setup.log" 2>/dev/null && break; sleep 5; done
grep -q SETUP-DONE "$OUT/setup.log" || { echo "xrdp setup did not finish: $OUT/setup.log"; exit 1; }
if ! ss -ltn | grep -q "127.0.0.1:$PORT "; then
    nohup uvx websockify "127.0.0.1:$PORT" 127.0.0.1:13499 > "$HERE/out/gnome-websockify.log" 2>&1 &
    sleep 1
fi
echo "GNOME xrdp ready: container $NAME, gateway 127.0.0.1:$PORT"
