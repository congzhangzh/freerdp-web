# FreeRDP in the browser

A web page that runs FreeRDP's SDL3 client, compiled to WebAssembly, to
connect to an RDP server from a browser. It needs a FreeRDP build with the
Emscripten client (upstream pull requests #13728, #13731, #13732 and
#13733 at the time of writing) and keeps saved hosts in a local, passkey
protected vault ([`web/VAULT.md`](web/VAULT.md)).

A browser cannot open TCP connections, so the page talks to the RDP server
through a WebSocket gateway, [websockify](https://github.com/novnc/websockify).

## Safety

This is a hobby project, not written by security professionals. Keeping
your servers safe is up to you. What we recommend:

- **Never put RDP on the internet.** Let the RDP server listen on
  127.0.0.1 only (for xrdp: `port=tcp://.:3389` in `/etc/xrdp/xrdp.ini`)
  and reach it through SSH, which already handles keys, authentication and
  encryption.
- **Run the gateway only for the session.** While a gateway listens on
  127.0.0.1, any web page open in the same browser could connect to it.
  The RDP server still asks for its own credentials, but the gateway
  itself checks nothing.
- **Keep the gateway on 127.0.0.1**, on both ends.

### One step: SSH and websockify together

With websockify on the server (Debian/Ubuntu: `apt install websockify`,
Fedora: `dnf install python3-websockify`), one ssh command does both, and
your computer needs nothing but ssh, which Windows 10/11, macOS and Linux
include:

```sh
ssh -t -L 127.0.0.1:6080:127.0.0.1:6080 user@server websockify 127.0.0.1:6080 127.0.0.1:3389
```

Then open the page and connect with the gateway `127.0.0.1:6080` (the
default). Ctrl-C in the ssh window ends the gateway. Two details in that
line matter:

- `websockify 127.0.0.1:6080 …` listens on the server's loopback only;
  `websockify 6080 localhost:3389` would offer the bridge to the network.
- `-t` gives websockify a terminal, so it ends when you disconnect;
  without it, websockify keeps running on the server.

When the page comes from a web site (for example GitHub Pages), Chrome asks
whether the site may access other apps and services on this device. Allow
it: that is how the page reaches the gateway on 127.0.0.1 (Chrome's Local
Network Access protection; it blocks the connection otherwise, with
`ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS` in the browser console).

[`rdp-gateway.sh`](rdp-gateway.sh) runs the same line:

```sh
./rdp-gateway.sh user@server            # RDP on the server's port 3389
./rdp-gateway.sh user@server 3390       # another RDP port
```

If websockify already runs on the server (on its 127.0.0.1:6080), a plain
forward is enough: `ssh -N -L 127.0.0.1:6080:127.0.0.1:6080 user@server`.

### Without websockify on the server

`./rdp-gateway.sh --local user@server` forwards the RDP port over SSH and
runs websockify on your computer (`pip install websockify`, or `uvx` from
[uv](https://docs.astral.sh/uv/)).

## Building

`build-wasm-vault.sh` builds the WebAssembly client for the page:

```sh
docker build -t freerdp-wasm-vault-toolchain -f Dockerfile.wasm-vault .
WASM_DEPS=<dependency prefix> bash build-wasm-vault.sh <FreeRDP source dir>
python3 serve.py 8180 dist
```

`node --test web/tests/*.test.cjs` runs the vault's unit tests.
