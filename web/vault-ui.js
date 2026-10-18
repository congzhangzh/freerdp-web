// Only encrypted vault snapshots reach IndexedDB. Host names are visible after unlock.
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const fields = ["host", "user", "pass", "extra", "direct", "vaultName"];
  let vault, exists = false, busy = true, dirty = false, available = false;
  const message = text => { $("vaultStatus").textContent = text; };
  function refresh(selected = $("vaultHosts").value) {
    const unlocked = !!vault?.unlocked;
    $("vaultHosts").replaceChildren(new Option("Manual connection", ""));
    if (unlocked) for (const h of vault.list()) $("vaultHosts").add(new Option(h.label, h.id));
    $("vaultHosts").value = selected;
    $("vaultHosts").disabled = busy || !unlocked;
    $("vaultCreate").hidden = exists;
    $("vaultUnlock").hidden = !exists || unlocked;
    $("vaultCreate").disabled = busy || !available || exists;
    $("vaultUnlock").disabled = busy || !available || !exists;
    for (const id of ["vaultLock", "vaultNew", "vaultSave", "vaultName"])
      $(id).disabled = busy || !unlocked;
    // Lock stays available during a pending prompt/encryption to cancel and clear memory.
    $("vaultLock").disabled = !available || (!busy && !unlocked);
    $("vaultDelete").disabled = busy || !unlocked || !$("vaultHosts").value;
  }
  function clear() {
    for (const id of ["host", "user", "pass", "vaultName"]) $(id).value = "";
    $("extra").value = "/gfx:AV1:i444";
    $("direct").checked = !!window.directSocketsAvailable;
    $("pass").placeholder = ""; dirty = false;
    refresh("");
  }
  function lock() {
    vault?.lock(); clear(); message("Vault locked. Passwords cleared from the page.");
  }
  async function run(action, success) {
    if (busy) return;
    busy = true; refresh();
    try { await action(); exists = await vault.exists(); if (vault.unlocked) message(success); }
    catch (e) { message(e.name === "AbortError" ? "Vault operation cancelled." : e.message); }
    finally { busy = false; refresh(); }
  }
  $("vaultCreate").onclick = () => run(() => vault.create(), "Vault created. Save a host below.");
  $("vaultUnlock").onclick = () => run(() => vault.unlock(), "Vault unlocked. Select a saved host.");
  $("vaultLock").onclick = lock;
  $("vaultNew").onclick = () => { clear(); message("Enter the new host and password, then Save host."); };
  $("vaultHosts").onchange = () => {
    const id = $("vaultHosts").value;
    if (!id) { clear(); message("Manual connection. Password is not saved."); return; }
    const h = vault.list().find(h => h.id === id);
    $("host").value = h.host; $("user").value = h.username; $("extra").value = h.extra;
    $("direct").checked = h.direct; $("vaultName").value = h.label;
    $("pass").value = ""; $("pass").placeholder = "Saved; leave blank to keep";
    dirty = false; refresh(id); message("Saved password will be used when connecting.");
  };
  for (const id of fields) $(id).addEventListener("input", () => {
    if ($("vaultHosts").value) { dirty = true; message("Save your edits before connecting, or select the host again to discard them."); }
  });
  $("vaultSave").onclick = () => run(async () => {
    const id = $("vaultHosts").value;
    const value = {id, label:$("vaultName").value, host:$("host").value, username:$("user").value,
      password:$("pass").value, extra:$("extra").value, direct:$("direct").checked};
    try {
      const selected = await vault.save(value, !!id && !value.password);
      $("pass").placeholder = "Saved; leave blank to keep";
      dirty = false; refresh(selected);
    } finally { value.password = ""; $("pass").value = ""; }
  }, "Host saved encrypted in this browser.");
  $("vaultDelete").onclick = () => run(async () => {
    await vault.remove($("vaultHosts").value); clear();
  }, "Host deleted from the encrypted vault.");
  window.FreeRDPVaultUI = {
    get selected() { return $("vaultHosts").value; },
    check() {
      if (busy && this.selected) throw new Error("Wait for the vault operation to finish.");
      if (this.selected && dirty) throw new Error("Save host edits before connecting.");
      FreeRDPVault.validateOptions($("extra").value);
    },
    use(consume) {
      this.check();
      if (this.selected) return vault.use(this.selected, consume);
      const host = {host:$("host").value, username:$("user").value, password:$("pass").value,
        extra:$("extra").value, direct:$("direct").checked};
      try { return consume(host); } finally { host.password = ""; $("pass").value = ""; }
    },
    lock,
  };
  window.addEventListener("pagehide", lock);
  (async () => {
    try {
      if (!window.isSecureContext || !window.PublicKeyCredential || !navigator.credentials || !window.crypto?.subtle)
        throw new Error("Passkey vault needs HTTPS or localhost and a browser with WebAuthn PRF support.");
      vault = new FreeRDPVault.Vault(); exists = await vault.exists(); available = true;
      message(exists ? "Vault locked. Unlock to see saved hosts." : "Create a passkey vault to save passwords for several hosts.");
    } catch (e) { message(e.message); }
    finally { busy = false; refresh(); }
  })();
})();
