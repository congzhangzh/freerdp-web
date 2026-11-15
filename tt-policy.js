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
  // On a first visit the page is not isolated yet: coi-serviceworker registers its worker and then
  // reloads the page, which is the one that stays; the client may fail in the meantime (desktop
  // Safari: "The object can not be cloned"). While such a reload can still come (a secure context,
  // service workers, none controlling the page yet), a failure for want of isolation is said only
  // NOT_ISOLATED_WAIT_MS later, if the page is still here: until then the button says "Loading…".
  // (20261115.3 said it at once, and desktop Safari's first visit stopped at "Could not start".)
  // And once coi-serviceworker has asked for its reload (it sets sessionStorage coiReloadedBySelf just
  // before), the reload is underway: desktop Safari holds that navigation until the new worker is
  // ready, longer than NOT_ISOLATED_WAIT_MS on a slow machine (the kit's site gate, 2026-11-15:
  // "Reloading page…", then this page stayed, and 20261115.5 said "Could not start" on it). So
  // while it is underway nothing is said, for up to RELOAD_GIVE_UP_MS: a page still here after
  // that has a reload that will not come, and says why.
  const NOT_ISOLATED_WAIT_MS = 8000, RELOAD_GIVE_UP_MS = 45000;
  const reloadMayCome = () => window.isSecureContext && !!navigator.serviceWorker && !navigator.serviceWorker.controller;
  const reloadAsked = () => { try { return !!sessionStorage.getItem("coiReloadedBySelf"); } catch (e) { return false; } };
  // (Once its worker is active it also takes control of this very page, clients.claim(), so a
  // controller is no sign that the reload has failed while one has been asked for.)
  window.freerdpAfterReloadChance = (fn) => {
    if (globalThis.crossOriginIsolated !== false || !(reloadMayCome() || reloadAsked())) return fn();
    const since = Date.now();
    const later = () => (reloadAsked() && Date.now() - since < RELOAD_GIVE_UP_MS ? setTimeout(later, 1000) : fn());
    setTimeout(later, NOT_ISOLATED_WAIT_MS);
  };
  const show = (what) => {
    if (window.freerdpPageReady) return;
    window.freerdpAfterReloadChance(() => {
      if (window.freerdpPageReady) return;
      const go = document.getElementById("go"), status = document.getElementById("status");
      if (go) { go.disabled = true; go.textContent = t("form.failed", "Could not start"); }
      if (status) status.textContent = window.freerdpNotIsolated() ?? t("status.noStart", `the client did not start: ${what}`, { what });
    });
  };
  window.addEventListener("error", (e) => { if (e.message) show(e.message); });
  window.addEventListener("unhandledrejection", (e) => show(e.reason?.message || String(e.reason)));
})();
