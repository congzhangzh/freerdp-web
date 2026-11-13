# Changes

The version is the one in `web/.well-known/manifest.webmanifest`; the page shows it in its
About panel (under the form, and on a session's toolbar). An installed app (IWA) updates only to a newer version.

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

## 20261113.1

- **Info reads FreeRDP's decoder counters by either name.** FreeRDP from 20261113 (FreeRDP#14076)
  names them by graphics codec ID, `RDPGFX_CODECID_<codec>_<stat>`, where earlier releases had
  `RDPGFX_DECODER_<decoder>_<stat>`; the page reads the new names first and the old ones when a client
  has only those, so this page works with the FreeRDP of today's release and with the next one.
  Unused codec IDs (`RDPGFX_CODECID_UNKNOWN*`) are left out.
- **AV2's results are called AV2's.** The new names have no AV2 of their own: FreeRDP counts AV2
  under AV1's codec ID when the server confirmed the FRDP_2 capability set. Info tells them apart by
  the capability version the server confirmed, which the web client gives the page
  (`Module._freerdp_web_codec_stats()`, slot 1): FRDP_2 is AV2, anything else AV1, and a client that
  doesn't say shows "AV1/AV2" rather than a guess. With the older names AV2's own counters are now
  shown too.
- Tests: the unit tests read the counter names of both FreeRDP releases; `test-page.mjs` and
  `test-stats.mjs` accept either, and `test-stats.mjs` checks that an AV2 session says "AV2 results".

## 20261110.1

- **Screen changes settle before the server hears of them.** A window that changes size in steps
  (macOS animating into and out of full screen, a dragged edge) gave the server a new monitor layout
  every half second, and FreeRDP's shadow server rebuilds the session for each one; a burst of those
  broke two-screen sessions. While a session runs, the client now learns of a resize once the size has
  kept still for 300 ms (at most 1.5 s after the first); the page's own toolbar and header still follow
  at once. Against the shadow server this cut the layouts sent per two-screen test from 62 to about 20.
  The drops themselves were FreeRDP's (a surface clipped at the screen's edge turned into a scale the
  web build cannot do, FreeRDP#14126; input during a reconnect aborted the client, FreeRDP#14128); this
  page change only makes them rarer.
- **Info's Network totals are this session's.** "Network in" and "Network out" counted every session
  since the page loaded; each connect now starts them from its own bytes. The rate is unchanged.
- Tests: `test-screens-fs.mjs` drives two screens, Window / Full screen rounds the way real screens do
  them, the microphone, and Reconnects with input, against xrdp or (`SERVER=shadow`) FreeRDP's shadow
  server, checking after each step that the picture still updates; `test-stats.mjs` asks for AV1 by
  default, since AV2 frames have no decoder verdict yet.

## 20261107.1

- **Files through the clipboard, both ways.** To the session: drop them on the page, paste them where
  the browser hands them over, or use the toolbar's Files; a paste in the session then reads each
  piece from the File, so nothing waits in memory. From the session: a copy of files shows a bar
  with Save; Chrome and Edge write to disk as it arrives, other browsers collect it in memory, up to
  2 GiB, several files as one ZIP. `web/clip-files.js` holds what can be tested without a page.
- **Files only where the server takes them.** FreeRDP's `freerdp_web_clipboard_server_files()` reports
  the server's `CB_STREAM_FILECLIP_ENABLED`, read once the clipboard channel is up, and the page hides
  Files and the drop on a no. A client without that export can't tell, so the controls show as long as
  it can offer files. A yes is only the server's word, so the "ready" line says what to think if
  nothing arrives.
- Tested on Linux's FreeRDP shadow server only: both ways, 200 MB, CJK and empty folders, in Chrome.
  xrdp, GNOME Remote Desktop, Windows, Mac, Firefox and Safari have not been tried.
- No Cancel yet. A failed save in Chrome can leave an empty file.
- The session's toolbar wraps at phone width, where its buttons ran off the screen.

## 20261106.5

- **Info no longer shows two times for one AV1 picture.** With FreeRDP's counters, the page's own
  "AV1 frames" and "AV1 decode" rows are gone: FreeRDP's "AV1 results" row covers them. They measured
  different things, the page's timer only the browser's decoder, FreeRDP's the whole decode call
  (the wait for the main thread and the copy into the surface too), and nothing said so. A client
  without the counters keeps the old rows. H.264's rows stay for now.
- A decoder's row reads "pictures: 1" and no longer "1 pictures".
- `test-stats.mjs` takes `EXTRA`, the session's FreeRDP options, for a server that needs AV1 asked for.

## 20261106.4

- **Get a server has tabs**: Linux, Windows, macOS and Notes, and Debian, Ubuntu and Fedora under
  xrdp, one of each shown at a time, so the page is about 3,000 px at its longest, down from about
  7,000. A tab is a plain link to its panel, and a link to a section opens the tabs around it, so
  older links such as `#windows` keep working and `#server-fedora` opens Linux and Fedora. A change of
  language, which draws the page again, keeps the tabs. Without `install.json` the page is still
  its one line to the kit's latest release, with the safety line above it.
- **The Linux host is on the page at last**: `install.json` has carried `linux[]` and nothing read it.
  Under Linux: FreeRDP's shadow server first, then xrdp, then the desktop's own server (GNOME Remote
  Desktop, whose account is its own and not the system login, and KRdp, not tried with this page).
- **The session manager's section is ready and hidden**: it shows only when `install.json` has a
  `sesman` field, which the kit writes once a real host confirms it, so that needs no page release.
- **AV2's text was backwards.** AV2 has been on by default in the kit's xrdp since 31 October and the
  kit's command puts AV1 first again, but the page still said AV2 was off until you put it first,
  above that command. It says what the command does now, in the Notes tab.
- "Then connect" is gone. Its safety line, keep the RDP server on 127.0.0.1 and reach it through
  SSH, is in the page's opening, since all three systems rely on it.
- **Get a client**: in the browser (as a page, as a Chrome app), or a native client with uvx, an offline
  pack (the kit's archives) or pip. `#browser`, `#app`, `#native-clients` and `#freerdp-tk` stay.
- `test-server.mjs` checks the tabs, every older link, phone width in each tab, and the session
  manager with and without its field.

## 20261106.3

- **Info reads FreeRDP's own counters**, which live in its libraries for every client (FreeRDP
  discussion #14051), so the page only shows them. New rows: each video decoder's results (pictures,
  failed, without a picture, key frames, mean ms per attempt, longest, hardware or software,
  fallbacks), Audio received (rate, total, dropped, delay), Round trip and Bandwidth.
- `web/client-stats.js` (new) looks the counters up by name, once per client: the list has no layout
  version and an index means nothing between clients. A name a client lacks hides its row, so older
  clients look as before; Info's other rows are unchanged.
- A decoder's time is per attempt, failed ones included, as FreeRDP adds it up. A counter that went
  down is a new channel after FreeRDP's reconnect, so its rate shows "–", never a negative number.
  Round trip and bandwidth are the server's measurements: "not measured" can be for good, and
  was on the xrdp tested here.
- `test-stats.mjs` (new): a real login that opens Info and prints every counter that isn't 0. Run
  against an xrdp that sends Planar and Progressive: 104 names, 261 surface commands, 185400 bytes
  received, matching the page's own count. It sent no AV1 or H.264, so the decoder rows have not yet
  been seen with real numbers; the kit's servers do send them.

## 20261106.2

- **A new page, `web/story.html`: how we got here**, in the header after Release notes. The text is
  the release manager's, in English first; Chinese, Japanese and French are translations of it.
- **One article per language, not keys in `i18n.js`.** `i18n.js` is loaded by every page, the
  client's included, so a long story there would weigh on all of them, and its tables hold no markup.
  `data-i18n-only` shows the article of the page's language; the other three are `hidden` in the
  HTML, since an English load runs no `apply()`. The only new keys are `nav.story` and
  `story.pageTitle`.
- `web/tests/story.test.cjs` (new) keeps the four articles the same shape (chapters, paragraphs,
  list items, links), with the same numbers, the page's own slogan and one replaceable
  `story-open` section, and checks that every page's header links to the story.
- `test-i18n.mjs`: each language shows its own article alone, and the Language select changes it.
  `test-page.mjs` and `test-i18n.mjs` have the page in their lists, so it is checked at 390 px.

## 20261106.1

- **A refused login says so.** A shadow server refuses a wrong password only after the connection
  is up, and FreeRDP's clients don't announce the error PDU that would name it, so the page saw
  `ERRINFO_RPC_INITIATED_DISCONNECT` and called it a dropped connection: it retried, used up the
  account's attempts and opened the Log. A server hang-up within 60 seconds of Connect with no
  picture painted (`paintedNothing` in `web/codec-stats.js`, from the client's codec counters) now
  ends the session as a refused login: no retry, no Log, the password forgotten, and a new message
  (`end.noPicture`, in all four languages). A server that takes longer than 60 seconds gets one
  retry, which is then caught the same way.
- **Reconnecting is shown while FreeRDP reconnects on its own.** FreeRDP's auto-reconnect runs
  inside the client, so the picture just froze with nothing said. The page now watches for that
  log line, shows the Reconnecting bar and clears it when paints resume.
- **Clipboard text from the server gets this system's line ends.** RDP text is CRLF; outside
  Windows the page now writes LF to the browser's clipboard. On Windows it stays as sent.
- Tested in a real browser against a headless GNOME session: wrong password, a right password
  after it, drops of 8 and 41 seconds, line ends. 94 unit tests pass, three of them new. The page
  on Windows has not been tried.

## 20261105.3

- **The release notes have caught up.** `web/release-notes.html` stopped at 20261102.1: the nine
  versions from 20261103.1 to 20261105.2 each changed `CHANGELOG.md` and the manifest and skipped
  it, though `docs/hosting.md` asks for all three. They now have their entries. Nothing else on the
  page changes.
- `web/tests/release-notes.test.cjs` (new) keeps it that way: the manifest, `CHANGELOG.md` and the
  notes must start with the same version, and every version since 20261021.3 needs a notes entry.
  It failed on 20261105.2 before this commit.

## 20261105.2

- **The Log's Auto-scroll is a check box**, ticked at first, in place of 20261105.1's Pause and
  Resume buttons, so what it is doing is always in view. Untick it to read from the start; ticking
  it goes back to the end and hands the keys to the remote desktop. Scrolling up or selecting text
  unticks it too. Under a flood of lines the view stays where you put it.
- **The page's own retry leaves a Log you are reading alone.** After a dropped session each retry
  closed the Log and took the keys. With Auto-scroll unticked it now does neither.
- **The last session's log is kept however the session ended, one tab away.** A Disconnect marked
  the session as ended cleanly and reloaded the page, so its log could not be reached. But the page
  can't tell that from you giving up on a frozen picture. The Log now has a **Last session** tab
  after any end, with Copy all and Ctrl + A working on it. Nothing announces it: the Log stays
  closed, and only an unexpected end still shows its notice, whose Show opens the same tab. This
  page's own log no longer has a saved log mixed into it.
- It holds the session's last 300 lines, as the crash log always did, with the password and the
  user masked. It stays in this browser until the next session replaces it.
- Checked: `test-log.mjs` (38 checks), the unit tests, `test-i18n.mjs` and `test-page.mjs` with kit
  client web-20261105.4-5645c7916906, and once a real Disconnect and the check box in an xrdp
  session. The retry is checked by a unit test only: in two real drops FreeRDP reconnected by itself.

## 20261105.1

- **The Log can be paused, so you can read and copy it.** It still follows new lines. **Pause**,
  scrolling up or selecting text stops that; the lines keep arriving below, with a count of them,
  and **Resume** goes back to the end. Pause holds until Resume; a stop from scrolling also ends
  by scrolling back to the end.
- **What you select in the Log stays selected.** Each new line used to rewrite the whole text,
  which dropped any selection: a drag that picked 59 characters had 0 after the next line.
- **Ctrl + A (Cmd + A) selects the Log, not the whole page.** The log could not take the keyboard,
  so a click left the keys on the page. Click in the log first: while the remote desktop has the
  keys, Ctrl + A is the remote desktop's, as it should be. Resume hands them back to it.
- **Copy all** copies the whole log without selecting anything. The password and the user stay
  masked, as they are in the log.
- A saved crash log (Show) now opens at its start, paused, under a running log.
- Checked: `test-log.mjs` (new, 23 checks), the unit tests, `test-i18n.mjs` and `test-page.mjs`
  with kit client web-20261105.4-5645c7916906, and once in a real xrdp session: with Ctrl + A held
  in the Log the X server sees no key down, with a key held on the remote desktop it does.

## 20261104.3

- **The host bar and the Log no longer show your user name**, after the SSH line in 20261104.2. The
  bar under the safety notice listed `user @ gateway` for each saved host; it now shows the gateway
  alone. The Log printed the client's command line with `/u:<name>`, and the crash report keeps that
  log; it now says `/u:***`, as it does for the password. The client still gets the real user.
- The User field itself still shows what you typed: it is the field you edit.
- Checked: the unit tests, `test-i18n.mjs` and `test-page.mjs` with kit client
  web-20261105.2-2840f29d5946; the page test finds no saved user in the bar, and none anywhere in
  the log, FreeRDP's own lines included.

## 20261104.2

- **The safety notice's SSH line shows `user@server`, never your user name.** The line took its
  user from the User field, which fills from your saved hosts, a `?u=` link and the browser's
  autofill, and the notice sits at the top of the page: a screen share or a recording showed the
  name. It is fixed text now, like every command in *Safety and tunnels*. The local port still
  follows the gateway.
- Copy gives that same line, so the hint under it now says to replace `user@server` with your user
  and server, not only `server`, in all four languages.
- Checked: the unit tests, `test-i18n.mjs` and `test-page.mjs` with kit client
  web-20261105.2-2840f29d5946; the page test types a user and expects the fixed line.

## 20261104.1

- **Info's "Audio codec" says what the server sends again**, e.g. "Opus, 48 kHz, stereo". The row
  reads FreeRDP's `_freerdp_web_audio_format()`: the format tag, sample rate and channels of the
  sound as it comes over the wire, before the client decodes it. Only the old wasm-vault FreeRDP had
  that export, so the row said "–" in every session. The release FreeRDP's web sound device now
  exports it again (FreeRDP commit 6fce777b1). The device itself only ever plays 16-bit PCM, so it
  keeps the format FreeRDP asked it about just before opening it, which is the format on the wire.
- The row hides with a client that has no such export, as "Video codecs" did in 20261103.3, and
  says "no audio yet" until the first sound arrives.
- The row read its numbers through a `HEAPU32` the page never had (the client is a module and
  exports only `Module.HEAPU8`); it now reads through `Module.HEAPU8`, with bounds checks.
- Checked with FreeRDP ecd4af2ba (release-20261104.2) + 6fce777b1 built for the web: the export
  reads [0, 0, 0] before a session and the row says "no audio yet"; formats written in its layout
  show as "Opus, 48 kHz, stereo" and "PCM, 44.1 kHz, mono"; the page test (`test-page.mjs`) passes.
  The sound in live sessions is the release kit's round (xrdp, xrdp on GNOME, Windows' Remote
  Desktop).

## 20261103.4

- **Info's "Video codecs" is back, with what the server really sends.** The release FreeRDP's
  web client now counts, per RDP graphics codec, the updates the server sends and their bytes,
  and exports them as `_freerdp_web_codec_stats()` (FreeRDP commit 736f42cab, in its SDL3 client,
  web build only). `web/codec-stats.js` reads them and the row says, for example,
  "AV2 30/s 2400 kbit/s · Progressive 2/s 40 kbit/s · CacheToSurface 12/s": a rate and kbit/s per
  codec, AV2 told apart from AV1, and the paints that carry no codec (solid fills, copies within a
  surface, paints from the cache), so a server that paints mostly from its caches no longer looks
  idle. Rates come from unsigned differences, so a counter that wraps past 2^32 still reads right.
  The row hides with a client that has no counters (any FreeRDP before that commit) or with a
  layout the page doesn't know.
- Why it matters: the Windows Remote Desktop demo opened two H.264 decoders and decoded no H.264
  picture; only the per-codec counts can show which codecs Windows sent instead.
- The client is built as a module and exports only `Module.HEAPU8`, so the counters are read
  through its buffer; the old reader used a `HEAPU32` that the page never had.
- Tests: `codec-stats.test.cjs` (the layout and bounds checks, rates, a wrapped counter, AV1 or
  AV2, the paints, nothing yet). Checked with FreeRDP 79d692b40 + 736f42cab built for the web: the
  export reports layout 2 at run time, the row shows, and the page test (`test-page.mjs`) passes.
  The counts in live sessions are the release kit's round, which records xrdp (AV2), Windows'
  Remote Desktop and the macOS and Windows hosts.

## 20261103.3

- **Info hides "Video codecs" while the client has no codec counters.** The row showed, per RDP
  graphics codec, how many updates the server sent and at what rate. It read FreeRDP's
  `_freerdp_web_codec_stats`, which only the old wasm-vault FreeRDP exported: the same cause as
  the AV1 counters fixed in 20261103.1. The release client has none, so the row said "–" in every
  session. It now hides when the export is missing. The counters are coming back in the release
  FreeRDP as a new client-side export (a new layout, with AV1 and AV2 told apart), and the page
  will read it in a release of its own.
- Checked with the real client: the row is gone and the other rows stay; with an export present,
  the row is there again. Unit tests and the page test (`test-page.mjs`) pass.

## 20261103.2

- **The demo videos speak the page's language.** Their titles and captions come from the release
  kit's `demo.json`, which since kit release 20261103.9 carries them in Chinese, Japanese and
  French as well (`i18n.zh` / `.ja` / `.fr` on each entry, each with an optional `title` and
  `caption`). The intro's tabs and caption, and the videos in Get a server (Windows and macOS
  hosts) and Get a client, now show the kit's words in the page's language, field by field, and
  English where the kit left a field out: a name such as "xrdp + GNOME Wayland, AV1" stays
  English in every language. A change of language on the open page redraws them. One helper,
  `kit(entry, field)` in `i18n.js`, does the choosing for every page.
- Tests: `i18n.test.cjs` (each language; a missing, blank or non-text field; an entry from an
  older kit with no `i18n`), `server.test.cjs` (`clips()` per language; a translated title lets
  nothing through that the English one would not). Checked in Chrome against the kit's real
  `demo.json` and `install.json` of release 20261103.9: the intro, Get a server and Get a client
  in English, Chinese, Japanese and French, and a switch of language on an open page (26 of 26).

## 20261103.1

- **Info counts the video frames again.** "AV1 frames" said "0 total" on every server while the
  pictures arrived (the release kit saw it on its macOS host: 448 AV1 frames sent, 0 counted).
  The page read `Module.freerdpAv1.stats`, which only the old wasm-vault FreeRDP filled (commit
  "[codec,av1] count WebCodecs frames and decode time for the page"); the FreeRDP the kit has
  built since 2026-10-27 does not carry it. Now the page counts by itself: `web/decode-stats.js`
  wraps the browser's `VideoDecoder` before the client starts, so every decoder FreeRDP's
  WebCodecs glue makes reports its chunks, key chunks, bytes, pictures and the time from
  `decode()` to the picture, per codec (AV1 4:2:0 or 4:4:4, H.264), with no FreeRDP patch. A
  client whose FreeRDP keeps its own AV1 counters is read instead. Info shows "H.264 frames" and
  "H.264 decode" too, once H.264 pictures arrive; dav1d (the software fallback inside the
  client) is not a `VideoDecoder` and leaves the AV1 rows at "–". The "Video codecs" row stays
  "–" (its counters, `freerdp_web_codec_stats`, are FreeRDP's and not in the release either).
- Tests: a unit test of the counter (`web/tests/decode-stats.test.cjs`); by hand, Chrome's own
  AV1 and H.264 encoders feeding the wrapped decoder the way FreeRDP does (one picture in flight,
  timestamp 0, `copyTo`): 12 of 12 pictures counted for each, with their bytes and decode time.

## 20261102.1

聪哥's four requests for the page, passed on by the release kit:

- **Four languages: English, 中文, 日本語, Français.** `web/i18n.js` holds the tables `JA`
  and `FR` next to `ZH`, with the same 604 keys and the same `{placeholders}`. A unit test
  holds them to that. The header's Language menu on every page lists the four. Auto takes the
  browser's first language that is one of them, of any region (`fr-CA`, `ja-JP`…), and English
  otherwise. `<html lang>` is `ja` or `fr`. The release-note line that says the entries stay
  English now shows in all three. The two new tables were drafted by translator agents from
  the English and the Chinese, piece by piece where a sentence is joined around a link.
  Japanese uses です/ます and 「」; French uses vous, « », and a no-break space before
  `: ; ? !`. Open points: Chrome's own wording of the Local Network Access prompt
  (`safety.lna`) is not checked against a Japanese or French Chrome, and in French
  `screens.span` is capitalised when it sits mid-sentence.
- **Get a server: the macOS host.** `install.json`'s new `mac` list (kit fd5b633: FreeRDP's
  shadow server as `FreeRDP-Shadow.app` with a LaunchAgent, one entry per processor) gets a
  section after Windows. It has a card per processor with its Terminal line, then the two
  permissions to allow (Screen & System Audio Recording, Accessibility) in the page's own
  words, the restart command alone (`kickstart`, or the end of the kit's English `then`
  after "run:"), the removal, both archives, and demo.json's `mac` video. The lead line names
  the Mac next to Windows.
- **The Mac demo in the Intro too.** No change was needed: the splash shows every entry of
  demo.json's `videos`, where the kit appends the Mac video (checked with kit 20261102.8's
  demo.json: 8 tabs, the last one "FreeRDP shadow server + macOS, AV1").
- **The safety banner says whose duty security is.** "Your security is your own duty", in
  bold. Then: an unofficial community client, as is, with no warranty, not written by
  security professionals. Its author always keeps RDP behind SSH: every server the release
  kit ships listens on 127.0.0.1 only, and the gateway is SSH plus websockify. Do the same:
  never open an RDP port to a network.
- Tests run here before the tag: unit 77/77 (`node --test web/tests/*.test.cjs`),
  `test-i18n.mjs` 64 checks (ja-JP and fr-FR browsers added), `test-server.mjs` (with the
  macOS host in `test-server-install.json`), no failures.

## 20261031.1

- **Get a server: Windows' own Remote Desktop, and AV2.** The Windows section starts with
  Windows' own Remote Desktop server (Windows Server, Pro and Enterprise): nothing to
  install, FreeRDP Web reaches it through a gateway on that PC as it reaches xrdp, a
  session per user with its sound (the kit records it now). Then FreeRDP's shadow server,
  whose text says AV2 is `/gfx-av2` after `/gfx-av1`. And install.json's new `av2` (the
  kit writes it when its xrdp packages have AV2: avm-6e's encoder, `--enable-av2`) shows
  under "Start it" as an **AV2** part: its line, which puts AV2 first in xrdp's codec order,
  with a Copy button, and its cost (FreeRDP Web decodes AV2 in software). `server.js`
  parses it (a unit test), `test-server.mjs` checks it with `test-server-install.json`'s new
  `av2`, the Chinese in `i18n.js`. Run here before the tag: unit 74/74, test-server.mjs 35,
  test-page.mjs 53, no failures.

## 20261030.7

- **The page test follows 20261030.6's codec list**: `test-page.mjs`, which the kit's
  `site.yml` runs before the site goes live, still clicked Video's *AV1 4:2:0*, which
  20261030.6 replaced; the click threw, the other settings of that step were never set, and
  the publish of 20261030.6 stopped there (site run 41164816290; the live site stayed as it
  was). It chooses *Least data* now, whose `/gfx` does not depend on the browser's hardware
  (`/gfx:AV2:i444,AV1:i444,AVC444,AVC420,progressive,RFX`). Run here against that release's
  files: 53 passed, no page errors. The page itself is unchanged.

## 20261030.6

- **Session settings, Video: a list of codecs, in an order** (聪哥's idea: least data first,
  least CPU first, and a custom order). Next to Automatic, which still sends a bare `/gfx`:
  *Least data* (`/gfx:AV2:i444,AV1:i444,AVC444,AVC420,progressive,RFX`), *Least CPU* (H.264
  4:2:0, one stream the browser decodes in hardware; AV1 4:2:0 first where WebCodecs has a
  hardware AV1 decoder; no AV2, which this page decodes in software) and *Custom*. Each shows
  its rows: on or off, 4:4:4 or 4:2:0 for AV2, AV1 and H.264, what decodes it in this
  browser, and whether it is offered. Rows move by drag and drop, or by their arrows (touch
  screens, keyboards); a change to a preset's list makes it Custom, stored with the host.
  - **Why some rows say "not offered".** RDP lets a client say which codecs it takes, not in
    what order: it advertises capability sets and the server confirms one, the best it knows
    (FreeRDP's shadow server: FRDP_2 for AV2, then FRDP_1 for AV1, then 10.x, where H.264
    comes before RemoteFX). So `options.js` keeps the list's order by leaving out a codec
    the server would take before one placed above it, and names that one. A real preference
    order would need a field in FreeRDP's own FRDP capability sets, which servers we ship
    could honour; that is a later step.
  - **4:4:4 means 4:4:4.** For AV1 and AV2 the client asks for one profile: a FreeRDP server
    set to 4:2:0 refuses the AV1 set of a client that asks for 4:4:4
    (`shadow_client.c`), so there is one choice per codec, not both. For H.264, 4:4:4 offers
    AVC444 and AVC420; 4:2:0 offers only AVC420 (FreeRDP then advertises up to 8.1).
  - The old choices AV1 4:2:0 and AV1 4:4:4 become a Custom list that sends what they did
    (AV2 was on by FreeRDP's default then too). Unit tests for the presets, the order rule,
    the migration and a stored list; the Chinese in `i18n.js`.

## 20261030.5

- **About: an AV2 decoder row** when the web client was built with AV2 (the kit's
  MANIFEST names `avm`, libavm; FreeRDP#13925): "libavm <version> (in this page)", as no
  browser decodes AV2. The client offers AV2 with AV1 (Session settings' Auto); a server
  picks it only when told to (e.g. the kit's Windows host with `/gfx-av2`). `about.js`,
  its unit test, the Chinese in `i18n.js`.

## 20261030.4

- **Get a server: the Windows host's video**: `demo/demo.json`'s new `windows` videos (the
  kit records FreeRDP Web on its Windows host: the Start menu, Notepad, typing, in AV1)
  show in the Windows section, under its commands, as freerdp-tk's do on Get a client.
  Get a server now reads `demo.json` too; without it, or without `windows`, nothing
  changes. `server.js` `clips(demo, kind)` and one shelf builder for both pages; unit test
  and `test-server.mjs`.

## 20261030.3

- **Get a server: Windows** (聪哥: a Windows backend, "go ahead to do them all"): when
  `install.json` has the kit's Windows host (its new `windows` entry: FreeRDP's shadow
  server and freerdp-shadow-service, FreeRDP#13931-#13935), Get a server shows a section
  after xrdp's "Start it": what it shares (the PC's own screen, logon and lock screens,
  UAC and Ctrl+Alt+Del through the service; AV1; Windows-account logins), the PowerShell
  line that downloads, unpacks and installs the service on 127.0.0.1, the one that removes
  it, and the archive. The distributions' links get a "Windows" one. Without the entry,
  nothing changes. `server.js` `parse()` takes it only with an https link and a command;
  unit test, `test-server.mjs` and the sample `install.json`; Chinese in `i18n.js`.

## 20261030.2

- **Get a client, a new page** (聪哥: Get a server also held the client and its demo, and
  Install as app was a little confusing): `client.html` puts the three ways to connect side by
  side: in this browser (through a WebSocket gateway, the usual way), as a Chrome app (no
  gateway, but two flags and developer mode, so probably not needed), and a native client
  (the kit's clients, freerdp-tk with `uvx freerdp-tk`, and its demo videos, all moved from
  Get a server). **Get a server** keeps only the servers, and its *Then connect* links to Get
  a client. The header's **Install as app** becomes **Get a client** on every page; the
  install page stays, linked from Get a client and the form's Direct TCP, and starts with
  *You probably don't need this.*, why, and the link. `server.js` fills whichever of the two
  pages it is on; the Chinese of the new lines is in `i18n.js`; `test-server.mjs` checks the
  client page, its fallbacks and every header, `test-i18n.mjs` and `test-page.mjs` take the
  new page.

## 20261030.1

- **Get a server: plain `uvx freerdp-tk`** (was `uvx --managed-python freerdp-tk`), since
  freerdp-tk 0.3.2 starts again with uv's own Python by itself when uvx took one without Tk.
  The line no longer explains the Python. `server.js`, its Chinese line in `i18n.js`, and
  `test-server.mjs`'s list of commands.

## 20261028.11

- **Get a server shows freerdp-tk** (聪哥: demo videos of the native client, one for the
  release, one for uvx): under the native clients, what freerdp-tk is (the connection window
  each client comes with, the password in the system's own keyring), how to start it from the
  unpacked file, `uvx --managed-python freerdp-tk` with its Copy button for the window alone
  (uv's own Python, which has Tk: plain uvx takes the system's when there is one, and
  Debian's has no Tk without `python3-tk`), and the kit's two
  videos of it, side by side on a wide screen, one above the other on a phone. The videos come
  from `demo/demo.json`'s `clients`, which the kit records (`test/record-demos.sh`,
  `client-release` and `client-uvx`) and its site puts next to the page; only files in
  `demo/` are taken, a video loads nothing until it is played (`preload="none"`), and without
  them the rest of the page is as before. `server.js` `clips()`, its unit test, and
  `test-server.mjs` checks the heading, the uvx line and the videos; the Chinese of the new
  lines is in `i18n.js`.

## 20261028.10

- **English and Simplified Chinese** (聪哥): the page follows the browser's language, English
  the default. A browser whose first English or Chinese language is Chinese (any region) gets
  Simplified Chinese; everyone else English, which stays in the HTML (the page without
  JavaScript). The 🌐 Language switch next to Theme picks Auto, English or 中文, remembered in
  this browser (`localStorage` freerdp-web-lang); a switch applies at once. `web/i18n.js` holds
  the Chinese (553 strings) and applies it with textContent and setAttribute only (the
  installed app's Trusted Types), `lang="zh-Hans"`; scripts translate what they build through
  `FreeRDPi18n.t()`. Commands, codec names, versions, log lines and the release kit's data
  (install.json, the demo videos' titles and captions) stay English, the release-note entries
  too (a Chinese note says so). `test-i18n.mjs`: 33 checks, English unchanged on every page.
- **About: a row per decoder**: "AV1 decoder: WebCodecs (browser); fallback: dav1d 1.5.4 (in
  this page)", "H.264 decoder: WebCodecs (browser)", "Audio decoder: Opus 1.6.1", not one row.

## 20261028.9

- **Get a server: a line per kind of session**: an `install.json` whose sessions read
  "Wayland: …; Xorg: …" (the release kit's from 2026-10-28 on) shows each on its own line, its
  label in bold; an older one keeps its single "Sessions:" line. `test-server.mjs` 21 checks.

## 20261028.8

- **Each mascot plays to its end, then holds 3 s** (聪哥): its last frame stays 3 s before the
  next turn, as the slogan does; a clip that cannot play moves on after 15 s.

## 20261028.7

- **The card is just the picture, as a marquee** (聪哥: the caption and the buttons took too much
  space): the slogan for 3 s, then 蛮蛮 and then the twins, each playing its clip once, round
  and round; a clip that cannot play moves on after 12 s. The caption is for screen readers
  only (`sr-only`); the Twins / 蛮蛮 buttons and the remembered choice go.

## 20261028.6

- **The slogan and the mascot take turns** (聪哥's design): the card beside the tagline shows
  "You here, you in the cloud: one desktop." (你在这里，也在云端。) for 4 s, then the chosen
  mascot plays once, then the slogan again. Twins or 蛮蛮 under it picks the mascot, which then
  plays at once. The video plays for everyone, reduced motion too (his choice); 蛮蛮's still
  picture is its poster while the video loads, and the frame poster it replaced goes.

## 20261028.5

- **蛮蛮's still picture for reduced motion**: with `prefers-reduced-motion`, the 蛮蛮 card shows
  Gemini's picture of the pair (one wing and one eye each), not a frame of the video
  (`mascot-manman-still.webp`, 11 KB, the whole picture fitted with white sides; the video's
  `data-still`).

## 20261028.4

- **A second mascot, 蛮蛮**, the paired bird of the Classic of Mountains and Seas (《山海经·西山经》:
  "有鸟焉，其状如凫，而一翼一目，相得乃飞，名曰蛮蛮"): each bird has one wing and one eye, and they
  fly only together, like this page and the desktop in the cloud. Two buttons under the card,
  Twins and 蛮蛮, show one at a time; the choice is remembered (`localStorage`, when the
  browser allows it). Only the one shown plays, and none for reduced motion; the hidden one is
  not loaded until picked (`preload="none"`). `mascot-manman.mp4` (H.264 560 x 240, 170 KB)
  and its poster (7 KB), made with Google Gemini (Veo), cropped and re-encoded without sound.

## 20261028.3

- **A mascot**: two twins, one at your laptop and one in the cloud, joined by a wave, waving
  at the same moment: "Entangled twins: you here, you in the cloud. Real entanglement carries
  no message; these two carry every key you press." A muted 10 s loop beside the tagline
  (`mascot.mp4`, H.264 560 x 240, 66 KB, with its poster `mascot-poster.webp`, 6 KB), above it
  on a phone, gone during a session, and still for people who ask for less motion
  (`prefers-reduced-motion`). Made with Google Gemini (Veo), cropped and re-encoded without
  sound with ffmpeg.

## 20261028.2

- **Get a server** (`server.html`, a new page in every page's header): how to get an RDP
  server and the native clients. One card per distribution release (Debian, Ubuntu, Fedora)
  with its sessions and one command to install the release kit's xrdp, the extra commands
  under it (Fedora's xorgxrdp, and on Fedora 45 the kit's Mutter with the fix for windows on
  the wrong monitor), the start command, the clients with their links, and the kit release
  they come from. It reads `install.json`, which the release kit puts next to the page when it
  publishes the site (rdp-release-kit `c300986`); without it, or with one it cannot read, the
  page links to the kit's latest release. Built with `textContent` only (the installed app's
  Trusted Types), links only to `https:`. `test-server.mjs`: 20 checks, the fallbacks and a
  390 px phone width among them. Copy buttons now work for commands added after the page loaded.
- **Info is the session, About is the client**: the toolbar's Info showed the live session
  (server, codecs in use, hardware or software decoding) mixed with what the client was built
  with. Info keeps the session only; the build's facts move to About (`about.js`): under the
  form as "About this client", and on a session's toolbar as About. It has the version, the
  engine (JSPI or Asyncify), FreeRDP and SDL with their commits, the libraries, the decoders
  (WebCodecs, dav1d as AV1's fallback, Opus), the build date, this page's commit and the kit
  release, read from the client's `MANIFEST` and the site's `RELEASE`; a missing file leaves
  its rows out. The test ids and the Info rows the tests read are unchanged.

## 20261028.1

No change to the page itself; its tests and documentation.

- **The screens tests no longer go on before the window they test has opened, nor hang at
  the end**: `test-screens-wlup.mjs` waited for the middle of the canvas to turn dark before
  choosing Separate screens, but GNOME's overview right after login is dark too. On a slow
  server (the release kit's GNOME server held to one CPU) the test went on before foot had
  opened in 12 of 30 runs; foot was then placed after the layout change, and the check that
  the session's windows stay on this window's screen failed for a reason that is not the one
  it tests. foot now runs with a background of its own (`b4146e`) and the test waits for that
  colour: 9 of 9 runs had foot open in time. Both screens tests closed the second window with
  a `window.close()` that a closing page may never answer, and hung (3 times in 60 runs); they
  now wait 5 s at most. The tests also remove Chrome's temporary directory when they are
  stopped or fail.
- **The site is published by the release kit**: this repository is the page's source and its
  releases; the kit builds the client with a release, tests the pair, records the demo videos
  and publishes https://congzhangzh.github.io/freerdp-web/ from one of its releases
  (`pages.yml`, `media.json` and `kit-test.sh` are gone; `test.yml` runs the unit tests).
  The docs name the kit's xrdp as the only one, and its demo videos lose "preview".

## 20261027.2

- **A logoff is the end of the session, not a lost connection**: FreeRDP's SDL client exits
  with its own codes (`client/SDL/SDL3/sdl_utils.hpp`), and the page took every code but 0 for
  a lost connection. After a logoff from an xrdp that sends Set Error Info and the Disconnect
  Provider Ultimatum (xrdp devel, the release kit's preview) the client exits with 2, LOGOFF,
  and the page logged in again. The codes that say the session itself is over (disconnected
  or logged off by the server or the user, a timeout, another connection took it over,
  refused, licensing) now end it, and the end bar says why ("The session ended: logged off.").
  Other codes and a lost connection are retried as before. Found by the release kit's runs of
  test-reconnect on the preview, with its new log dump.

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
