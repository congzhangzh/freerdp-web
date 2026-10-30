// "About": what this client was built with, the same before, during and after a session (the
// toolbar's Info shows the live session instead, app.js). The facts come from three files the
// site has: the IWA manifest (this page's version), MANIFEST (the release kit writes it next to
// the client: FreeRDP, SDL and the libraries, from its sources.lock; the page's commit; the
// compiler) and RELEASE (the kit's release the site was published from; site.sh writes it). A
// file that is missing leaves its rows out: a local build may have none of the last two.
(function (root) {
  "use strict";
  // MANIFEST, as the kit's build-wasm-client.sh writes it:
  //   FreeRDP web client (preview), built 2026-10-27 with emcc (…) 6.0.12 (<sha>)
  //   page: freerdp-web <commit>
  //   OVERRIDE <name>: local directory <dir> (not from sources.lock)     (only for a local build)
  //   sources (sources.lock):
  //     freerdp          20261026.4 <git commit, 40 hex>
  //     dav1d            1.5.4     <tarball SHA-256, 64 hex>
  // and, from this repository's site.sh, "page from site.sh: this checkout, <commit>".
  function parseManifest(text) {
    const m = { sources: {}, overrides: [] };
    for (const line of String(text || "").split("\n")) {
      let r;
      if ((r = /\bbuilt (\d{4}-\d\d-\d\d) with emcc\b.*?(\d+\.\d+\.\d+)/.exec(line))) { m.built = r[1]; m.emscripten = r[2]; }
      else if ((r = /^page: freerdp-web ([0-9a-f]{7,40})/.exec(line))) m.page = r[1];
      else if ((r = /^page from site\.sh: this checkout, (.+)$/.exec(line))) m.localPage = r[1].trim();
      else if ((r = /^OVERRIDE ([\w.-]+):/.exec(line))) m.overrides.push(r[1]);
      else if ((r = /^\s+([\w.-]+)\s+(\S+)\s+([0-9a-f]{40}|[0-9a-f]{64})\s*$/.exec(line)))
        m.sources[r[1]] = { version: r[2], commit: r[3].length === 40 ? r[3] : "" };
    }
    return m;
  }
  // the labels in the visitor's language (i18n.js); English without it (node's tests)
  const t = (key, text, vars) => root.FreeRDPi18n?.t(key, text, vars) ?? text;
  const short = (sha) => sha.slice(0, 10);
  const src = (s) => s ? s.version + (s.commit ? ` (commit ${short(s.commit)})` : "") : "";

  // the rows of the card: [label, value], those without a value left out
  function rows({ version, engine, manifest, release } = {}) {
    const m = manifest || { sources: {}, overrides: [] }, s = m.sources;
    const named = new Set(["freerdp", "sdl3_wasm", "dav1d", "avm", "opus"]);
    const others = Object.entries(s).filter(([n]) => !named.has(n)).map(([n, v]) => `${n} ${v.version}`);
    const page = m.localPage ? t("about.checkout", `this checkout, ${m.localPage}`, { page: m.localPage }) : m.page ? `freerdp-web ${short(m.page)}` : "";
    const dav1d = "dav1d" + (s.dav1d ? " " + s.dav1d.version : "");
    return [
      [t("about.version", "Version"), version ? `FreeRDP Web ${version}` : "–"],
      [t("about.engine", "Engine"), engine || "–"],
      ["FreeRDP", src(s.freerdp)],
      ["SDL", src(s.sdl3_wasm)],
      // what decodes is fixed by the build, a row per codec: the first choice, then its fallback;
      // whether the browser does it in hardware is the session's (Info)
      [t("about.av1.label", "AV1 decoder"), t("about.av1", `WebCodecs (browser); fallback: ${dav1d} (in this page)`, { dav1d })],
      // AV2 (FreeRDP#13925): no browser decodes it, libavm does, in the page; only in builds
      // that have it (the MANIFEST names avm)
      [t("about.av2.label", "AV2 decoder"), s.avm ? t("about.av2", `libavm ${s.avm.version} (in this page)`, { avm: s.avm.version }) : ""],
      [t("about.h264.label", "H.264 decoder"), t("about.h264", "WebCodecs (browser)")],
      [t("about.audio.label", "Audio decoder"), s.opus ? `Opus ${s.opus.version}` : ""],
      [t("about.libraries", "Libraries"), others.join(", ")],
      [t("about.built", "Built"), m.built ? `${m.built}, Emscripten ${m.emscripten}` : ""],
      [t("about.page", "Page"), page],
      [t("about.overrides", "Overrides"), m.overrides.length ? t("about.local", m.overrides.join(", ") + " from a local directory", { names: m.overrides.join(", ") }) : ""],
      [t("about.kit", "Release kit"), release || ""],
    ].filter(([, v]) => v);
  }

  const api = { parseManifest, rows };
  root.FreeRDPAbout = api;
  if (typeof module !== "undefined" && module.exports) { module.exports = api; return; }

  // ---- the page: #aboutTable in #aboutPanel (index.html) ----
  const facts = {};
  const get = (url, as) => fetch(url, { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(r.status); return r[as](); });
  function render() {
    const tbl = document.getElementById("aboutTable");
    if (!tbl) return;
    tbl.textContent = "";
    for (const [k, v] of rows({ ...facts, engine: root.freerdpEngine })) {
      const tr = tbl.insertRow(); tr.insertCell().textContent = k; tr.insertCell().textContent = v;
    }
  }
  api.render = render;
  Promise.allSettled([
    get(".well-known/manifest.webmanifest", "json").then((j) => { facts.version = j.version; }),
    get("MANIFEST", "text").then((t) => { facts.manifest = parseManifest(t); }),
    get("RELEASE", "text").then((t) => { facts.release = t.trim().split("\n")[0].slice(0, 40); }),
  ]).then(render);
  document.addEventListener("DOMContentLoaded", () => {
    render();
    // the engine can change once its client loads (no JSPI build here): read it when shown
    document.getElementById("aboutPanel")?.addEventListener("toggle", render);
  });
  root.FreeRDPi18n?.onChange(render);
})(globalThis);
