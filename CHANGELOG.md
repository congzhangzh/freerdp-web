# Changes

The version is the one in `web/.well-known/manifest.webmanifest`; the page shows it in the
session's Info panel. An installed app (IWA) updates only to a newer version. The WASM
client itself is built and versioned by
[rdp-release-kit](https://github.com/congzhangzh/rdp-release-kit); its `MANIFEST` file names
the FreeRDP commit and this page's commit.

## 0.4.5

- One header for every page: the title "FreeRDP Web" (a link home, styled as the title, no
  longer a blue link on the help pages), then ▶ Intro (on help pages `index.html#intro`, which
  opens the splash), the help pages, Release notes and the theme, in one row: both page types
  are 760 px wide now.

## 0.4.4

- `web/release-notes.html`: release notes for users (what changed for them, plainly), linked
  before the theme switch on every page. This file stays the developer view.
- The header's items (▶ Intro, links, theme select) share one style: same height, padding,
  colour; a frame on hover; the current page highlighted; the select with a caret, no box.

## 0.4.3

- The SSH lines use `ssh -tt` (was `-t`): websockify always gets a terminal on the server, so it
  stops when the connection ends, even when ssh was started without a terminal.

## 0.4.2

- **The safety notice's SSH line** keeps the server side fixed (websockify on the server's
  3390, next to RDP on 3389); only the local end follows the Gateway field. With a gateway on
  127.0.0.1:13390 it reads `ssh -t -L 127.0.0.1:13390:127.0.0.1:3390 … websockify 127.0.0.1:3390 127.0.0.1:3389`.
- A saved host still on the old default gateway (127.0.0.1:6080) moves to 127.0.0.1:3390, once.
- **▶ Intro** in the header shows the demo videos again.

## 0.4.1

- **The gateway's default port is 3390**, next to RDP's 3389 (was 6080): the safety notice's
  SSH line, a new host, the help pages and `rdp-gateway.sh`. Hosts you saved keep their
  address.

## 0.4.0

- **A splash on the first visit**: two one-minute demos, xrdp + Xfce and gnome-remote-desktop
  + GNOME Wayland, with web video, WebGL and sound on the remote desktop. Skip closes it;
  the header's *Demo* shows it again. The videos are downloaded only when played.
- **Theme**: System, Light or Dark, in the header of every page, remembered.
- **A new home**: the site is published from this repository's own Pages
  (`congzhangzh.github.io/freerdp-web/`); the old address redirects here, and your saved
  hosts come along (same origin).

## 0.3.0

- **Hosts.** A bar under the safety notice lists your hosts; the form, Session settings
  and Advanced edit the selected one. New host, Duplicate, Delete. Your 0.2 settings become
  the first host.
- **The passkey vault is per host:** Advanced → *Keep this host's password in the passkey
  vault*. Connect unlocks it when needed. Hosts of the old vault list join the bar.
- **Export and import** the hosts as a file, with the vault's passwords if you tick it,
  encrypted with a passphrase if you tick it.
- Connect no longer waits for a frame that a hidden tab never draws.

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
- **The remote desktop fills the window.** In a window (not full screen) it was drawn at
  800 × 600 and scaled, because the client writes that size on the canvas; 0.1.x had this
  too. The page now owns the canvas size in both modes.
- `test-page.mjs` tests the page with a built client and no server.

## 0.1.x

The first public page: the SDL3 FreeRDP client in WebAssembly through a websockify
gateway, Direct TCP in an Isolated Web App, the passkey vault, clipboard text and images,
full screen with Keyboard Lock, the session toolbar and Info panel, the saved log of a
session that ended unexpectedly, and the isolation service worker for GitHub Pages.
