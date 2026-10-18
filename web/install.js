// Live checks and copy buttons for install.html (kept out of the HTML: IWAs forbid inline scripts).
"use strict";

const isIwa = location.protocol === "isolated-app:";
const brands = navigator.userAgentData?.brands?.map((b) => b.brand) ?? [];
const chromium = brands.some((b) => /Chromium|Google Chrome|Microsoft Edge/.test(b));
const version = (navigator.userAgent.match(/Chrome\/(\d+)/) || [])[1];

const checks = [
  ["Browser", chromium ? `Chromium-based (version ${version ?? "?"})` : "Not Chromium: the app cannot be installed here, use the web version",
    chromium ? "ok" : "warn"],
  ["Running as", isIwa ? "Installed app (Isolated Web App)" : "Normal web page", isIwa ? "ok" : ""],
  ["Direct TCP", typeof TCPSocket === "function" ? "Available" : (isIwa ? "Not available: check the app's permissions" : "Only inside the installed app"),
    typeof TCPSocket === "function" ? "ok" : ""],
  ["Threads", crossOriginIsolated ? "Available (cross-origin isolated)" : "Unavailable: the server must send COOP/COEP headers",
    crossOriginIsolated ? "ok" : "warn"],
];
const table = document.getElementById("checks");
for (const [name, text, cls] of checks) {
  const tr = table.insertRow();
  tr.insertCell().textContent = name; tr.cells[0].className = "s";
  tr.insertCell().textContent = text; if (cls) tr.cells[1].className = cls;
}

// The dev-mode proxy needs the plain http(s) origin this page was served from.
const origin = isIwa ? "(already installed: you are inside the app)" : location.origin;
document.getElementById("origin").textContent = origin;

async function copy(text, button) {
  try { await navigator.clipboard.writeText(text); button.textContent = "Copied"; }
  catch { button.textContent = "Select and copy manually"; }
  setTimeout(() => { button.textContent = "Copy"; }, 1500);
}
document.querySelectorAll("button[data-copy]").forEach((b) => b.addEventListener("click", () => copy(b.dataset.copy, b)));
document.getElementById("copyOrigin").addEventListener("click", (e) => copy(origin, e.currentTarget));
