# Changes

The version is the one in `web/.well-known/manifest.webmanifest`; the page shows it in the
session's Info panel. An installed app (IWA) updates only to a newer version.

Since 20261021.1 the version is the release date and that day's release number,
`<YYYYMMDD>.<N>` (the tag too; `v<YYYYMMDD>.<N>` before 20261025.1): the page is released
continuously, so the date says how new it is, and the number orders two releases of one day. It stays numeric with
at most four parts, as installed apps require, and is higher than every 0.4.x. The WASM
client itself is built and versioned by
[rdp-release-kit](https://github.com/congzhangzh/rdp-release-kit); its `MANIFEST` file names
the FreeRDP commit and this page's commit.

How fast the client is, measured, and why: [20261025.1](#202610251), the JSPI build (a
35 % smaller download, connects about 30 % sooner, half the processor time or less while
idle).

## 20261027.1

- **A session that ended cleanly ends in the page too, and Reconnect works after it**: in a
  browser FreeRDP's client does not exit after a clean end, a logoff (the server ending the
  session, `ERRINFO_LOGOFF_BY_USER`) or its Disconnect hotkey. It closes its window (the canvas
  goes 0 × 0) and the runtime never exits, so the page never heard of the end: the picture went
  blank, no end bar showed, and Reconnect, which waits for that exit, did nothing. 5 s after
  such an end the page ends the session itself (the end bar), and Reconnect starts a new
  client. Why the client stays is not known yet (it looks like a thread that never ends).
  test-reconnect has a third case: the server logs the session off, then Reconnect from the
  end bar; the page before fails it.
- **The mouse and the keys come back by themselves when the session is over** (Pointer Lock,
  Keyboard Lock): the Disconnect hotkey, which now does what the toolbar's Disconnect does
  (back to the connect form), a session that ended, a refused password, or the reconnect tries
  used up. A lost connection that the page is about to retry stays captured. test-capture
  disconnects with the hotkey while captured.
- **Info: each codec's colour, and hardware or software decoding**: "AV1 4:4:4" or "AV1 4:2:0"
  from the stream's profile, H.264 by its RDP codec (AVC420 4:2:0, AVC444 4:4:4), and whether
  the browser has a hardware decoder for it (`VideoDecoder.isConfigSupported`, prefer-hardware;
  WebCodecs itself never says which one it picked). Most GPUs decode AV1 4:2:0 but not 4:4:4.
  The per-codec counts in *Video codecs* need `freerdp_web_codec_stats` in the client, which the
  FreeRDP release the kit builds does not have: that row stays "–" for now.
- Tests: `test-screens-wlup` counts KWin 6.8's xrdp output (it has no `enabled` key) and keeps
  the GNOME windows check, which fails about 1 run in 5 from a Mutter race (the release kit's
  notes); the screens and capture tests no longer leave Chrome's temporary directory behind.

## 20261026.6

- **The release kit tests All screens on its own servers**, as rungs above its one-monitor
  test, so a failure says whether the basics or the multi-monitor part broke: `test-screens`
  against its xrdp (0.10.6.1) and the xrdp preview, both modes, and `test-screens-wlup`
  against the preview's GNOME (KDE in its CI). For that the two scripts take `ENGINE`
  (`docker` or `podman`) and, the wlup one, `PASSWORD`; Chrome's temporary files go to a short
  directory of their own (under a CI workspace its socket path passed the 108 bytes a Unix
  socket allows); the second screen's xterm is white, to show on a black root with no window
  manager; on xrdp 0.10.6.1 and older two more after-Reconnect checks in separate mode are
  NOTEs (5376e6de); the wlup test waits for its terminal before All screens. ✅ the kit's runs
  of 0058ea6: xrdp 0.10.6.1 separate 19 PASS and 1 NOTE, span 18; the preview separate 20,
  span 18; GNOME 5.
- **Demo names by the xrdp they ran against** (`media.json` anchors): `xrdp-original-xfce`,
  `xrdp-preview-gnome`, `xrdp-preview-kde`, `grd-gnome`, and a new All screens clip,
  `xrdp-preview-gnome-screens` (`#xrdp-gnome-screens`). The old names and addresses still
  lead to them. The page itself is unchanged.

## 20261026.5

- **All screens: the cursor on every screen while captured**: under capture (Pointer Lock,
  which a click on the remote desktop in full screen starts) the browser hides its own cursor
  and the page draws the remote pointer itself, but only in its own window. Moved onto another
  screen, the mouse still worked there and the pointer was nowhere. The other screens' windows
  now draw it too while it is on their part of the desktop (`screen.js`, from the page's
  `view()`: the cursor's place in canvas pixels, its image and hot spot).
- **GNOME through xrdp gets a monitor per screen** (server side, the kit's xrdp preview with
  the wlup GNOME backend): Separate screens used to reach GNOME as one wide virtual monitor;
  it now gets a virtual monitor per screen, and the screen this page is on as its primary one
  (the top bar). The page is unchanged for it.

## 20261026.4

- **Reconnect keeps the session usable**: after a Reconnect (FreeRDP's own, in the same
  client) the picture stopped and the keys no longer reached the server, on one screen as on
  several; only the mouse still worked. FreeRDP's retry dialog got an SDL window of its own,
  and in a browser every SDL window draws on the page's one canvas: when the dialog closed it
  left the canvas 0 × 0 and no window with the keyboard focus. The client is now FreeRDP
  `release-20261026.3` (`cef3ddb47`), which opens no dialog window in a browser (our pull
  request #13860). test-reconnect now checks the canvas after each reconnect, test-screens
  the canvas and the second screen's keys; both fail with the previous client.
- **All screens ▾ asks for the mode**: Separate screens or One wide desktop, in a menu under
  the button, kept as the host's setting (*Session settings* shows the same choice). On a
  real pair of screens the page stayed on one wide desktop whichever mode was set in the
  form; the cause was not found in a headless browser (the page on the right-hand screen,
  the mode set before Connect: separate monitors there), and the mode is now taken from the
  click itself and logged (`[page] screens: separate screens chosen`).

## 20261026.3

- **All screens has two modes**, as mstsc and FreeRDP's clients do: **Separate screens** (the
  default, `/multimon`) gives the server a monitor per screen, so a window maximizes on one and
  is dragged to the next as on physical screens; **One wide desktop** (`/span`) is the one
  monitor of 20261026.1. Chosen in *Session settings*, **All screens**. The page splits its one
  canvas for the client through `Module.freerdpMonitors`, and the client (FreeRDP with our pull
  request) sends one monitor per screen in its display layout, also right after a
  **Reconnect** ([docs/webui-design.md](docs/webui-design.md), "All screens"). test-screens
  checks the server's RandR monitors in both modes. Known: after **Reconnect** xrdp 0.10.6.1
  keeps one wide monitor (it drops a layout with an unchanged bounding box; fixed in xrdp's
  devel, 5376e6de), and the other screens' windows lose their picture and keys (either mode).
- **The client is FreeRDP `release-20261026.2`** (`dbba4a4ce`): `release-20261026.1` plus our
  pull request #13865, the page's split of the canvas into monitors.

## 20261026.2

- **The client is FreeRDP `release-20261026.1`** (`0cae530ae`): `release-20261025.1` plus the
  MessageChannel yield, our pull request #13864. `pollset_poll`'s yield now waits on a
  MessageChannel task instead of `emscripten_sleep(0)`'s `setTimeout(0)`, which the browser
  clamps to 4 ms. Measured with a yield forced on every empty poll (an xterm scrolling random
  text, three runs each): 53–57 kB/s with `setTimeout`, 1913–2291 kB/s with the MessageChannel,
  JSPI and Asyncify alike. As shipped the yield still does not fire in this client (see
  20261025.1), so sessions measure the same as before (2009–2538 against 2363–2582 kB/s,
  within the noise); it is ready for the day it does.

## 20261026.1

- **All screens**: a new toolbar button spreads the remote desktop over every screen of this
  computer, as one desktop as wide as the screens side by side (mstsc's `/span`). Through the
  Window Management API (Chrome, Edge; the button shows where the browser sees more than one
  screen) this window goes full screen on its own screen and opens `screen.html` on each other
  one; the canvas grows to the screens' bounding box, so `/dynamic-resolution` resizes the
  remote desktop, and each window copies its part of the canvas and hands its mouse and keys
  back to SDL. **One screen**, leaving full screen or closing a window goes back. The server
  sees one large monitor, not several ([docs/webui-design.md](docs/webui-design.md), "All
  screens"). Where the page sees several screens at load, the canvas keeps its WebGL drawing
  buffer, so the other windows can read it. The IWA manifest allows `window-management`.

## 20261025.2

- **The client is FreeRDP master of 23 October** (`b2403bb99`), as the release kit's FreeRDP
  `release-20261025.1`: upstream merged four of the page's pull requests (Web Audio sound
  #13732, H.264 through WebCodecs #13812, and their JavaScript as `.js` libraries #13838,
  #13839), so the client carries two of its own now, the browser clipboard (#13733) and the
  Web Audio microphone (#13811). Among the upstream changes: the bitmap codec's null pointer
  arithmetic fixed, `RDPGFX_CAPVERSION_115` updated. The native clients of the kit build the
  same FreeRDP, which has the Opus microphone fix (#13810) that 3.32.2 lacks.
- **Published only after a login from the very files going live**: a release tag no longer
  publishes the site; it is published by hand from the tag, with the kit's client built for
  this page, and the new `login` job logs in from exactly those files (Asyncify and JSPI)
  before the deploy ([docs/hosting.md](docs/hosting.md), "Making a release, step by step").
  This is the first release published that way.

## 20261025.1

- **JSPI where the browser has it**: the release kit now links the client twice, with
  Asyncify and with JSPI (WebAssembly's JavaScript Promise Integration, `jspi/`, 6.9 MB
  against 10.6 MB, no Asyncify rewrite). `web/engine.js` loads the JSPI build when
  `WebAssembly.Suspending` exists (Chrome 137+), Asyncify everywhere else; `?engine=jspi` or
  `?engine=asyncify` forces one, and Info names it (*Client build*). JSPI's hang after a
  network drop is gone with the kit's SDL pin.

  What JSPI gains, measured on 24 October (one compile of FreeRDP master `b2403bb99`, linked
  once with `-sASYNCIFY` and once with `-sJSPI`, nothing else different; emsdk 6.0.11 and
  6.0.13; headless Chrome 152 with software rendering; an xrdp session behind websockify; an
  idle phase, then an xterm scrolling `base64 /dev/urandom`; 6 to 12 runs per side in each of
  four sets, in alternating order):

  | | Asyncify | JSPI | Change |
  |---|---|---|---|
  | `sdl-freerdp.wasm`, that build | 14.47 MB | 8.89 MB | −39 % |
  | `sdl-freerdp.wasm`, the kit's build (as released) | 10.6 MB | 6.9 MB | −35 % |
  | Connect (Connect click → display channel up) | 527 / 511 / 550 / 567 ms | 372 / 359 / 369 / 384 ms | −29 to −33 % |
  | Main-thread CPU while idle | 2.7 / 2.8 / 3.7 / 4.2 % | 1.1 / 1.2 / 1.3 / 2.3 % | −45 to −65 % |
  | Data received under load | 2721 / 2682 / 2230 / 2564 kB/s | 2914 / 2860 / 2823 / 2543 kB/s | +7 / +7 / +27 / 0 % |

  Connect time and idle CPU won in every run: every JSPI run beat every Asyncify run in each
  set (Mann–Whitney U at its maximum). Throughput under load did not hold up: it rose by 7 to
  27 % in three sets and was unchanged in the fourth, so it is not claimed. Why: Asyncify
  rewrites nearly every function so that the stack can be unwound and rewound around a
  suspension (FreeRDP's indirect calls through channel, codec and OpenSSL tables make almost
  everything a possible caller of a suspending import). That makes the code larger, the
  CPU-heavy TLS/NLA handshake slower, and every sleep of SDL's main loop unwind and rewind the
  whole stack. JSPI suspends in the engine and leaves the code as it is.

  Not in this release: the MessageChannel wake-up. FreeRDP's `pollset_poll` still yields with
  `emscripten_sleep(0)`, a `setTimeout(0)` that the browser clamps to 4 ms once timers nest. A
  MessageChannel yield costs 9 to 16 µs instead of 4.1 ms (forced on every empty poll,
  throughput 33 → 2113 kB/s with Asyncify and 43 → 2513 kB/s with JSPI). In this client the
  yield never runs, though: a wait builds a fresh poll set, and `poll()` in a pthread waits
  for its timeout, so the counter never passes 10 (0 yields in 36 runs). With the yield as
  shipped, builds with either wake-up differed by 0.4 to 2.4 %, within the noise between runs.
  The decision for every wake-up in FreeRDP's browser code stands: MessageChannel, not
  `setTimeout(0)`, and not `scheduler.yield()` or `postTask()`, which cost 4.2 ms inside the
  client too (3 to 6 µs in a plain page; why is still open). It lands when the yield does
  something, which needs FreeRDP upstream first.
- **Capture with SDL 3.4**: the kit's client moves to SDL 3.4.18, which reads the mouse from
  pointer events. Under Capture the page sent only mouse events, so the remote pointer stood
  still; it now sends a pointer event (`pointerType: "mouse"`) with each, and swallows the
  browser's own pointer events while the pointer is locked. SDL 3.2 ignores mouse-type pointer
  events, so this works with either.

## 20261024.1

- **One vault, several passkeys**: **Add a passkey** makes another key for the same passkey
  vault, wherever the system's dialog puts it: this device (Windows Hello, Touch ID, Google
  Password Manager, iCloud Keychain), a phone (*Use a phone or tablet*) or a security key.
  Connect shows every passkey of the vault in one chooser. A new phone no longer needs export,
  delete and import.
- **A recovery code**: 28 letters and digits, shown once; it opens the vault without any
  passkey. **Remove** drops a passkey or the code. The record moves to format 2 (a list of
  keys, each wrapping the same data key); a format 1 vault opens as before and is rewritten at
  its next change.
- **Reconnect without a passkey or a password**: a dropped connection comes back in the same
  page, by FreeRDP's own retry (`+auto-reconnect`, on by default) and then the page's (a new
  client after 2, 4, 8… s), with the password kept only in the page's memory. **Reconnect** on
  the toolbar and on the end bar does it by hand. Needs the client linked with
  `-sMODULARIZE`; an older client offers *Reload and connect*.

## 20261023.2

- **FreeRDP's hotkeys, your choice**: the **Keyboard** page sets the modifiers (Right Alt + Right
  Shift, the new default; Right Ctrl + Right Shift; Right Shift, FreeRDP's own; or off) and one
  key for full screen, disconnect and keyboard grab. Right Shift alone made a capital D typed
  with the right hand disconnect the session. The page writes the choice to the client's
  `sdl-freerdp.json` in its in-memory file system before the client starts.
- **The keys are shown where you look**: under **Shortcuts** in the form, on the toolbar's Full
  screen and Disconnect buttons, and once in the session after they change.
- **Delete the vault**: only the passkey that created the passkey vault can open it (its key
  comes from that passkey's PRF secret). With that passkey gone, or kept by a provider this
  device does not have, **Delete the vault** (two clicks) starts over; the hosts stay, their
  saved passwords go. *The passkey vault* shows how to move the vault to another passkey:
  export with the passwords, delete, create with the new passkey, import.

## 20261023.1

- **SSH lines that fail fast**: every ssh command (README, *Safety and tunnels*, the page's
  safety notice) adds `-o ServerAliveInterval=30 -o ServerAliveCountMax=3
  -o ExitOnForwardFailure=yes`. A dead network ends the tunnel within about 90 seconds
  instead of hanging, and a local port that is already taken stops ssh with an error
  instead of logging in without the forward. `-J user@jumphost` is mentioned for a server
  reachable only through another host.
- **Three ways, the simple one first**: *Safety and tunnels* lists 1. port → port, the normal
  forward (xrdp on the server's 127.0.0.1:3389), shown by default; a collapsed **Advanced**
  panel holds the one-time xrdp setup (xrdp on a Unix socket in a setgid directory of your
  group, kept by `tmpfiles.d`), 2. port → socket (websockify on 127.0.0.1:3390, xrdp on the
  socket) and 3. socket → socket (websockify on a socket in `/run/user/<ID>`, the ID asked
  from the server, so nothing but sshd listens). Loopback ports keep the network out but
  not the server's other local users; a socket's owner and mode do. The uvx variant is gone.

## 20261022.4

- **A slogan and who it is for**, under the header: lightning-fast remote desktop in the browser
  (AV1 decoded by the browser, multi-user sessions with xrdp, no client to install), a gift from
  a hobby to the world for VDI, HPC, AI, VPS, research and the community. The same words are the
  page's description for search engines and link previews (`og:` tags, with a demo picture),
  and the installed app's.
- **A GitHub link in every page's header**, to the source, issues and releases.
- **The README shows the demos**: the GNOME AV1 video plays in the README itself (uploaded to
  GitHub, the only place a README may play video from), and a gallery of all four as 8-second
  animated clips (`docs/media/*.webp`, 480px, about 1.1 MB each), each linking to its demo's
  lasting address on the page, where it plays in full with sound.

## 20261022.3

- **The demos' addresses are kept for good**: `#xrdp-gnome`, `#xrdp-kde`, `#xrdp-xfce` and
  `#gnome-remote-desktop`, whichever set of videos is published. They are this page's, in
  `media.json`'s `anchors`, and `fetch-media.sh` gives them to the videos by file name; until
  now an address was the video's file name, and the Xfce video is `demo-xfce` in the pinned set
  but `demo-xrdp` in the kit's, so its address depended on the set. Each demo's file names stay
  addresses of it (`#demo-xrdp-kde` and the others of 20261022.2 still work, and lead to the
  lasting one); a key is never removed, and a renamed file only adds a name. A video with no
  key keeps its file name as address, with a warning from `fetch-media.sh`.
- **The demo's link is shown under it**, with **Copy link**, so it can be seen and copied
  without an address bar too (the installed app, a full-screen window).
- **Any other anchor opens the first demo**: one no demo has any more no longer opens nothing.

## 20261022.2

- **Every demo has its own address**, to share: `index.html#intro` opens the first,
  `index.html#<id>` that one, where `<id>` is the video's file name without its extension
  (`#demo-xrdp-gnome`, `#demo-xrdp-kde`, `#demo-xrdp`, `#demo-gnome`), or `demo.json`'s `id`
  when it gives one. The tabs are links, so a demo's address can be copied or opened in a new
  tab; while the splash is open the address bar follows the tab, and closing it drops the
  anchor, so a reload gives the client. An address followed while the page is open switches
  the demo too.
- **The demos play with their sound.** Browsers start a video with sound only after a click on
  the site: after ▶ Intro or a tab it plays with sound; on a visit that has not clicked yet it
  plays muted, with a **🔊 Sound on** button, and the first click or key in the splash turns the
  sound on. Muting with the video's own speaker button is kept for the next visit.
- **A host's link:** `index.html?v=<host:port>` selects the saved host with that address (the
  gateway, or with Direct TCP the RDP server), or adds a new host for it, named after the
  address and with a reminder to check it before connecting; the address then leaves the
  address bar. **Copy link** in the host bar copies the selected host's link: the address
  only, never the user, settings or a password. Until now `?v=` only filled the address field,
  and Connect saved it over whichever host was selected.
- The tabs of the splash keep the buttons' hover border now that they are links.

## 20261022.1

- **Four demo videos, recorded by the kit's CI**, newest first in the splash: the xrdp preview
  with GNOME on Wayland and with **KDE Plasma** on Wayland (KWin 6.8, rendered without a GPU),
  both sent in AV1, then xrdp with Xfce and gnome-remote-desktop with GNOME. The kit records
  them after every green build, with that build's web client and xrdp preview, and publishes
  each set once as a `demo-*` pre-release; its `demo.json` names what they were recorded with.
  `fetch-media.sh` takes the newest set every time the site is published, each file checked
  against the pre-release's `SHA256SUMS`. `media.json`'s pinned set (`demo-media-2`) remains
  for when the kit has none, or with `MEDIA=pinned`.
- **Sound in the videos.** Until now each video carried only about 31 s of sound, starting
  over the login: the recorder dropped the quiet stretches, so the web video's soundtrack came
  too early and the video itself played silent. The new recordings carry the whole session's
  sound, in time; the kit now fails a recording whose web video cannot be heard.

## 20261021.3

- **A third demo video, first in the splash:** the xrdp preview with GNOME 51 on Wayland
  (Fedora 45). sesman starts the GNOME session, xrdp sends it in AV1 4:4:4, and the
  browser decodes it (WebCodecs); then the usual visit, with Firefox playing web video
  next to WebGL on the server, sound included. Recorded by rdp-release-kit
  (`SERVER=xrdp-gnome test/wasm-session.sh`, kit a17d161).
- **Media release `demo-media-2`.** `media.json` now points to it. It holds the new video
  and its poster, plus the other two videos byte for byte; `demo-media-1` stays as it was.
  `media.json` also records how the 720p files are encoded.

## 20261021.2

- **A newer client.** The kit's web client `web-20261021.2-03d465e8b817`: FreeRDP preview
  `20261021.1` (master of 21 October with AV1 through WebCodecs and the Opus microphone fix
  merged, plus the open pull requests for sound, clipboard, microphone and H.264), SDL 3.2.30,
  FreeType 2.15.0 and Opus 1.6.1. Tested by the kit with a browser login to xrdp.
- **License.** The page is licensed under the Apache License 2.0 (`LICENSE`, `NOTICE`); the
  client keeps its own licences, which ship with it under `licenses/`.

## 20261021.1

- **Microphone.** The Microphone switch under Session settings works with a client built with
  FreeRDP's Web Audio microphone backend (FreeRDP pull request #13811, in the kit's preview
  client from `20261020.1`). On, the page adds `/microphone`; the browser asks for the
  microphone when the server opens it. Off by default, so the page never asks unless you want
  it. The page finds out from the client itself (it exports `audin_emscripten_release`): with
  an older client the switch stays off and says "not in this build". Extra options win, as for
  the other settings (`/microphone:...` or `/mic`).

## 0.4.13

- **The app icon and the tab icon load on the published site.** The manifest named its icon
  `/icon-256.png`, from the root of the server. That works in the installed app (its bundle is
  the root) and 404s on the project site, `https://congzhangzh.github.io/icon-256.png`
  instead of `…/freerdp-web/icon-256.png`. A manifest's URLs resolve against the manifest
  itself, which lives in `.well-known/`, so the icon is now `../icon-256.png`: that is
  `…/freerdp-web/icon-256.png` on the site and `isolated-app://<id>/icon-256.png` in the
  app. The pages had no icon link either, so browsers asked for `/favicon.ico`, another 404;
  every page now links `icon-256.png`. Checked by loading the page from a subpath (`/site/`
  on the local server): no 404 is left, and `test-page.mjs` passes. `id` and `start_url`
  stay root-relative, as the installed app needs.

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
