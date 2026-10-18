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
| Safety notice | Always at the top: the route *this browser → gateway 127.0.0.1:6080 → SSH → RDP 127.0.0.1:3389* and the one-line SSH command that builds it, with a Copy button. The command follows the gateway port and the user name typed in the form. |
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
  per host, unlocked with a passkey when Connect needs it ([VAULT.md](../web/VAULT.md)).
  The vault's format is unchanged; hosts of the old vault list become hosts of the bar.

**Export…** writes all hosts to a file, with the vault's passwords only when that box is
ticked, encrypted with a passphrase when that box is ticked (PBKDF2-SHA-256, AES-256-GCM).
**Import…** adds a file's hosts under free names. The browser's own passwords cannot be
exported by a page; the dialog says so. The keyboard profile stays a preference of the
browser, not of a host.

## Session settings

A collapsed panel under the form; its summary line says `recommended`, or what differs.

| Setting | Choices (default first) | FreeRDP options (`web/options.js`) |
|---|---|---|
| Sound | on, off | `/sound`; off: `/audio-mode:2` (the server plays nothing) |
| Microphone | shown disabled, “not in this build” | none: the WASM build has no audio-input backend (`channels/audin/client` has no Emscripten driver) |
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
  On, it shows the existing vault controls ([VAULT.md](../web/VAULT.md); format
  unchanged). The default is *on* for a browser that already has a vault, so nobody loses
  sight of saved hosts. Turning it off locks the vault, clears the password and returns
  the form to the manual connection's remembered settings; encrypted hosts stay stored.
- **Extra options**: free-form FreeRDP options, with the resolved preview. Credential and
  secret-export options are still refused (`validateOptions`).

## Keyboard profiles

FreeRDP's own hotkeys (Right Shift + Enter, + D, + G, …) are compiled into the client and
always work. The **mstsc** profile adds Windows Remote Desktop's shortcuts on top:

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

## Verification

| What | How | Result |
|---|---|---|
| Option mapping, overrides, keyboard actions, hosts (storage, migration, export, import) | `node --test web/tests/*.test.cjs` | 30 tests pass |
| Connection bridge with session settings, migration | `web/tests/bridge.test.cjs` | pass |
| The page with the real client: hosts, export and import, the vault with a virtual passkey, settings, mstsc keys, phone width | `node test-page.mjs <client dir>` | 25 checks pass |
| A full login | the release kit's `test/wasm-session.sh`: xrdp in a throwaway container, SSH, websockify | Xorg session and xterm started, screenshot shows the desktop |

Not verified yet:

- Whether *Save bandwidth* and *Reduce server load* measurably change bytes and server CPU
  with xrdp; measure both under the same workload before claiming a gain.
- The mstsc Ctrl + Alt + End → Ctrl + Alt + Delete path against a real server.
- Browser password saving across browsers and password-manager extensions.

The client still connects with `/cert:ignore`; the Safety page explains what SSH does and
does not cover. Checking the RDP server's certificate is future work.
