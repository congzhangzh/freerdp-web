// Live checks and copy buttons for install.html (kept out of the HTML: IWAs forbid inline scripts).
"use strict";

const isIwa = location.protocol === "isolated-app:";
const brands = navigator.userAgentData?.brands?.map((b) => b.brand) ?? [];
const chromium = brands.some((b) => /Chromium|Google Chrome|Microsoft Edge/.test(b));
const version = (navigator.userAgent.match(/Chrome\/(\d+)/) || [])[1];

// the words in the visitor's language (i18n.js): the English given here, or its Chinese
const t = (key, text, vars) => globalThis.FreeRDPi18n?.t(key, text, vars) ?? text;
const table = document.getElementById("checks");
let origin = "";
function showChecks() {
  const checks = [
    [t("inst.browser", "Browser"), chromium ? t("inst.chromium", `Chromium-based (version ${version ?? "?"})`, { version: version ?? "?" })
      : t("inst.notChromium", "Not Chromium: the app cannot be installed here, use the web version"), chromium ? "ok" : "bad"],
    [t("inst.runningAs", "Running as"), isIwa ? t("inst.installed", "Installed app (Isolated Web App)") : t("inst.webPage", "Normal web page"), isIwa ? "ok" : ""],
    [t("inst.directTcp", "Direct TCP"), typeof TCPSocket === "function" ? t("inst.available", "Available")
      : (isIwa ? t("inst.noPermission", "Not available: check the app's permissions") : t("inst.onlyApp", "Only inside the installed app")),
      typeof TCPSocket === "function" ? "ok" : ""],
    [t("inst.threads", "Threads"), crossOriginIsolated ? t("inst.isolated", "Available (cross-origin isolated)")
      : t("inst.notIsolated", "Unavailable: the server must send COOP/COEP headers"), crossOriginIsolated ? "ok" : "bad"],
  ];
  table.textContent = "";
  for (const [name, text, cls] of checks) {
    const tr = table.insertRow();
    tr.insertCell().textContent = name; tr.cells[0].style.fontWeight = "600";
    tr.insertCell().textContent = text; if (cls) tr.cells[1].className = cls;
  }

  // The dev-mode proxy needs the plain http(s) origin this page was served from.
  origin = isIwa ? t("inst.inside", "(already installed: you are inside the app)") : location.origin;
  document.getElementById("origin").textContent = origin;
}
showChecks();
globalThis.FreeRDPi18n?.onChange(showChecks);

async function copy(text, button) {
  try { await navigator.clipboard.writeText(text); button.textContent = t("copied", "Copied"); }
  catch { button.textContent = t("copySelect", "Select and copy"); }
  setTimeout(() => { button.textContent = t("copy", "Copy"); }, 1500);
}
document.querySelectorAll("button[data-copy]").forEach((b) => b.addEventListener("click", () => copy(b.dataset.copy, b)));
document.getElementById("copyOrigin").addEventListener("click", (e) => copy(origin, e.currentTarget));
