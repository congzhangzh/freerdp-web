// The pages "Get a server" (server.html: the release kit's xrdp packages) and "Get a client"
// (client.html: its native clients), from install.json, which the kit writes next to the page when
// it publishes the site:
//   { release, url, server: [{ name, sessions, command, more: [{ what, command }] }], start,
//     clients: [{ platform, file, url }] }
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
    return { release: text(data.release), url: https(data.url) || LATEST, families, start: text(data.start), clients };
  }

  // demo.json's freerdp-tk videos: [{ title, src, poster, caption }], files next to the page in
  // demo/ only; anything else is skipped
  const local = (v, ext) => (new RegExp("^demo/[\\w.-]+\\." + ext + "$").test(text(v)) ? text(v) : "");
  function clips(demo) {
    return (Array.isArray(demo?.clients) ? demo.clients : [])
      .map((c) => ({ title: text(c?.title), src: local(c?.src, "mp4"), poster: local(c?.poster, "jpg"), caption: text(c?.caption) }))
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

  const from = (k) => el("p", { class: "muted" }, t("srv.from", "From the release kit's release "),
    link(k.url, k.release || t("srv.onGithub", "on GitHub")), t("srv.fromEnd", ", the one this site was published from."));
  const all = (k) => el("p", {}, t("srv.all", "All files and checksums: "), link(k.url, k.url));

  // Get a server: a card per distribution, grouped by family, and the start command
  function renderServer(k, into) {
    const out = document.createDocumentFragment();
    out.append(from(k), el("h2", { text: t("srv.install", "Install xrdp") }));
    if (k.families.length > 1) {
      const jump = el("p", { class: "row families", "aria-label": t("srv.distros", "Distributions") });
      for (const f of k.families) jump.append(el("a", { href: "#" + f.id, class: "button", text: f.name }));
      out.append(jump);
    }
    for (const f of k.families) {
      out.append(el("h3", { id: f.id, text: f.name }));
      const list = el("div", { class: "distros" });
      for (const s of f.servers) {
        const card = el("section", { class: "distro", "aria-label": s.name }, el("h4", { text: s.name }),
          ...sessions(s.sessions), copyable(s.command));
        for (const m of s.more) card.append(el("p", { class: "hint", text: t("srv.more", (m.what || "Also") + ":", { what: m.what || t("srv.also", "Also") }) }), copyable(m.command));
        list.append(card);
      }
      out.append(list);
    }
    if (k.start) out.append(el("h2", { text: t("srv.start", "Start it") }), copyable(k.start));
    out.append(all(k));
    into.replaceChildren(out);
  }

  // Get a client: the native clients, freerdp-tk with its uvx line, and its videos
  function renderClients(k, into, videos = []) {
    const out = document.createDocumentFragment();
    out.append(from(k));
    const table = el("table", { id: "clients" }, el("tr", {}, el("th", { text: t("srv.platform", "Platform") }), el("th", { text: t("srv.file", "File") })));
    for (const c of k.clients) table.append(el("tr", {}, el("td", { text: c.platform }), el("td", {}, link(c.url, c.file))));
    out.append(table);
    out.append(el("h3", { id: "freerdp-tk", text: t("srv.tk", "freerdp-tk, the connection window") }),
      el("p", { text: t("srv.tkWhy", "Each client comes with freerdp-tk, a window that keeps your connections, their passwords in the system's own keyring, and starts the client. Unpack the file and start freerdp-tk (Windows: freerdp-tk.cmd; macOS: freerdp-tk.command, in Finder).") }),
      el("p", { text: t("srv.tkUvx", "With uv, the window alone, for a FreeRDP 3 client you already have:") }),
      copyable("uvx freerdp-tk"));
    // the videos' titles and captions are the kit's, as written
    const shelf = el("div", { class: "clips" });
    for (const v of videos) {
      const video = el("video", { controls: "", preload: "none", playsinline: "", src: v.src });
      if (v.poster) video.setAttribute("poster", v.poster);
      shelf.append(el("figure", { class: "clip" }, video, el("figcaption", {}, el("b", { text: v.title }), v.caption ? " " + v.caption : "")));
    }
    if (videos.length) out.append(shelf);
    out.append(all(k));
    into.replaceChildren(out);
  }

  const api = { parse, clips, LATEST };
  root.FreeRDPServer = api;
  if (typeof module !== "undefined" && module.exports) { module.exports = api; return; }
  // any failure (no file, not JSON, nothing usable, a bug) keeps the fallback line
  const server = document.getElementById("kit"), native = document.getElementById("native");
  const into = server || native;
  // the videos are extra, on Get a client only: without demo.json the rest still shows
  const demo = () => (native ? fetch("demo/demo.json").then((r) => (r.ok ? r.json() : null)).catch(() => null) : null);
  if (into) Promise.all([fetch("install.json", { cache: "no-cache" }), demo()])
    .then(([r, d]) => { if (!r.ok) throw new Error("install.json: HTTP " + r.status); return r.json().then((data) => [data, d]); })
    .then(([data, d]) => {
      const k = parse(data); if (!k) throw new Error("install.json: no distribution in it");
      if (native && !k.clients.length) throw new Error("install.json: no client in it");
      const videos = clips(d);
      const show = () => (server ? renderServer(k, into) : renderClients(k, into, videos));
      show();
      root.FreeRDPi18n?.onChange(show);   // a new language: the page's part again
    })
    .catch((e) => console.log("[page] " + (e?.message || e) + "; the page links to the kit's latest release"));
})(globalThis);
