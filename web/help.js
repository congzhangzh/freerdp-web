// Copy buttons of the help pages (kept out of the HTML: IWAs forbid inline scripts).
// <button data-copy="text"> copies its text; an empty data-copy copies the <pre> before it.
// One listener on the document, so buttons a page adds later (server.js) work too.
"use strict";
document.addEventListener("click", async (e) => {
  const b = e.target.closest?.("button[data-copy]");
  if (!b) return;
  const text = b.dataset.copy || b.previousElementSibling?.textContent || "";
  try { await navigator.clipboard.writeText(text); b.textContent = "Copied"; }
  catch (err) { b.textContent = "Select and copy"; }
  setTimeout(() => { b.textContent = "Copy"; }, 1500);
});
