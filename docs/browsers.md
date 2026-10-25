# Browsers: what the page needs, and what is lost without it

The page runs FreeRDP's client compiled to WebAssembly. Each web feature below is one the
client or the page depends on; where a browser lacks one, only what depends on it stops
working. **Tested** means CI and the published site's check run it there; that is Chrome
today. Other browsers are what the code is written for, not yet run by CI.

| Feature the page uses | What it is for | Without it | Tested |
|---|---|---|---|
| WebAssembly threads (`SharedArrayBuffer`, cross-origin isolation) | the client's threads: network, decoding, sound | the client does not start. GitHub Pages cannot send the COOP/COEP headers isolation needs, so `coi-serviceworker.js` adds them; a browser that blocks service workers (some private modes) cannot isolate the page | Chrome |
| WebSocket | the only way out of a browser: RDP goes through a WebSocket gateway (`rdp-gateway.sh`) | nothing connects; every current browser has it | Chrome |
| Access to the gateway on `127.0.0.1` from an https page | the one-step gateway (`ssh … websockify`) listens on this machine | Chrome's Local Network Access protection asks once whether the site may reach apps on this device: allow it. A browser that refuses local addresses needs the gateway on another host | Chrome |
| WebCodecs `VideoDecoder` (AV1, H.264) | hardware or platform video decoding | AV1 is decoded by dav1d inside the client instead (slower, more CPU). H.264 has no fallback: the web build has neither OpenH264 nor FFmpeg, so a session then needs AV1 or another codec the server offers | Chrome |
| WebAuthn with the PRF extension | the passkey vault: a passkey's PRF output wraps the vault's key ([VAULT.md](../web/VAULT.md)) | no vault: a passkey provider without PRF is refused when it is added, and the vault cannot be created with it. Connecting with a typed password still works | Chrome (virtual authenticator) |
| Web Audio | the session's sound | no sound | Chrome |
| `getUserMedia` | the microphone | no microphone. It needs a secure context: the published https page or `localhost` | Chrome |
| The asynchronous Clipboard API (read and write) | copy and paste between this computer and the session | browsers guard clipboard reading differently: Chrome asks for permission; where reading is refused, text copied here does not reach the session, while copying from the session still works | Chrome |

Two builds of the client, one picked per browser: **JSPI** (WebAssembly's JavaScript Promise
Integration) where the browser has it, **Asyncify** everywhere else. The client has to
suspend itself while it waits (for the network, a dialog, a timer); Asyncify rewrites the
whole program so it can, JSPI lets the browser do it, so the JSPI build is smaller (6.8 MB
against 10.5 MB) and runs without the rewrite's overhead. `web/engine.js` loads `jspi/` when
`WebAssembly.Suspending` exists (Chrome 137 and newer today; Firefox and Safari have it in
their previews), and the session's **Info** panel names the build on its *Client build* line.
`?engine=asyncify` or `?engine=jspi` forces one. JSPI used to hang after a network drop; the
release kit's SDL pin fixed that (SDL's Emscripten windows, 3.4.18), and both builds pass the
same tests.

If a browser misses something not listed here, the page's log (the Log panel) shows the
error; please open an issue with it and the browser's version.
