// Trusted Types for Isolated Web Apps.
//
// IWAs enforce `require-trusted-types-for 'script'`, so string URLs passed to
// dangerous sinks are rejected unless a policy approves them. Emscripten starts
// its pthread workers with `new Worker("sdl-freerdp.js")`, which is such a sink,
// so without this the runtime never initialises ("Loading..." forever).
// The browser calls the policy named "default" for every plain string; this one
// only approves our own same-origin worker script and rejects everything else.
"use strict";
if (window.trustedTypes && !trustedTypes.defaultPolicy) {
  trustedTypes.createPolicy("default", {
    createScriptURL(url) {
      const u = new URL(url, location.href);
      if (u.origin === location.origin && u.pathname.endsWith("/sdl-freerdp.js")) return u.href;
      throw new TypeError("Trusted Types: blocked script URL " + url);
    },
  });
}

// The page's start, watched from its first script: an error before the page is ready (app.js sets
// window.freerdpPageReady once the client is) goes on the Connect button and the status line, so a
// browser that cannot run the page says why instead of "Loading…" for good (#368: iPhone's Safari,
// which lacks an API app.js used while it loaded). Once the page is ready its own code shows what
// happens; a passing error before that is overwritten when it gets ready.
(() => {
  const t = (key, text, vars) => globalThis.FreeRDPi18n?.t(key, text, vars) ?? text;
  // The client's threads share memory (a SharedArrayBuffer), which a browser gives only to a page that
  // is cross-origin isolated; without it the start fails with a line that says nothing of the cause
  // (WebKit: "The object can not be cloned", Firefox: "The WebAssembly.Memory object cannot be
  // serialized"). 聪哥's iPhone, 2026-11-15: an app's built-in browser runs no service worker (the
  // page's coi-serviceworker), so a gateway without COOP/COEP headers failed. Null when isolated, or
  // in a browser without the property. app.js says the same when the client aborts.
  window.freerdpNotIsolated = () => (globalThis.crossOriginIsolated === false
    ? t("status.notIsolated", "The client did not start: this page is not cross-origin isolated, which the client's threads need. Open it over https or at http://localhost, from a server that sends the COOP and COEP headers (an app's built-in browser may not run the page's service worker, which adds them).")
    : null);
  const show = (what) => {
    if (window.freerdpPageReady) return;
    const go = document.getElementById("go"), status = document.getElementById("status");
    if (go) { go.disabled = true; go.textContent = t("form.failed", "Could not start"); }
    if (status) status.textContent = window.freerdpNotIsolated() ?? t("status.noStart", `the client did not start: ${what}`, { what });
  };
  window.addEventListener("error", (e) => { if (e.message) show(e.message); });
  window.addEventListener("unhandledrejection", (e) => show(e.reason?.message || String(e.reason)));
})();
