#!/bin/sh
# One step from the web page to an RDP server, through SSH:
#
#   ./rdp-gateway.sh user@server [RDP port on the server, default 3389]
#
# runs, in one ssh command:
#
#   ssh -t -L 127.0.0.1:6080:127.0.0.1:6080 user@server \
#       websockify 127.0.0.1:6080 127.0.0.1:3389
#
# so websockify runs on the server, next to the RDP server, and this side
# needs nothing but ssh (built into Windows 10/11, macOS and Linux; the
# line above also works by hand there). The page connects to
# 127.0.0.1:6080, its default gateway. Two details matter:
#   - websockify listens on the server's 127.0.0.1 only; "websockify 6080
#     localhost:3389" would offer the bridge to the whole network
#   - -t gives it a terminal, so it ends with the connection (without it,
#     websockify keeps running on the server after you disconnect)
# The RDP server itself can then listen on 127.0.0.1 only too (for xrdp:
# port=tcp://.:3389 in /etc/xrdp/xrdp.ini). The server needs websockify
# (Debian/Ubuntu: apt install websockify; Fedora: dnf install python3-websockify).
#
# Without websockify on the server, run it on this side instead:
#
#   ./rdp-gateway.sh --local user@server [RDP port]
#
# Stop the gateway (Ctrl-C) when the session is over: while it runs, any
# web page open in this browser could connect to 127.0.0.1:6080 too. The
# RDP server still asks for its credentials, but the gateway checks nothing.
#
# Environment: WS_PORT (the page's gateway port, default 6080),
# SERVER_WS_PORT (websockify's port on the server, default WS_PORT; e.g.
# WS_PORT=13390 SERVER_WS_PORT=3390), TUN_PORT (--local: local end of the
# SSH forward, default WS_PORT + 1), SSH_OPTS (more ssh options, e.g.
# "-p 2222 -i ~/.ssh/id_ed25519").
set -eu

LOCAL=no
if [ "${1:-}" = --local ]; then
    LOCAL=yes
    shift
fi
TARGET=${1:?usage: $0 [--local] user@server [RDP port]}
RDP_PORT=${2:-3389}
WS_PORT=${WS_PORT:-6080}
SERVER_WS_PORT=${SERVER_WS_PORT:-$WS_PORT}
TUN_PORT=${TUN_PORT:-$((WS_PORT + 1))}
SSH_OPTS=${SSH_OPTS:-}

if [ "$LOCAL" = no ]; then
    echo "gateway for the page: 127.0.0.1:$WS_PORT (websockify on $TARGET:$SERVER_WS_PORT; Ctrl-C to stop)"
    # -tt: the remote websockify gets a terminal, so it gets SIGHUP and ends
    # with the connection, and Ctrl-C reaches it
    # shellcheck disable=SC2086 # SSH_OPTS holds several words on purpose
    exec ssh -tt -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 $SSH_OPTS \
        -L "127.0.0.1:$WS_PORT:127.0.0.1:$SERVER_WS_PORT" "$TARGET" \
        "exec websockify 127.0.0.1:$SERVER_WS_PORT 127.0.0.1:$RDP_PORT"
fi

if command -v websockify > /dev/null; then
    WEBSOCKIFY=websockify
elif command -v uvx > /dev/null; then
    WEBSOCKIFY="uvx websockify"
else
    echo "websockify not found: pip install websockify (or install uv and use uvx)" >&2
    exit 1
fi

# ssh goes to the background only once the forward is up, and the control
# socket closes it again when websockify ends
SOCK=$(mktemp -u "${TMPDIR:-/tmp}/rdp-gateway.XXXXXX")
# shellcheck disable=SC2086
ssh -f -N -M -S "$SOCK" -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 $SSH_OPTS \
    -L "127.0.0.1:$TUN_PORT:127.0.0.1:$RDP_PORT" "$TARGET"

# websockify runs as a child the script waits for: a signal interrupts the
# wait (a foreground child would delay the traps until it ended)
WS_PID=
# shellcheck disable=SC2329 # called by the EXIT trap
stop() {
    [ -z "$WS_PID" ] || kill "$WS_PID" 2> /dev/null || true
    ssh -S "$SOCK" -O exit "$TARGET" 2> /dev/null || true
}
trap stop EXIT
trap 'exit 130' INT TERM HUP

echo "gateway for the page: 127.0.0.1:$WS_PORT -> $TARGET:$RDP_PORT over SSH (Ctrl-C to stop)"
$WEBSOCKIFY "127.0.0.1:$WS_PORT" "127.0.0.1:$TUN_PORT" &
WS_PID=$!
# websockify only ends on its own when something is wrong (it exits 0 even
# when 127.0.0.1:$WS_PORT is already taken): a stop by the user exits above
wait "$WS_PID" || true
echo "websockify stopped (is 127.0.0.1:$WS_PORT already in use? set WS_PORT)" >&2
exit 1
