#!/bin/bash
# A Wayland desktop behind xrdp's wlup module, for test-screens-wlup.mjs: headless GNOME
# Shell (wlup's Mutter backend) or KDE Plasma (its KWin backend) in a container whose PID 1 is
# systemd, xrdp built from an xrdp source tree with wlup, and websockify in front of it
# (idempotent: an existing container is replaced).
#
#   ./start-wlup-xrdp.sh <xrdp source dir> [gnome|kde, default gnome] [gateway port, default 6091]
#
# The images are xrdp's wlup test beds (xrdp-wlup-mutter, xrdp-wlup-kde, built by the xrdp
# tree's wlup/test/run-all.sh). xrdp is built and set up by the first part of that tree's e2e
# script for the desktop (up to its RDP client): the user is tester, the password
# wlup-test-pw. KWin before 6.8 needs a DRM render node to cast (without a GPU: sudo modprobe
# vgem). Container: xrdp-wlup-web; RDP on 127.0.0.1:13499; logs in ./out/wlup-xrdp/.
set -eu
SRC=$(cd "$1" && pwd)
DESKTOP=${2:-gnome}
PORT=${3:-6091}
NAME=xrdp-wlup-web
HERE=$(cd "$(dirname "$0")" && pwd)
OUT=$HERE/out/wlup-xrdp
mkdir -p "$OUT"
case $DESKTOP in
    gnome) IMAGE=xrdp-wlup-mutter; E2E=$SRC/wlup/test/mutter/run-e2e-mutter.sh ;;
    kde) IMAGE=xrdp-wlup-kde; E2E=$SRC/wlup/test/kde/run-e2e-kde.sh ;;
    *) echo "desktop: gnome or kde"; exit 1 ;;
esac
grep -q "^# --- RDP client in Xvfb" "$E2E" || { echo "$E2E has no RDP client section"; exit 1; }
sed '/^# --- RDP client in Xvfb/,$d' "$E2E" > "$OUT/setup.sh"
echo 'echo SETUP-DONE' >> "$OUT/setup.sh"
docker rm -f $NAME > /dev/null 2>&1 || true
docker run -d --name $NAME --privileged --cgroupns=private --tmpfs /run --tmpfs /run/lock \
    -p 127.0.0.1:13499:3389 -v "$SRC":/src:ro -v "$OUT":/out $IMAGE \
    /usr/lib/systemd/systemd > /dev/null
sleep 5
docker exec -d $NAME bash -c 'bash /out/setup.sh /src /out > /out/setup.log 2>&1'
for _ in $(seq 120); do grep -q SETUP-DONE "$OUT/setup.log" 2>/dev/null && break; sleep 5; done
grep -q SETUP-DONE "$OUT/setup.log" || { echo "xrdp setup did not finish: $OUT/setup.log"; exit 1; }
if ! ss -ltn | grep -q "127.0.0.1:$PORT "; then
    nohup uvx websockify "127.0.0.1:$PORT" 127.0.0.1:13499 > "$OUT/websockify.log" 2>&1 &
    sleep 1
fi
echo "$DESKTOP through xrdp ready: container $NAME, gateway 127.0.0.1:$PORT"
