# FreeRDP in the browser

A web page that runs FreeRDP's SDL3 client, compiled to WebAssembly, to
connect to an RDP server from a browser. It needs a FreeRDP build with the
Emscripten client (upstream pull requests #13728, #13731, #13732 and
#13733 at the time of writing) and keeps saved hosts in a local, passkey
protected vault ([`web/VAULT.md`](web/VAULT.md)).

A browser cannot open TCP connections, so the page talks to the RDP server
through a WebSocket gateway, [websockify](https://github.com/novnc/websockify).

## The page

It runs at **https://congzhangzh.github.io/freerdp-web/**, published from this repository
only on purpose (a `v*` tag, or *Run workflow* with **publish**): [docs/hosting.md](docs/hosting.md).

Open it, enter the gateway, user and password, and connect: the browser's password
manager keeps the password. The bar above the form keeps your hosts, each with its own
settings, and exports or imports them as a file (passwords only if you ask, encrypted with
a passphrase if you ask). **Session settings** choose sound, clipboard, the video codec
and a priority (save bandwidth, or reduce server load); **Advanced** holds Direct TCP for
the installed app, the passkey vault and free-form FreeRDP options. The help pages
(`safety.html`, `keyboard.html`, `install.html`) sit next to it.

Why it looks and behaves this way: [docs/webui-design.md](docs/webui-design.md). Where it
is published, and why only on purpose: [docs/hosting.md](docs/hosting.md).

## Safety

This is a hobby project, not written by security professionals. Keeping
your servers safe is up to you. The page's **Safety and tunnels** help
([`web/safety.html`](web/safety.html)) has the details; in short:

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
ssh -tt -L 127.0.0.1:3390:127.0.0.1:3390 user@server websockify 127.0.0.1:3390 127.0.0.1:3389
```

Then open the page and connect with the gateway `127.0.0.1:3390` (the
default). Ctrl-C in the ssh window ends the gateway. Two details in that
line matter:

- `websockify 127.0.0.1:3390 …` listens on the server's loopback only;
  `websockify 3390 localhost:3389` would offer the bridge to the network.
- `-tt` always gives websockify a terminal (even when ssh has none), so it gets
  the hang-up signal and ends when the connection ends;
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

If websockify already runs on the server (on its 127.0.0.1:3390), a plain
forward is enough: `ssh -N -L 127.0.0.1:3390:127.0.0.1:3390 user@server`.

### Without websockify on the server

`./rdp-gateway.sh --local user@server` forwards the RDP port over SSH and
runs websockify on your computer (`pip install websockify`, or `uvx` from
[uv](https://docs.astral.sh/uv/)).

## Working on the page

The page needs no build: `site.sh` lays this checkout's `web/` over a client someone already
built, in a second or two.

```sh
./site.sh                                  # the release kit's newest tested client (cached)
./site.sh kit:<page commit>                # the client the kit built for that page commit
./site.sh ../rdp-release-kit/dist/wasm/web # a local build of the kit
python3 serve.py 8180 dist/site            # then open http://localhost:8180
node test-page.mjs dist/site               # or test it in Chrome
```

The kit's clients are its pre-releases `web-<page commit>-<kit commit>`, each built and tested
(a browser login to xrdp) before it is uploaded, and never replaced afterwards: a new build of
the same page is a new pre-release. [`kit-release.sh`](kit-release.sh) finds the newest one (or
the newest for a page commit); `site.sh` checks its SHA-256 and keeps it in
`~/.cache/freerdp-web`, with the splash's demo videos.

## Building

`build-wasm-vault.sh` builds the WebAssembly client for the page:

```sh
docker build -t freerdp-wasm-vault-toolchain -f Dockerfile.wasm-vault .
WASM_DEPS=<dependency prefix> bash build-wasm-vault.sh <FreeRDP source dir>
python3 serve.py 8180 dist
```

## Testing

| Test | Needs | Command |
|---|---|---|
| Unit tests: vault, connection bridge, session options, keyboard | Node 20+ | `node --test web/tests/*.test.cjs` |
| The page with the real client, no server | Node 22+, Chrome, a built client (`sdl-freerdp.js` and `.wasm`) | `node test-page.mjs <client dir>` |
| A full login: xrdp in a throwaway container, reached over SSH and websockify | Docker or Podman; the [release kit](https://github.com/congzhangzh/rdp-release-kit) with its Debian 13 xrdp packages built | `PAGE_SRC=<this checkout> ./build-wasm.sh`, then `test/wasm-session.sh dist/wasm/web <this checkout>/rdp-gateway.sh` in the kit |

`test-page.mjs` starts nothing that listens: Chrome answers the page's requests itself
(DevTools Fetch interception) with the headers the client's threads need, and the
connection goes to a port where nothing listens. Its screenshots and log go to `out/`.
The client directory can be the release kit's `dist/wasm/web` or an unpacked
`freerdp-web-*.zip` from its releases. Changes: [CHANGELOG.md](CHANGELOG.md).
