// The pages "Get a server" (server.html: the release kit's xrdp packages) and "Get a client"
// (client.html: its native clients), from install.json, which the kit writes next to the page when
// it publishes the site:
//   { release, url, server: [{ name, sessions, command, more: [{ what, command }] }], start,
//     clients: [{ platform, file, url }], windows: { file, url, command, remove } }
// "linux" is the Linux host (since kit 2026-11-05), one entry per processor:
//   [{ platform, file, url, unit, command, then, kickstart, log, remove }]
// FreeRDP's shadow server as a systemd user unit. "sesman", when the kit writes it, is its session
// manager: { command, remove, headless?, ssh? }. Its section shows only when the file has it, so the
// kit decides when it is ready, without a new page.
// "windows" is the Windows host (since kit 2026-10-30): FreeRDP's shadow server and
// freerdp-shadow-service, which share a Windows PC's own screen; Get a server shows it after xrdp.
// "mac" is the macOS host (since kit 2026-11-02), one entry per processor:
//   [{ platform, file, url, command, then, kickstart?, remove }]
// FreeRDP's shadow server as an app with a LaunchAgent; "command" installs it in Terminal, "then"
// says (in English) to allow it in System Settings and to restart it with a command at its end
// ("run: launchctl kickstart …"); the page writes that sentence in its own words and shows only the
// command ("kickstart" if the kit gives it alone).
// Get a server has a tab per system: Linux (the shadow server, xrdp, the desktop's own server), Windows
// (its own Remote Desktop, the shadow server), macOS (the shadow server), and Notes.
// One entry of "server" per distribution release ("Debian 13", "Ubuntu 26.04", "Fedora 45"…);
// the page groups them by the name's first word. Without the file, or with one it cannot read
// (a local build), each page keeps its one line that links to the kit's latest release.
// With the native clients, Get a client shows freerdp-tk, their connection window, and its demo videos:
// demo/demo.json's "clients" (the kit records them; without them, no videos).
// Everything is built with textContent, never as HTML: the installed app requires Trusted Types.
(function (root) {
  "use strict";
  const LATEST = "https://github.com/congzhangzh/rdp-release-kit/releases/latest";
  const text = (v) => (typeof v === "string" ? v.trim() : "");
  // links only to https: addresses (never javascript: or the like)
  const https = (v) => { try { const u = new URL(text(v)); return u.protocol === "https:" ? u.href : ""; } catch (e) { return ""; } };
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "other";
  // the page's own words in the visitor's language (i18n.js); install.json's stay as written
  const t = (key, text, vars) => root.FreeRDPi18n?.t(key, text, vars) ?? text;

  // install.json's content, checked: what the page can show, or null when there is nothing to show
  // (no distribution with a name and a command). Unknown fields are ignored, bad entries skipped.
  function parse(data) {
    if (!data || typeof data !== "object" || !Array.isArray(data.server)) return null;
    const families = [];
    for (const s of data.server) {
      const name = text(s?.name), command = text(s?.command);
      if (!name || !command) continue;
      const more = (Array.isArray(s.more) ? s.more : [])
        .map((m) => ({ what: text(m?.what), command: text(m?.command) })).filter((m) => m.command);
      const family = name.split(/\s+/)[0];
      let f = families.find((x) => x.name === family);
      if (!f) families.push(f = { name: family, id: "server-" + slug(family), servers: [] });
      f.servers.push({ name, sessions: text(s.sessions), command, more });
    }
    if (!families.length) return null;
    const clients = (Array.isArray(data.clients) ? data.clients : [])
      .map((c) => ({ platform: text(c?.platform), file: text(c?.file), url: https(c?.url) })).filter((c) => c.file && c.url);
    const w = data.windows;
    const windows = w && typeof w === "object" && text(w.command) && https(w.url)
      ? { file: text(w.file), url: https(w.url), command: text(w.command), remove: text(w.remove) } : null;
    // the macOS host: an entry per processor with an https link and a command
    const restart = (m) => text(m?.kickstart) || (text(m?.then).match(/\brun:\s*(\S.*)$/) || [])[1] || "";
    const mac = (Array.isArray(data.mac) ? data.mac : [])
      .map((m) => ({ platform: text(m?.platform), file: text(m?.file), url: https(m?.url), command: text(m?.command),
        then: text(m?.then), kickstart: restart(m), remove: text(m?.remove) }))
      .filter((m) => m.platform && m.url && m.command);
    // the Linux host: as the macOS one, an entry per processor; its session manager when the kit
    // says it is ready
    const linux = (Array.isArray(data.linux) ? data.linux : [])
      .map((l) => ({ platform: text(l?.platform), file: text(l?.file), url: https(l?.url), command: text(l?.command),
        kickstart: text(l?.kickstart), log: text(l?.log), remove: text(l?.remove) }))
      .filter((l) => l.platform && l.url && l.command);
    const s = data.sesman;
    const sesman = linux.length && s && typeof s === "object" && text(s.command)
      ? { command: text(s.command), remove: text(s.remove), headless: text(s.headless), ssh: text(s.ssh) } : null;
    // AV2 for xrdp: the line that turns it on, when the release's packages have it
    const a = data.av2;
    const av2 = a && typeof a === "object" && text(a.command) ? { what: text(a.what), command: text(a.command) } : null;
    return { release: text(data.release), url: https(data.url) || LATEST, families, start: text(data.start), clients, linux, sesman, windows, mac, av2 };
  }

  // demo.json's videos of a kind: "clients" (freerdp-tk, Get a client), "windows" or "mac" (the
  // Windows and macOS hosts, Get a server): [{ title, src, poster, caption }], files next to the page in
  // demo/ only; anything else is skipped. Title and caption in the page's language where the kit
  // wrote one (the entry's i18n.<lang>, i18n.js's kit()), else in English.
  const local = (v, ext) => (new RegExp("^demo/[\\w.-]+\\." + ext + "$").test(text(v)) ? text(v) : "");
  function clips(demo, kind = "clients", lang = root.FreeRDPi18n?.lang) {
    const kitWords = (c, field) => text(root.FreeRDPi18n?.kit ? root.FreeRDPi18n.kit(c, field, lang) : c?.[field]);
    return (Array.isArray(demo?.[kind]) ? demo[kind] : [])
      .map((c) => ({ title: kitWords(c, "title"), src: local(c?.src, "mp4"), poster: local(c?.poster, "jpg"), caption: kitWords(c, "caption") }))
      .filter((c) => c.title && c.src);
  }

  // ---- the page ----
  function el(tag, props = {}, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) if (k === "text") e.textContent = v; else e.setAttribute(k, v);
    for (const c of children) if (c) e.append(c);
    return e;
  }
  const link = (href, label) => el("a", { href, target: "_blank", rel: "noopener", text: label });
  // a command and its Copy button, as on the other help pages (help.js copies the <pre>)
  const copyable = (command) => el("div", { class: "copyable" },
    el("pre", { class: "wrap", text: command }), el("button", { class: "small", type: "button", "data-copy": "", text: t("copy", "Copy") }));

  // "Wayland: GNOME, KDE Plasma, sway; Xorg: the default session": a line per kind, its label in
  // bold; an older install.json's one line ("GNOME, KDE, sway; Xorg with xorgxrdp") stays one
  const sessions = (v) => {
    if (!v) return [];
    const parts = v.split(/;\s*/).filter(Boolean);
    if (!parts.every((p) => /^[A-Z][\w ]*: /.test(p))) return [el("p", { class: "hint", text: t("srv.sessions", "Sessions: " + v, { sessions: v }) })];
    return parts.map((p) => {
      const i = p.indexOf(": ");
      return el("p", { class: "hint" }, el("b", { text: p.slice(0, i + 1) }), p.slice(i + 1));
    });
  };

  // the videos' titles and captions are the kit's, in the page's language where it wrote one
  function shelf(videos) {
    const s = el("div", { class: "clips" });
    for (const v of videos) {
      const video = el("video", { controls: "", preload: "none", playsinline: "", src: v.src });
      if (v.poster) video.setAttribute("poster", v.poster);
      s.append(el("figure", { class: "clip" }, video, el("figcaption", {}, el("b", { text: v.title }), v.caption ? " " + v.caption : "")));
    }
    return s;
  }

  const from = (k) => el("p", { class: "muted" }, t("srv.from", "From the release kit's release "),
    link(k.url, k.release || t("srv.onGithub", "on GitHub")), t("srv.fromEnd", ", the one this site was published from."));
  const all = (k) => el("p", {}, t("srv.all", "All files and checksums: "), link(k.url, k.url));

  // Tabs: systems (Linux, Windows, macOS, Notes) and, under xrdp, distributions, one of each shown
  // at a time. A tab is a plain link to its panel's id, and a panel holds its sections, so a link to
  // any section keeps working: #windows opens that tab, #server-fedora opens Linux and Fedora,
  // #av2 opens Notes. data-tab on a panel names its group; view remembers each group's choice, so
  // that a change of language, which draws the page again, stays on the same tabs.
  const view = {};
  const tabs = (group, label, items) => {
    const nav = el("nav", { class: "tabs", "data-group": group, "aria-label": label });
    for (const i of items) nav.append(el("a", { href: "#" + i.id, text: i.label }));
    return nav;
  };
  function select(group, id) {
    view[group] = id;
    for (const p of document.querySelectorAll(`[data-tab="${group}"]`)) p.hidden = p.id !== id;
    for (const a of document.querySelectorAll(`.tabs[data-group="${group}"] a`))
      if (a.getAttribute("href") === "#" + id) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current");
  }
  // every tab around an element, outermost last
  function reveal(e) { for (let p = e; p; p = p.parentElement) if (p.dataset?.tab) select(p.dataset.tab, p.id); }
  // the address's section, if it is one of these: its tabs open, and it comes into view
  function fromAddress(into) {
    let id = "";
    try { id = decodeURIComponent(location.hash.slice(1)); } catch (e) {}
    const target = id && document.getElementById(id);
    if (!target || !into.contains(target)) return false;
    reveal(target);
    (target.dataset.tab === "system" ? into.querySelector(".tabs") : target).scrollIntoView();
    return true;
  }
  // after each drawing: the choice so far or each group's first, then the address on the first one
  function settle(into) {
    for (const nav of into.querySelectorAll(".tabs")) {
      const group = nav.dataset.group, first = nav.querySelector("a").getAttribute("href").slice(1);
      select(group, view[group] && document.getElementById(view[group]) ? view[group] : first);
    }
  }

  // Get a server: a tab per system and Notes. Linux has the shadow server, xrdp (a tab per family
  // of distributions, a card per release, the start command) and the desktop's own server
  function renderServer(k, into, videos = {}) {
    const page = document.createDocumentFragment();
    page.append(from(k));
    const panels = [];
    const panel = (id, label) => {
      const p = el("section", { id, "data-tab": "system" });
      panels.push({ id, label, p });
      return p;
    };
    let out = panel("linux", "Linux");
    out.append(el("h2", { class: "sr-only", text: "Linux" }));
    const ways = el("ul", {});
    if (k.linux.length) ways.append(el("li", {}, el("a", { href: "#linux-shadow", text: t("srv.shadowName", "FreeRDP's shadow server") }), t("srv.waysShadow", ": this computer's own screen, the session that is already there.")));
    ways.append(el("li", {}, el("a", { href: "#xrdp", text: "xrdp" }), t("srv.waysXrdp", ": a desktop of its own for each login; the computer needs no screen and nobody logged in.")),
      el("li", {}, el("a", { href: "#linux-own", text: t("srv.ownName", "The desktop's own server") }), t("srv.waysOwn", ": GNOME Remote Desktop or KRdp, already in your desktop.")));
    out.append(ways);
    if (k.linux.length) {
      const first = k.linux[0];
      out.append(el("h3", { id: "linux-shadow", text: t("srv.shadowName", "FreeRDP's shadow server") }),
        el("p", { text: t("srv.linuxWhy", "It shares this computer's own screen, the session that is already there: GNOME on Wayland or X11, and other X11 desktops such as Xfce and MATE. KDE on Wayland and sway are not supported yet. It starts with your session, so it cannot show the login screen.") }),
        el("p", { text: t("srv.linuxInstall", "As yourself, no root: download, unpack and install a systemd user unit, which starts it with your desktop, on 127.0.0.1:3389. For your processor:") }));
      const list = el("div", { class: "distros" });
      for (const l of k.linux) list.append(el("section", { class: "distro", "aria-label": "Linux " + l.platform }, el("h5", { text: l.platform }), copyable(l.command)));
      out.append(list, el("p", { text: t("srv.linuxLogin", "The login is your own account, the one whose desktop it is; any other is refused. Keep it on 127.0.0.1 and reach it through SSH.") }));
      if (first.kickstart) out.append(el("p", { class: "hint", text: t("srv.linuxRestart", "After GNOME's Stop sharing, or to apply a change:") }), copyable(first.kickstart));
      if (first.remove) out.append(el("p", { class: "hint", text: t("srv.linuxRemove", "To remove it:") }), copyable(first.remove));
      const files = el("p", { class: "hint" }, t("srv.linuxMore", "The archives: "));
      k.linux.forEach((l, i) => files.append(i ? t("list.sep", ", ") : "", link(l.url, l.file || l.url)));
      files.append(t("punct.period", "."));
      out.append(files);
      if (k.sesman) {
        const m = k.sesman;
        out.append(el("h4", { id: "session-manager", text: t("srv.sesman", "The session manager") }),
          el("p", { text: t("srv.sesmanWhy", "Optional, and it runs as root: one port for every user of this computer, on 127.0.0.1:3391, for several users or a computer where nobody is logged in. Each connection reaches the GNOME session of the user it names. For one person with a logged-in desktop, the user unit above is enough. GNOME only (Mutter 45 or newer), tested with headless sessions.") }),
          copyable(m.command));
        if (m.headless) out.append(el("p", { text: t("srv.sesmanHeadless", "With nobody logged in: a user of the group freerdp-headless gets a GNOME session, started by their first connection. A user with neither a session nor the group is refused with no reason given: the connection just drops.") }), copyable(m.headless));
        out.append(el("p", { class: "warn", text: t("srv.sesmanWarn", "Anyone who can reach the port can start a session for a member of the group, before any password, and it stays running. Keep the group small and the port on 127.0.0.1 or a private network. A session gives no access: the login still happens in the shadow server. A WebSocket gateway in front of the port widens who can reach it to whoever reaches the gateway; an SSH tunnel doesn't.") }));
        if (m.remove) out.append(el("p", { class: "hint", text: t("srv.linuxRemove", "To remove it:") }), copyable(m.remove));
      }
    }
    out.append(el("h3", { id: "xrdp", text: "xrdp" }));
    if (k.families.length > 1) out.append(tabs("family", t("srv.distros", "Distributions"), k.families.map((f) => ({ id: f.id, label: f.name }))));
    for (const f of k.families) {
      const family = el("section", { id: f.id, "data-tab": "family" }, el("h4", { class: "sr-only", text: f.name }));
      const list = el("div", { class: "distros" });
      for (const s of f.servers) {
        const card = el("section", { class: "distro", "aria-label": s.name }, el("h5", { text: s.name }),
          ...sessions(s.sessions), copyable(s.command));
        for (const m of s.more) card.append(el("p", { class: "hint", text: t("srv.more", (m.what || "Also") + ":", { what: m.what || t("srv.also", "Also") }) }), copyable(m.command));
        list.append(card);
      }
      family.append(list);
      out.append(family);
    }
    if (k.start) out.append(el("h4", { text: t("srv.start", "Start it") }), copyable(k.start));
    out.append(el("h3", { id: "linux-own", text: t("srv.ownName", "The desktop's own server") }),
      el("p", { text: t("srv.ownWhy", "Nothing to download: GNOME and KDE Plasma have an RDP server of their own.") }),
      el("ul", {},
        el("li", {}, el("b", { text: "GNOME Remote Desktop" }), t("srv.ownGnome", ": in Settings, System, Remote Desktop. It has an account of its own, not your system login. With none set, a client is just disconnected, which looks like a network problem.")),
        el("li", {}, el("b", { text: "KRdp" }), t("srv.ownKde", ": in KDE Plasma's System Settings, Remote Desktop. Not tried with this page yet."))));
    if (k.windows) out = panel("windows", "Windows");
    if (k.windows) {
      const w = k.windows;
      out.append(el("h2", { class: "sr-only", text: "Windows" }),
        el("h3", { text: t("srv.winRdp", "Its own Remote Desktop: nothing to install") }),
        el("p", { text: t("srv.winRdpWhy", "Windows Server, and Windows Pro and Enterprise, have a Remote Desktop server of their own: turn it on (Settings, System, Remote Desktop), and FreeRDP Web reaches it through a gateway on that PC, as it reaches xrdp. Each user gets a session of their own, with its sound.") }),
        el("h3", { text: t("srv.winShadow", "Share this PC's own screen: FreeRDP's shadow server") }),
        el("p", { text: t("srv.winWhy", "FreeRDP's shadow server shares the Windows PC's own screen: the desktop of whoever is logged in and, run as a service, the logon and lock screens, UAC prompts and Ctrl+Alt+Del too. It shares that one desktop, like Remote Assistance; it starts no sessions of its own. The picture is AV1, or AV2 with /gfx-av2 after /gfx-av1; logins are Windows accounts.") }),
        el("p", { text: t("srv.winInstall", "In an administrator's PowerShell: download, unpack, install the service (it starts at once, and with Windows, on 127.0.0.1:3389):") }),
        copyable(w.command));
      if (w.remove) out.append(el("p", { class: "hint", text: t("srv.winRemove", "To remove it, in the same folder:") }), copyable(w.remove));
      out.append(el("p", { class: "hint" }, t("srv.winMore", "If Windows' own Remote Desktop is on, it holds 3389: add /port:3388. How to reach it through SSH, and the rest: README.txt in the archive, "),
        link(w.url, w.file || w.url), t("punct.period", ".")));
      if (videos.windows?.length) out.append(shelf(videos.windows));
    }
    if (k.mac.length) out = panel("macos", "macOS");
    if (k.mac.length) {
      const first = k.mac[0];
      out.append(el("h2", { class: "sr-only", text: "macOS" }),
        el("h3", { text: t("srv.macShadow", "Share this Mac's own screen: FreeRDP's shadow server") }),
        el("p", { text: t("srv.macWhy", "FreeRDP's shadow server for macOS shares the Mac's own screen and its sound: the desktop of the user who is logged in, in their session (not the login window). It shares that one desktop and starts no sessions of its own. The picture is AV2 for the clients that offer it (the kit's FreeRDP clients and FreeRDP Web), AV1 for the others that have it, else H.264 from the Mac's own VideoToolbox; the login is your macOS account.") }),
        el("p", { text: t("srv.macInstall", "In Terminal, for your Mac's processor: download, unpack, copy the app to Applications and its LaunchAgent, which starts it now and at each login, on 127.0.0.1:3389:") }));
      const list = el("div", { class: "distros" });
      for (const m of k.mac) list.append(el("section", { class: "distro", "aria-label": "macOS " + m.platform }, el("h5", { text: m.platform }), copyable(m.command)));
      out.append(list);
      // the same for both processors: the permissions, the restart, the removal
      if (first.kickstart) out.append(el("p", { text: t("srv.macAllow", "The first start asks for two permissions: in System Settings, Privacy & Security, allow FreeRDP Shadow under Screen & System Audio Recording (the picture and the sound) and under Accessibility (the keyboard and the mouse). Then restart it:") }),
        copyable(first.kickstart));
      else if (first.then) out.append(el("p", { text: first.then }));
      if (first.remove) out.append(el("p", { class: "hint", text: t("srv.macRemove", "To remove it:") }), copyable(first.remove));
      const files = el("p", { class: "hint" }, t("srv.macMore", "After an update, macOS asks for both permissions again (the app is signed ad hoc, so macOS knows only that build): remove FreeRDP Shadow from both lists, then allow the new one. How to reach it through SSH, and the rest: README.txt in the archive, "));
      k.mac.forEach((m, i) => files.append(i ? t("list.sep", ", ") : "", link(m.url, m.file || m.url)));
      files.append(t("punct.period", "."));
      out.append(files);
      if (videos.mac?.length) out.append(shelf(videos.mac));
    }
    out = panel("notes", t("srv.notes", "Notes"));
    out.append(el("h2", { class: "sr-only", text: t("srv.notes", "Notes") }));
    if (k.av2) {
      out.append(el("h3", { id: "av2", text: "AV2" }),
        el("p", { text: t("srv.av2", "AV2 is on: xrdp sends it to the clients that offer it (the kit's FreeRDP clients and FreeRDP Web), and AV1 or H.264 to the others. To put AV1 first again:") }),
        copyable(k.av2.command),
        el("p", { class: "hint", text: t("srv.av2Cost", "Smaller frames for the same picture, for more processor time on both sides: FreeRDP Web decodes AV2 in the page, in software.") }));
    }
    out.append(all(k));
    page.append(tabs("system", t("srv.systems", "Systems"), panels), ...panels.map((p) => p.p));
    into.replaceChildren(page);
    settle(into);
  }

  // Get a client: the native client's three ways (uvx, the offline pack, pip), then freerdp-tk and
  // its videos
  function renderClients(k, into, videos = []) {
    const out = document.createDocumentFragment();
    out.append(from(k),
      el("h3", { id: "uvx", text: t("cli.uvx", "With uvx") }),
      el("p", { text: t("cli.uvxWhy", "One line, if you have uv: it brings the client, a Python with Tk and the connection window.") }),
      copyable("uvx freerdp-tk"),
      el("h3", { id: "offline", text: t("cli.offline", "Download: an offline pack") }),
      el("p", { text: t("cli.offlineWhy", "An archive with everything inside, for a computer with no Python or no network. Unpack it and start freerdp-tk (Windows: freerdp-tk.cmd; macOS: freerdp-tk.command, in Finder).") }));
    const table = el("table", { id: "clients" }, el("tr", {}, el("th", { text: t("srv.platform", "Platform") }), el("th", { text: t("srv.file", "File") })));
    for (const c of k.clients) table.append(el("tr", {}, el("td", { text: c.platform }), el("td", {}, link(c.url, c.file))));
    out.append(table,
      el("h3", { id: "pip", text: t("cli.pip", "With pip") }),
      el("p", { text: t("cli.pipWhy", "Into a Python 3.10 or newer that has Tk. A Linux system Python often lacks it: freerdp-tk then says what to install.") }),
      copyable("pip install freerdp-tk"),
      el("h3", { id: "freerdp-tk", text: t("srv.tk", "freerdp-tk, the connection window") }),
      el("p", { text: t("srv.tkWhy", "All three give you freerdp-tk: a window that keeps your connections, their passwords in the system's own keyring, and starts the client.") }));
    if (videos.length) out.append(shelf(videos));
    out.append(all(k));
    into.replaceChildren(out);
  }

  const api = { parse, clips, LATEST };
  root.FreeRDPServer = api;
  if (typeof module !== "undefined" && module.exports) { module.exports = api; return; }
  // any failure (no file, not JSON, nothing usable, a bug) keeps the fallback line
  const server = document.getElementById("kit"), native = document.getElementById("native");
  const into = server || native;
  // the videos are extra: without demo.json the rest still shows
  const demo = () => fetch("demo/demo.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (into) Promise.all([fetch("install.json", { cache: "no-cache" }), demo()])
    .then(([r, d]) => { if (!r.ok) throw new Error("install.json: HTTP " + r.status); return r.json().then((data) => [data, d]); })
    .then(([data, d]) => {
      const k = parse(data); if (!k) throw new Error("install.json: no distribution in it");
      if (native && !k.clients.length) throw new Error("install.json: no client in it");
      // the videos read again in each language: their titles and captions follow it
      const videos = () => (server ? { windows: clips(d, "windows"), mac: clips(d, "mac") } : clips(d, "clients"));
      const show = () => (server ? renderServer(k, into, videos()) : renderClients(k, into, videos()));
      show();
      if (server) {
        fromAddress(into);
        addEventListener("hashchange", () => fromAddress(into));
        // a tab changes what shows without moving the page, and its address can still be copied
        into.addEventListener("click", (e) => {
          const a = e.target.closest?.(".tabs a");
          if (!a || e.ctrlKey || e.metaKey || e.shiftKey) return;
          e.preventDefault();
          history.replaceState(null, "", a.getAttribute("href"));
          reveal(document.getElementById(a.getAttribute("href").slice(1)));
        });
      }
      root.FreeRDPi18n?.onChange(show);   // a new language: the page's part again
    })
    .catch((e) => console.log("[page] " + (e?.message || e) + "; the page links to the kit's latest release"));
})(globalThis);
