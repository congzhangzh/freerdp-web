// Copy buttons of the help pages (kept out of the HTML: IWAs forbid inline scripts).
// <button data-copy="text"> copies its text; an empty data-copy copies the <pre> before it.
"use strict";
document.querySelectorAll("button[data-copy]").forEach((b) => b.addEventListener("click", async () => {
  const text = b.dataset.copy || b.previousElementSibling?.textContent || "";
  try { await navigator.clipboard.writeText(text); b.textContent = "Copied"; }
  catch (e) { b.textContent = "Select and copy"; }
  setTimeout(() => { b.textContent = "Copy"; }, 1500);
}));
