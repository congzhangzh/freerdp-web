# Changes

The version is the one in `web/.well-known/manifest.webmanifest`; the page shows it in the
session's Info panel. An installed app (IWA) updates only to a newer version. The WASM
client itself is built and versioned by
[rdp-release-kit](https://github.com/congzhangzh/rdp-release-kit); its `MANIFEST` file names
the FreeRDP commit and this page's commit.

## 0.4.12

- **"Save the password?" after connecting, as on a phone.** After a connection with a typed
  password the page offers to keep it in the passkey vault: *Save with passkey*, *Not now*,
  or *Never for this host*. It appears 2 s after the client logs `gdi_init_ex … Remote
  framebuffer format`, the end of the connection sequence (with NLA, the server has accepted
  the password by then), unless the connection failed. Safari also asks on submit, without
  knowing whether the sign-in worked. Save takes one passkey prompt. The first time, that
  prompt also creates the vault, and the host's vault option is switched on. The typed
  password waits for the answer in the page's memory only, at most two minutes (the session's
  own copy is in the client anyway). A different password for a host with a saved one is
  offered as an update; a password from the vault gets no offer. Never for this host is
  stored with the host (`vaultNever`) and cleared when its vault option is switched on again. The offer, like the capture notice, sits below the session toolbar, in full screen too.
  A first version put both at the top of the full screen, where the offer covered the toolbar's
  buttons for up to 30 s. `test-toolbar.mjs` found it (the Window and 📌 clicks landed on the
  offer) and now checks that nothing covers the toolbar's buttons.
- **Creating the vault takes one passkey prompt instead of two** where the passkey evaluates
  the PRF while it is created (WebAuthn `prf.eval` in `create()`). Before, `create()` only
  enabled the PRF, and a second `get()` read the value. The early value is used only when
  the creation's authenticator data has the user-verified flag; otherwise the second prompt
  runs as before. The new `test-vault-save.mjs` checks against xrdp with Chrome's virtual
  authenticator: a typed password is offered; Save creates the vault with one ceremony
  (`credentialAdded`, no assertion); after a reload, Connect with an empty password unlocks
  it with one ceremony and xrdp's log records the login; a different typed password is
  offered as an update; Never for this host stops the offer. The unit tests check that the
  value from creation unlocks the same vault later, and that it is ignored without user
  verification.

## 0.4.11

- **Remote scale: Automatic, 100, 125, 150 or 200 %** (Session settings). Automatic is the
  0.4.7 behaviour: the screen's scale goes with the connection and with every later display
  layout. A number is sent instead, as `/scale-desktop:<n>`, at connect and with every layout,
  so a resize or full screen never changes it. A `/scale` or `/scale-desktop` in Extra options
  still wins. Whether the server follows is its own business. gnome-remote-desktop hands the
  client's scale to Mutter only from GNOME 50 on (`org.gnome.preferred-scale` on the virtual
  monitor's PipeWire stream, GRD commit 6ae3a98). GNOME 48 ignores it: against the release
  kit's GNOME container (GRD 48.1) the client sent DesktopScaleFactor=200 in every layout and
  Mutter's DisplayConfig kept scale 1.0. Checked with the new `test-fs-connect.mjs` at device
  pixel ratio 2: Automatic sends 200 in every layout, and 100 % sends `/scale-desktop:100` and
  100 in every layout, through Full screen → Window → Full screen.
- **"Full screen" at Connect starts the session at the screen's size.** macOS animates into
  full screen, and the window keeps growing for most of a second after the request. The page
  measured the canvas two frames in, so the session started smaller (2560 × 1520 where the
  screen is 2880 × 1800) and was resized right after. The page now waits until the window
  size has held still for 150 ms (at most 1.5 s) before measuring. `test-fs-connect.mjs`
  grows the window in 40 ms steps after the request: `/size` was 2560x1520 before and is
  2880x1800 now.

## 0.4.10

- **Capture: the mouse and the keyboard stay with the remote desktop until Ctrl + Alt.** In
  full screen a click on the remote desktop captures them (the click still reaches it); in a
  window, the toolbar's new Capture button does. The mouse is held with Pointer Lock, the
  keyboard (full screen only) with Keyboard Lock as before. Ctrl + Alt, pressed and released
  with no other key in between, releases both and shows the toolbar; full screen stays. Only
  the left Alt counts, because Windows reports AltGr as Ctrl + right Alt (French and German
  keyboards type @ and € with it), and Ctrl + Alt + End or any other Ctrl + Alt shortcut does
  not release. SDL is not told about the lock: SDL treats a locked mouse as relative, while
  the RDP server wants absolute positions. The page instead moves its own cursor by the
  lock's `movementX/Y`, clamps it to the remote desktop and hands SDL ordinary mouse events
  at that position (the `pointerlockchange` event is stopped at the window, as
  `fullscreenchange` is). It draws the remote pointer's image there, which is the canvas's
  CSS cursor that SDL sets and the browser hides under the lock. A short notice says how to
  release, and the toolbar's grip steps aside while the mouse is captured. The new
  `test-capture.mjs` checks against xrdp: Capture locks; ten relative moves of (12, 7) move the
  page's cursor by (120, 70) and the session's X pointer (XQueryPointer) to the same spot
  within a pixel; the cursor stops at the edge; Ctrl + Alt + X and Ctrl + right Alt keep the
  capture; a Ctrl + Alt tap releases; in full screen a click captures and Ctrl + Alt releases
  while full screen stays.

## 0.4.9

- **Cmd + Tab on a Mac no longer leaves the remote side with a pressed Super key or opens
  its Activities / Start menu; Cmd + letter no longer leaves the letter pressed.** macOS keeps
  Cmd + Tab and Cmd + Space for itself even with Keyboard Lock, so the page saw Cmd's keydown
  and then only a blur. The remote side had already got Super down; SDL releases every key on
  blur (`SDL_ResetKeyboard` in `Emscripten_HandleFocus`), which made it a Super tap: GNOME's
  Activities overview, the Windows Start menu. Now the page holds Cmd back until a key, a click
  or the wheel needs it (Cmd + C still arrives as Super + C) and sends a lone Cmd tap as a tap.
  macOS also sends no keyup for a key released while Cmd is down, so the remote side kept the
  letter of Cmd + C pressed and repeated it; when Cmd goes up, the page now releases the keys
  pressed with it. The new `test-meta.mjs` reads the remote X server's pressed keys
  (XQueryKeymap, `test-keymap.py`) in the CI xrdp session: before, Super_L was held while Cmd
  was down and `c` stayed held after Cmd + C; now nothing is held after any of the three
  cases (Cmd then blur, Cmd + C without C's keyup, Cmd tapped), and `test-keys.mjs` still
  types its whole line exactly. The test scripts take the page's URL from `PAGE`.

## 0.4.8

- **The full-screen toolbar comes back only where it is, after a short rest.** Until now any
  mouse move to the top 4 pixels showed it, also in the corners, where the remote desktop has
  a maximized window's close button and its menus; every quick move there pulled the toolbar
  down over them. Now the mouse has to rest 300 ms at the top edge right above the toolbar (its
  width plus 40 px on each side), and the toolbar hides 600 ms after the mouse moves more than
  60 px away from it, instead of on a fixed 2.5 s timer (Ctrl + Alt + Home, which shows it from
  the keyboard, keeps that timer). A small grip at the top centre marks the spot while it is
  hidden; clicks go through the grip to the remote side. Checked with `test-toolbar.mjs`
  against xrdp: both corners leave it hidden, 100 ms above it too, 500 ms shows it, moving
  away hides it again.

## 0.4.7

- **The screen's scale goes to the server when connecting.** The page already asks for the
  desktop in device pixels (`/size` = the canvas × `devicePixelRatio`) but sent no scale, so
  the connection's core data said 100 %; only FreeRDP SDL's first display layout carried the
  real one (200 on a Retina screen). A scale-aware server, such as gnome-remote-desktop with a
  headless or virtual monitor (its `org.gnome.preferred-scale`) or Windows, could start the
  session at 100 % and switch to 200 % moments later. Above 100 % the page now adds
  `/scale-desktop:<devicePixelRatio × 100>`, at most 500. FreeRDP then keeps that scale for the
  session's later layouts too (`FREERDP_MONITOR_OVERRIDE_DESKTOP_SCALE`): zooming the browser
  during a session changes the size, not the scale. At 100 % nothing changes, and a
  `/scale-desktop` or `/scale` in Extra options wins. Checked with the kit's client against
  xrdp in headless Chrome: ratio 2 passes `/scale-desktop:200` and the session starts at
  2946 × 1916; ratio 1 passes no scale.

## 0.4.6

- **Full screen during a session keeps the whole remote desktop** (seen on macOS). SDL 3.2
  treats the page's `fullscreenchange` as its own full screen and then ignores window resizes
  (`Emscripten_HandleResize` returns early for a full-screen window). Where the window grows
  after that event, as with macOS's full-screen animation, the canvas and the remote desktop
  kept the old size: the picture was shifted and cut off. The page now stops the event at the
  `window` (capture phase), before SDL's listener on the `document`, so SDL follows the canvas
  size in every order of events. Checked in headless Chrome at device pixel ratio 1 and 2:
  windowed then full screen, and a window that grows after full screen, both follow the
  screen (3024 × 1964 at ratio 2 on a 1512 × 982 viewport). Upstream SDL `main` resizes
  full-screen windows too, so this is no longer needed once the kit's SDL has that.

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
