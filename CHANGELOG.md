# Changes

The version is the one in `web/.well-known/manifest.webmanifest`; the page shows it in the
session's Info panel. An installed app (IWA) updates only to a newer version. The WASM
client itself is built and versioned by
[rdp-release-kit](https://github.com/congzhangzh/rdp-release-kit); its `MANIFEST` file names
the FreeRDP commit and this page's commit.

## 0.2.0

The page is ready to use without reading anything first.

- **Three fields and Connect.** Gateway, user and password in a real form, so the browser's
  password manager saves and fills the password. The black canvas appears only once the
  session starts.
- **The route at the top**: browser, gateway, SSH, RDP server, and the one-line `ssh`
  command that builds it, with a Copy button.
- **Session settings**: sound, clipboard, full screen, the video codec (Automatic,
  AV1 4:2:0, AV1 4:4:4) and a priority (Save bandwidth, or Reduce server load). Extra
  options of the same kind still win. The microphone is shown as not in this build.
- **Advanced**: Direct TCP for the installed app, the passkey vault, Extra options with the
  exact options the client gets. The vault is now **off by default** (it starts on where a
  vault already exists); turning it off locks it and keeps the encrypted hosts.
- **Keyboard**: an mstsc shortcut profile next to FreeRDP's (Ctrl + Alt + Break full screen,
  Ctrl + Alt + Home toolbar, Ctrl + Alt + End sends Ctrl + Alt + Delete).
- **Help pages**: Safety and tunnels, Keyboard, and a restyled Install as app.
- Saved settings move over: Extra options that held only the old default `/gfx:AV1:i444`
  become the Video setting AV1 4:4:4.
- `test-page.mjs` tests the page with a built client and no server.

## 0.1.x

The first public page: the SDL3 FreeRDP client in WebAssembly through a websockify
gateway, Direct TCP in an Isolated Web App, the passkey vault, clipboard text and images,
full screen with Keyboard Lock, the session toolbar and Info panel, the saved log of a
session that ended unexpectedly, and the isolation service worker for GitHub Pages.
