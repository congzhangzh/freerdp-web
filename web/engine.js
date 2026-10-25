// Which build of the client this browser runs. The release kit links it twice from the same
// code: with JSPI (WebAssembly's JavaScript Promise Integration, in jspi/), smaller and faster
// because the code is not rewritten to suspend itself, where the browser has it (Chrome 137+);
// with Asyncify, which every browser with WebAssembly runs, everywhere else. ?engine=jspi or
// ?engine=asyncify picks one (tests). A site without jspi/ (a local build) falls back.
//
// The client is loaded from here, after the page's own scripts: window.freerdpClient settles
// when it has run, and app.js starts the first client then (a script added by a script does
// not hold DOMContentLoaded back, as the <script> tag it replaces did).
"use strict";
(() => {
  const want = new URLSearchParams(location.search).get("engine");
  const jspi = want ? want === "jspi" : typeof WebAssembly === "object" && "Suspending" in WebAssembly;
  // deploy-web.sh loads this file as engine.js?v=<version>: the client gets the same
  // query (its workers inherit the URL), so a new version is never served from the cache
  const query = new URL(document.currentScript.src).search;
  const load = (dir) => new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = dir + "sdl-freerdp.js" + query;
    s.async = false;
    s.onload = resolve;
    s.onerror = () => { s.remove(); reject(new Error("could not load " + s.src)); };
    document.body.appendChild(s);
  });
  window.freerdpEngine = jspi ? "JSPI" : "Asyncify";
  window.freerdpClient = !jspi ? load("") : load("jspi/").catch((e) => {
    if (want) throw e;
    console.warn(e.message + ": the Asyncify build instead");
    window.freerdpEngine = "Asyncify (no JSPI build here)";
    return load("");
  });
})();
