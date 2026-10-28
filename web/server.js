// The "Get a server" page (server.html): the release kit's xrdp packages and native clients, from
// install.json, which the kit writes next to the page when it publishes the site:
//   { release, url, server: [{ name, sessions, command, more: [{ what, command }] }], start,
//     clients: [{ platform, file, url }] }
// One entry of "server" per distribution release ("Debian 13", "Ubuntu 26.04", "Fedora 45"…);
// the page groups them by the name's first word. Without the file, or with one it cannot read
// (a local build), the page keeps its one line that links to the kit's latest release.
// Everything is built with textContent, never as HTML: the installed app requires Trusted Types.
(function (root) {
  "use strict";
  const LATEST = "https://github.com/congzhangzh/rdp-release-kit/releases/latest";
  const text = (v) => (typeof v === "string" ? v.trim() : "");
  // links only to https: addresses (never javascript: or the like)
  const https = (v) => { try { const u = new URL(text(v)); return u.protocol === "https:" ? u.href : ""; } catch (e) { return ""; } };
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "other";

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
    el("pre", { class: "wrap", text: command }), el("button", { class: "small", type: "button", "data-copy": "", text: "Copy" }));

  // "Wayland: GNOME, KDE Plasma, sway; Xorg: the default session": a line per kind, its label in
  // bold; an older install.json's one line ("GNOME, KDE, sway; Xorg with xorgxrdp") stays one
  const sessions = (v) => {
    if (!v) return [];
    const parts = v.split(/;\s*/).filter(Boolean);
    if (!parts.every((p) => /^[A-Z][\w ]*: /.test(p))) return [el("p", { class: "hint", text: "Sessions: " + v })];
    return parts.map((p) => {
      const i = p.indexOf(": ");
      return el("p", { class: "hint" }, el("b", { text: p.slice(0, i + 1) }), p.slice(i + 1));
    });
  };

  function render(k, into) {
    const out = document.createDocumentFragment();
    out.append(el("p", { class: "muted" }, "From the release kit's release ",
      link(k.url, k.release || "on GitHub"), ", the one this site was published from."));
    out.append(el("h2", { text: "Install xrdp" }));
    if (k.families.length > 1) {
      const jump = el("p", { class: "row families", "aria-label": "Distributions" });
      for (const f of k.families) jump.append(el("a", { href: "#" + f.id, class: "button", text: f.name }));
      out.append(jump);
    }
    for (const f of k.families) {
      out.append(el("h3", { id: f.id, text: f.name }));
      const list = el("div", { class: "distros" });
      for (const s of f.servers) {
        const card = el("section", { class: "distro", "aria-label": s.name }, el("h4", { text: s.name }),
          ...sessions(s.sessions), copyable(s.command));
        for (const m of s.more) card.append(el("p", { class: "hint", text: (m.what || "Also") + ":" }), copyable(m.command));
        list.append(card);
      }
      out.append(list);
    }
    if (k.start) out.append(el("h2", { text: "Start it" }), copyable(k.start));
    if (k.clients.length) {
      out.append(el("h2", { text: "Native clients" }),
        el("p", { text: "FreeRDP's own client for your computer, built by the release kit." }));
      const table = el("table", { id: "clients" }, el("tr", {}, el("th", { text: "Platform" }), el("th", { text: "File" })));
      for (const c of k.clients) table.append(el("tr", {}, el("td", { text: c.platform }), el("td", {}, link(c.url, c.file))));
      out.append(table);
    }
    out.append(el("p", {}, "All files and checksums: ", link(k.url, k.url)));
    into.replaceChildren(out);
  }

  const api = { parse, LATEST };
  root.FreeRDPServer = api;
  if (typeof module !== "undefined" && module.exports) { module.exports = api; return; }
  // any failure (no file, not JSON, nothing usable, a bug) keeps the fallback line
  const into = document.getElementById("kit");
  if (into) fetch("install.json", { cache: "no-cache" })
    .then((r) => { if (!r.ok) throw new Error("install.json: HTTP " + r.status); return r.json(); })
    .then((data) => { const k = parse(data); if (!k) throw new Error("install.json: no distribution in it"); render(k, into); })
    .catch((e) => console.log("[page] " + (e?.message || e) + "; the page links to the kit's latest release"));
})(globalThis);
