# Web UI design

Decided on 2026-10-18 and implemented in the same change. [Hosting](hosting.md) covers how
the page is published.

## Purpose

The page is part of a complete remote desktop path for the xrdp community: native and
browser clients, xrdp packages for current Linux distributions
([rdp-release-kit](https://github.com/congzhangzh/rdp-release-kit)), and plain guidance for
connecting safely. A server alone does not help someone who cannot connect to it, so the
client comes first: reliable, understandable when it fails, and ready to use without
reading anything. Expert controls exist, but out of the way.

## Default experience: three fields and Connect

| Element | Decision |
|---|---|
| Form | Gateway, User, Password, **Connect**. A real `<form>` with `autocomplete="username"` / `"current-password"`, so the browser's password manager offers to save and fill the password. The page itself never stores a password. |
| Safety notice | Always at the top: the route *this browser → gateway 127.0.0.1:3390 → SSH → RDP 127.0.0.1:3389* and the one-line SSH command that builds it, with a Copy button. The command follows the gateway port and the user name typed in the form. |
| Before the session | No black canvas: only the form. The canvas appears when the session starts. |
| Help | Three pages, linked from the top of every page: **Safety and tunnels** (`safety.html`), **Keyboard** (`keyboard.html`), **Install as app** (`install.html`). Help is reachable by click and keyboard, never only through a tooltip. |
| Look | One left-aligned column, system font, light and dark from the system setting. No web fonts: an Isolated Web App cannot load them. |

## Hosts

Decided on 2026-10-18 (0.3.0). A bar under the safety notice lists the saved hosts; the form
and both panels below show and edit the **selected** host, and every edit is saved into it
as it is typed. **New host** starts from the defaults, **Duplicate** from the selected one
(without its saved password), **Delete** asks for a second click. A first visit has one host,
"My server", so the simple case still reads as three fields and Connect; settings from 0.2
become that host.

A host is a name, an address (a gateway, or with Direct TCP the RDP server: both kept), a
user, its session settings, its advanced options and full screen. **Never a password**:

- By default the browser's password manager keeps it (the form has `username` /
  `current-password` fields). It keys passwords by user name, so hosts with the same user
  share one.
- **Keep this host's password in the passkey vault** (Advanced) keeps it encrypted instead,
  per host, unlocked when Connect needs it with any of the vault's passkeys, or with its
  recovery code ([VAULT.md](../web/VAULT.md)). Hosts of the old vault list become hosts of
  the bar.

**Export…** writes all hosts to a file, with the vault's passwords only when that box is
ticked, encrypted with a passphrase when that box is ticked (PBKDF2-SHA-256, AES-256-GCM).
**Import…** adds a file's hosts under free names. The browser's own passwords cannot be
exported by a page; the dialog says so. The keyboard profile stays a preference of the
browser, not of a host.

**Copy link** (20261022.2) copies the selected host's link, `index.html?v=<host:port>`: the
address only, never the user, settings or a password. Opening it selects the saved host with
that address, or adds a new host named after it, with a reminder to check the address before
connecting (anyone can send such a link, and the session's certificate is not checked); the
address then leaves the address bar, so a reload keeps the host chosen afterwards.

## Session settings

A collapsed panel under the form; its summary line says `recommended`, or what differs.

| Setting | Choices (default first) | FreeRDP options (`web/options.js`) |
|---|---|---|
| Sound | on, off | `/sound`; off: `/audio-mode:2` (the server plays nothing) |
| Microphone | off, on; disabled with “not in this build” when the client lacks it | `/microphone`; off: none, so the browser never asks. A client built with FreeRDP's Web Audio backend (`channels/audin/client/emscripten`, #13811; the kit's preview 20261020.1) exports `audin_emscripten_release`, which turns the switch on. The browser asks when the server opens the channel: an xrdp session needs `pipewire-module-xrdp` for that |
| Clipboard | on, off | `+clipboard`; off: `-clipboard`, and the page's clipboard bridge stops too |
| Full screen | off, on | page full screen on Connect (as before) |
| Video | Automatic, AV1 4:2:0, AV1 4:4:4 | `/gfx` (every codec; this build offers AV1 4:4:4 by default), `/gfx:AV1:i420`, `/gfx:AV1:i444` |
| Priority | Recommended, Save bandwidth, Reduce server load | none; `/network:broadband-low +compression /compression-level:2`; `/network:lan -compression` |
| Shortcuts | FreeRDP, mstsc | see below |

**Priority** is one high-level choice, like a phone's battery mode, not a set of knobs.
*Save bandwidth* means the least data on the wire: the server is told the link is slow
(so it drops wallpaper, themes and animations) and offered the strongest bulk
compression, which costs it CPU. *Reduce server load* means the server works less: a LAN
link and no bulk compression, so it sends more data. The two are mutually exclusive, and
the codec is a separate choice.

**Extra options win.** An option typed into Extra options replaces the generated option
of the same kind (video, sound, clipboard, network, compression); the panel then says
which settings are overridden, and the Advanced section shows the exact options the
client receives. *Restore recommended settings* resets the panel.

Settings from earlier versions are migrated once: Extra options that held only the old
default `/gfx:AV1:i444` become the Video setting *AV1 4:4:4* with empty Extra options.

## Advanced

A collapsed panel. A line under Connect lists any advanced choice in effect, so closing
the panel never hides how the session will connect.

- **Direct TCP** (Isolated Web App only): elsewhere it is disabled, with the reason and a
  link to the install page. In the installed app it starts ticked, because Direct TCP is
  why one installs it; the field then reads *RDP server* and remembers its own address
  list, apart from the gateway's.
- **Passkey vault**: off by default; the browser's password manager is the normal way.
  On, it shows the vault controls and, unlocked, the vault's keys: **Add a passkey**,
  **Create a recovery code**, **Remove** ([VAULT.md](../web/VAULT.md)). The default is *on* for a browser that already has a vault, so nobody loses
  sight of saved hosts. Turning it off locks the vault, clears the password and returns
  the form to the manual connection's remembered settings; encrypted hosts stay stored.
- **Extra options**: free-form FreeRDP options, with the resolved preview. Credential and
  secret-export options are still refused (`validateOptions`).

## Keyboard profiles

FreeRDP's own hotkeys (full screen, disconnect, keyboard grab) are a modifier set plus one key.
FreeRDP's SDL client reads them from `sdl-freerdp.json` (`SDL_KeyModMask`, `SDL_Fullscreen`,
`SDL_Disconnect`, `SDL_Grab`; `client/SDL/SDL3/sdl_input.cpp`), at
`$XDG_CONFIG_HOME/freerdp/`. The page sets `XDG_CONFIG_HOME=/config` in `preRun` (the C runtime
copies `ENV` into `environ` before `main()`) and writes the file into the runtime's in-memory
file system just before `callMain`, from the Keyboard page's choice (`keyboard.js`, saved per
browser). The page logs the file as `[page] hotkeys: …`, and FreeRDP logs the set it uses when
a hotkey fires (`<KMOD_RSHIFT>+<KMOD_RALT>+<SDL_SCANCODE_D> pressed, disconnecting RDP session`).

| Modifiers | |
|---|---|
| **Right Alt + Right Shift** (default) | typing never holds both; Right Alt is Right Option on a Mac |
| Right Ctrl + Right Shift | not on MacBooks, which have no Right Ctrl |
| Right Shift | FreeRDP's own default: a capital D typed with the right hand disconnects |
| Off | `KMOD_NONE`: no hotkeys; full screen and Disconnect stay on the toolbar |

Each action takes a letter, a digit, F1–F12 or a named key (Enter, Space, End, …), never one
another action has. FreeRDP falls back to its default for an unknown key name, so the page
only writes names from its own list. The chosen keys are shown where people look for them:
under **Shortcuts** in the form, on the toolbar's Full screen and Disconnect buttons, and once
in the session after they change. `test-hotkeys.mjs` checks them against the CI xrdp session.

FreeRDP reads the modifiers with `SDL_GetModState()` when its loop handles the key, not from
the key event, so a modifier released very quickly after the key (a script, not a hand) can
miss the hotkey.

The **mstsc** profile adds Windows Remote Desktop's shortcuts on top:

| Keys | Action |
|---|---|
| Ctrl + Alt + Break (or Pause) | full screen on or off |
| Ctrl + Alt + Home | show the connection bar (toolbar) |
| Ctrl + Alt + End | sends Ctrl + Alt + Delete to the remote desktop |

The page takes these keys only while the remote desktop has focus, and the remote side
does not see them. Ctrl + Alt + Delete is sent as a `Delete` key event to the canvas while
Ctrl and Alt are held; SDL3 reads the key's `code`, not whether the event is trusted
(`SDL_emscriptenevents.c`). The default profile is FreeRDP; the choice is shared by the
session panel and `keyboard.html`.

## Reconnect

A session comes back without a passkey prompt or a typed password, in the same page:

| Layer | When | How |
|---|---|---|
| FreeRDP's own | the network drops | `+auto-reconnect` (default; `-auto-reconnect` in Extra options turns it off): the same client tries again with its own settings |
| The page's | the client has ended after a lost connection | a new client in this page (`createFreeRDP()`), with the password kept in memory, after 2, 4, 8, 16, 30… s, up to 8 times; the bar says *Connection lost. Reconnecting in N s* |
| By hand | a session that hangs, or one that ended | **Reconnect** on the toolbar (it closes a running session's sockets first) or on the end bar |

FreeRDP's own reconnect shows a retry dialog. In a browser every SDL window draws on the
page's one canvas, so that dialog's window took over the session's canvas, and when it
closed it left the canvas 0 × 0 and no window with the keyboard focus: the picture stopped
and the keys went nowhere, while the mouse still worked (on one screen as on several). The
client since FreeRDP `release-20261026.3` opens no dialog window in a browser (our pull
request #13860; its messages go to the log), and test-reconnect and test-screens check the
canvas and the keys after a reconnect.

The password of the running session stays in the page's memory only: encrypted with AES-GCM
under a non-extractable `CryptoKey` made for it, never in storage. **Disconnect**, choosing
another host, a refused logon (no retry then) and closing the page drop it.

A new client per connection needs the WebAssembly client linked with `-sMODULARIZE=1
-sEXPORT_NAME=createFreeRDP` (and `HEAPU8` among `EXPORTED_RUNTIME_METHODS`): each call of
`createFreeRDP()` is a new runtime, with its own memory, threads and C globals. An older
client defines a global `Module` that runs `main()` once (`-sEXIT_RUNTIME=1`); with it the end
bar offers *Reload and connect*, and Connect asks for the passkey as before. Measured with the
CI xrdp session: FreeRDP's own retry starts, but the client ends about 0.1 s later (the SDL
main thread returns from `main()` and the runtime exits with the retrying thread), so today
the page's retry is the one that brings the session back.

## All screens

**All screens** on the toolbar spreads the remote desktop over every screen of this computer.
The button shows where the browser reports more than one screen (`screen.isExtended`) and has
the Window Management API (Chrome, Edge). It has two modes, the pair mstsc and FreeRDP's
clients offer. A click on **All screens ▾** asks which, in a small menu under the button;
the choice starts it (it is the click that full screen and the new window need) and is kept
as the host's setting, which *Session settings*, **All screens**, also shows and sets:

| Mode | The server sees | mstsc / FreeRDP |
|---|---|---|
| **Separate screens** (default) | a monitor per screen: a window maximizes on one, the panel stays on the primary one (this window's screen), and a window dragged off one screen comes out on the next, as on physical screens | `/multimon` |
| **One wide desktop** | one monitor as large as the screens' bounding box: a maximized window covers them all | `/span` |

On the page both modes are the same: one canvas as large as the bounding box, each window
showing its part. They differ only in the layout FreeRDP sends.

| Step | What happens |
|---|---|
| Click | `getScreenDetails()` lists the screens (the browser asks for permission once); this window goes full screen on its own screen |
| A window per other screen | `screen.html`, opened on that screen; its first click fills the screen (and does not reach the remote side). Browsers allow one new window per click, so with three screens **Next screen** opens the third |
| The desktop grows | the canvas is made as large as the bounding box of the screens in use and placed so that this window's screen shows its own part (`screens.js`); SDL follows the canvas's size and `/dynamic-resolution` sends the new size over the display channel |
| Picture | each window copies its part of the canvas whenever the canvas's capture stream has a new frame (so an idle desktop costs nothing) |
| Mouse and keys | each window hands its events back to the page, which gives them to SDL on the canvas at that point, as mouse and pointer events (SDL 3.2 and 3.4) |
| Captured mouse | under Pointer Lock the browser shows no cursor and the page draws the remote pointer itself (`#vcursor`), moved by the lock's `movementX/Y` across the whole canvas; `view()` tells each window where it is (canvas pixels, image, hot spot), and the window whose part holds it draws it too |
| Back to one | **One screen**, leaving full screen, closing a window (the desktop shrinks to the others) or a change of the screens |

**Separate screens, deep down.** FreeRDP's SDL client makes one window per SDL display for
`/multimon`, and a browser has one display and one canvas. So the client keeps its one window,
and on each resize `SdlContext::updateWindowList()` asks the page how the canvas is split:
`Module.freerdpMonitors()` returns the screens in use as fractions of the canvas, this window's
screen primary (`app.js`, `screensMonitors()`; FreeRDP's `sdl_monitors_emscripten.js`). Two or
more become as many monitors in the display channel's `DISPLAYCONTROL_MONITOR_LAYOUT_PDU`, so
xrdp makes as many RandR monitors (it allows 16), which the window manager maximizes into. The
connect itself carries one monitor (FreeRDP writes `TS_UD_CS_MONITOR` only with `/multimon`),
so a client that starts on a canvas already split, after **Reconnect** for example, sends the
layout at its first activation. That FreeRDP change is our pull request (not in upstream yet).

One limit, found by test-screens: after **Reconnect** the client sends the screens again, but
xrdp 0.10.6.1 and older drop a layout whose bounding box did not change (two 640 × 480
monitors after one 1280 × 480), so the session stays one wide monitor until the next resize.
xrdp's devel has the fix (5376e6de), and so do the release kit's xrdp preview packages.

What it is not: screens of different sizes leave parts of the bounding box that no screen
shows (with Separate screens the server puts no window there; with One wide desktop it may).
The remote desktop has one scale, that of this window's screen; a screen with another pixel
ratio shows its part scaled.

Three browser details decide how it is built:

- SDL draws with WebGL, and a WebGL canvas reads back empty outside the frame that drew it
  unless its context keeps the drawing buffer (`preserveDrawingBuffer`, off by default;
  measured: `[0,0,0,0]` from `drawImage()` on an idle canvas, the right colour with it on). The
  page asks for it only where the browser sees more than one screen when the page loads.
- A canvas's capture stream has no frame for a canvas that is not drawn again, not even after
  `requestFrame()`, so the stream cannot carry the picture alone: a window opened on an idle
  desktop would stay black. It serves as the signal that something changed.
- SDL takes the canvas's size only once FreeRDP has made its window resizable (when the
  display channel is up, `sdl_disp.cpp`); a resize event before that is lost. While the
  screens are in use the page sends another one until the canvas has the size it is shown at.

## Verification

| What | How | Result |
|---|---|---|
| Option mapping, overrides, keyboard actions, hosts (storage, migration, export, import), the screens' geometry | `node --test web/tests/*.test.cjs` | 53 tests pass |
| Connection bridge with session settings, migration | `web/tests/bridge.test.cjs` | pass |
| The page with the real client: hosts, export and import, the vault with virtual passkeys (a second passkey, the recovery code), settings, mstsc keys, phone width | `node test-page.mjs <client dir>` | 41 checks pass (49 with the demo media) |
| Reconnect: a dropped gateway, then the toolbar's Reconnect, against the CI xrdp session (no reload, no passkey, no typing; xrdp logs each login) | `PAGE=<page URL> node test-reconnect.mjs`, with a modular client | 6 checks pass, 3 runs in a row |
| All screens: two screens set by hand (`?screens=640x480+0+0,640x480+640+0`), the desktop grows to 1280 × 480, the second window shows the right half (an xterm there, compared pixel by pixel), its mouse and keys reach the server (X pointer position, keys held), closing it shrinks the desktop | `PAGE=<page URL> GATEWAY=<host:port> XRDP=<container> node test-screens.mjs` | 11 checks pass, 4 runs with JSPI and 3 with Asyncify |
| All screens, captured: with Pointer Lock emulated (headless Chrome refuses it) and the page's cursor on the second screen's part, that window draws it, and not once it is back on the page's screen | part of `test-screens.mjs` | 2 checks pass; both fail with 20261026.4 |
| All screens against a Wayland desktop through xrdp's wlup module, GNOME (Mutter backend) or KDE Plasma (KWin backend): one monitor at connect, Separate screens mid-session gives a monitor per screen with this window's (the right-hand) screen primary (GNOME's top bar, Plasma's panel), the session's windows staying on that screen (a dark window, compared pixel by pixel), also after Reconnect, and one again once the second window closes (GNOME's `DisplayConfig`, `kscreen-doctor`) | `./start-wlup-xrdp.sh <xrdp source dir> gnome\|kde`, then `DESKTOP=gnome\|kde PAGE=<page URL> node test-screens-wlup.mjs` | 5 checks pass on each desktop with xrdp's `feature-wlup-kwin-multimon` (release-20261026.4); without the multi-monitor changes the desktop keeps one wide monitor and two checks fail, and without .4's fix the windows move to the new screen and one fails |
| A full login | the release kit's `test/wasm-session.sh`: xrdp in a throwaway container, SSH, websockify | Xorg session and xterm started, screenshot shows the desktop |

Not verified yet:

- Whether *Save bandwidth* and *Reduce server load* measurably change bytes and server CPU
  with xrdp; measure both under the same workload before claiming a gain.
- The mstsc Ctrl + Alt + End → Ctrl + Alt + Delete path against a real server.
- Browser password saving across browsers and password-manager extensions.

The client still connects with `/cert:ignore`; the Safety page explains what SSH does and
does not cover. Checking the RDP server's certificate is future work.
