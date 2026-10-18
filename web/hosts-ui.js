// The host bar under the safety notice (hosts.js), each host's passkey vault option, and the
// export and import of the hosts. The page (app.js) shows the selected host in the form and
// sends the form's edits back with update().
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const H = FreeRDPHosts;
  let state = H.load(localStorage);
  let vault = null, available = false, exists = false, busy = false, selectListener = () => {}, pendingText = "";
  const current = () => state.hosts.find((h) => h.id === state.selected);
  const target = (h) => (h.direct ? h.directHost : h.host);
  const store = () => H.save(localStorage, state);
  const say = (text) => { $("hostStatus").textContent = text; };

  // ---- the host bar
  function render() {
    const list = $("hostList");
    list.replaceChildren();
    for (const h of state.hosts) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "host"; b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(h.id === state.selected));
      const name = document.createElement("b"), where = document.createElement("span");
      name.textContent = h.name;
      where.textContent = [h.user, target(h)].filter(Boolean).join(" @ ") || "not set up yet";
      b.append(name, where);
      b.onclick = () => select(h.id);
      list.append(b);
    }
    $("hostDelete").disabled = state.hosts.length < 2;
    renderVault();
  }
  function select(id) {
    if (busy || id === state.selected) return;
    lock();
    state.selected = id; store(); render();
    selectListener(current());
  }
  function addHost(base) {
    const h = base ? { ...H.clean(base), id: crypto.randomUUID(), vaultSaved: false } : H.blank();
    h.name = H.uniqueName(state, base ? base.name + " copy" : "New host");
    if (!base && window.directSocketsAvailable) h.direct = true;   // the installed app: Direct TCP
    state.hosts.push(h);
    select(h.id);
    $("hostName").focus(); $("hostName").select();
    say(base ? `“${h.name}”: a copy, without the saved password.` : `“${h.name}”: set it up below; it is saved as you type.`);
  }
  $("hostNew").onclick = () => addHost(null);
  $("hostDuplicate").onclick = () => addHost(current());
  // delete asks twice (no blocking dialog); a password in the vault goes with the host
  let deleteArmed = 0;
  $("hostDelete").onclick = () => run(async () => {
    const h = current();
    if (state.hosts.length < 2) return;
    if (Date.now() - deleteArmed > 4000) {
      deleteArmed = Date.now(); $("hostDelete").textContent = "Delete: click again";
      setTimeout(() => { $("hostDelete").textContent = "Delete"; }, 4000);
      return;
    }
    deleteArmed = 0; $("hostDelete").textContent = "Delete";
    if (h.vaultSaved && vault) {
      if (!vault.unlocked) await unlockAndAdopt();
      await vault.remove(h.id);
    }
    state.hosts = state.hosts.filter((x) => x.id !== h.id);
    state.selected = state.hosts[0].id; store(); render();
    selectListener(current());
    say(`“${h.name}” deleted${h.vaultSaved ? ", with its saved password" : ""}.`);
  });

  // ---- the passkey vault, per host: the password of a host that asks for it, encrypted
  async function run(action) {
    if (busy) return;
    busy = true; renderVault();
    try { await action(); }
    catch (e) { say(e.name === "AbortError" ? "Vault operation cancelled." : e.message); }
    finally { busy = false; render(); }
  }
  // hosts kept in a vault by an earlier version of the page become hosts of the bar
  function adopt() {
    let added = 0;
    for (const e of vault.list()) {
      if (state.hosts.some((h) => h.id === e.id)) continue;
      state.hosts.push(H.clean({ id: e.id, name: H.uniqueName(state, e.label), host: e.direct ? "" : e.host,
        directHost: e.direct ? e.host : "", direct: e.direct, user: e.username, extra: e.extra, vault: true, vaultSaved: true }));
      added++;
    }
    if (added) { store(); say(`Added ${added} host${added > 1 ? "s" : ""} kept in the passkey vault.`); }
  }
  async function unlockAndAdopt() { await vault.unlock(); adopt(); }
  function renderVault() {
    const h = current(), on = h.vault, unlocked = !!vault?.unlocked;
    $("vaultKeep").checked = on;
    $("vaultPanel").hidden = !on;
    $("pass").placeholder = on && h.vaultSaved ? "Kept in the vault: leave empty" : "";
    let text;
    if (!available) text = "The vault needs HTTPS (or localhost) and a browser with passkeys that support PRF.";
    else if (!exists) text = "There is no vault in this browser yet: create one, with a passkey.";
    else if (!unlocked) text = h.vaultSaved ? "Saved. Connect asks for your passkey." : "Unlock the vault to save this host's password in it.";
    else text = h.vaultSaved ? "Saved in the vault. Type a new password and save it to replace it." : "Type the password above, then save it in the vault.";
    if (busy) text = "Waiting for the passkey…";
    $("vaultStatus").textContent = text;
    const show = (id, visible, enabled = true) => { $(id).hidden = !visible; $(id).disabled = busy || !enabled; };
    show("vaultCreate", available && !exists);
    show("vaultUnlock", available && exists && !unlocked);
    show("vaultSave", unlocked);
    show("vaultForget", unlocked && h.vaultSaved);
    show("vaultLock", unlocked || busy, true);
    $("vaultLock").disabled = false;   // also cancels a pending passkey prompt
  }
  function lock() { vault?.lock(); $("pass").value = ""; renderVault(); }
  $("vaultKeep").onchange = () => {
    current().vault = $("vaultKeep").checked; store(); render();
    selectListener(current(), true);
  };
  $("vaultCreate").onclick = () => run(async () => { await vault.create(); exists = true; say("Vault created. Save this host's password in it."); });
  $("vaultUnlock").onclick = () => run(unlockAndAdopt);
  $("vaultLock").onclick = () => { lock(); say("Vault locked; its passwords are cleared from the page."); };
  $("vaultSave").onclick = () => run(async () => {
    const h = current(), password = $("pass").value;
    if (!password) throw new Error("Type the password first.");
    try {
      await vault.save({ id: h.id, label: h.name, host: target(h) || "unset", username: h.user, password, extra: h.extra, direct: h.direct });
    } finally { $("pass").value = ""; }
    h.vaultSaved = true; store();
    say(`“${h.name}”: password saved in the vault.`);
  });
  $("vaultForget").onclick = () => run(async () => {
    const h = current();
    await vault.remove(h.id); h.vaultSaved = false; store();
    say(`“${h.name}”: the saved password is gone from the vault.`);
  });
  window.addEventListener("pagehide", lock);

  // ---- export and import
  function download(text, name) {
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([text], { type: "application/json" })), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function syncExport() {
    const canPw = available && state.hosts.some((h) => h.vaultSaved);
    $("exportPasswords").disabled = !canPw;
    if (!canPw) $("exportPasswords").checked = false;
    $("exportPassphrase").hidden = !$("exportEncrypt").checked;
    $("exportWarn").hidden = !($("exportPasswords").checked && !$("exportEncrypt").checked);
  }
  $("exportPasswords").onchange = syncExport;
  $("exportEncrypt").onchange = () => { syncExport(); if ($("exportEncrypt").checked) $("exportPassphrase").focus(); };
  $("hostExport").onclick = () => {
    $("exportPasswords").checked = false; $("exportEncrypt").checked = false; $("exportPassphrase").value = "";
    syncExport(); $("exportDialog").showModal();
  };
  $("exportDialog").addEventListener("close", () => {
    const passphrase = $("exportPassphrase").value, encrypt = $("exportEncrypt").checked, withPw = $("exportPasswords").checked;
    $("exportPassphrase").value = "";
    if ($("exportDialog").returnValue !== "ok") return;
    run(async () => {
      if (encrypt && passphrase.length < 8) throw new Error("Not exported: use a passphrase of at least 8 characters.");
      let passwords = null;
      try {
        if (withPw) {
          if (!vault.unlocked) await unlockAndAdopt();
          passwords = new Map();
          for (const h of state.hosts) if (h.vaultSaved) vault.use(h.id, (e) => { passwords.set(h.id, e.password); });
        }
        download(await H.exportText(state, { passwords, passphrase: encrypt ? passphrase : "" }),
          encrypt ? "freerdp-web-hosts.encrypted.json" : "freerdp-web-hosts.json");
      } finally { passwords?.clear(); }
      say(`Exported ${state.hosts.length} host${state.hosts.length > 1 ? "s" : ""}` +
        (withPw ? ", with the passwords kept in the vault" : ", without passwords") + (encrypt ? ", encrypted." : "."));
    });
  });
  $("hostImport").onclick = () => $("hostImportFile").click();
  $("hostImportFile").onchange = async () => {
    const file = $("hostImportFile").files[0];
    $("hostImportFile").value = "";
    if (!file) return;
    pendingText = await file.text();
    tryImport("");
  };
  $("importDialog").addEventListener("close", () => {
    const passphrase = $("importPassphrase").value;
    $("importPassphrase").value = "";
    if ($("importDialog").returnValue === "ok") tryImport(passphrase); else pendingText = "";
  });
  function tryImport(passphrase) {
    run(async () => {
      let items;
      try { items = await H.importText(pendingText, passphrase); }
      catch (e) {
        if (!(e instanceof H.NeedPassphrase)) { pendingText = ""; throw e; }
        $("importInfo").textContent = e.message; $("importDialog").showModal(); return;
      }
      pendingText = "";
      const withPw = items.filter((i) => i.password).length;
      let kept = 0;
      try {
        if (withPw && available && exists && !vault.unlocked) await unlockAndAdopt();
        for (const item of items) {
          const h = item.host;
          h.name = H.uniqueName(state, h.name);
          state.hosts.push(h);
          if (item.password && vault?.unlocked) {
            await vault.save({ id: h.id, label: h.name, host: target(h) || "unset", username: h.user, password: item.password, extra: h.extra, direct: h.direct });
            h.vault = true; h.vaultSaved = true; kept++;
          }
        }
      } finally { for (const item of items) item.password = ""; store(); }
      say(`Imported ${items.length} host${items.length > 1 ? "s" : ""}` + (!withPw ? "." : kept === withPw
        ? `, and ${kept} password${kept > 1 ? "s" : ""} into the passkey vault.`
        : `; ${withPw - kept} password${withPw - kept > 1 ? "s were" : " was"} not kept: create or unlock the passkey vault, then import again.`));
    });
  }

  // ---- for the page
  window.FreeRDPHostsUI = {
    current,
    get selected() { return state.selected; },
    onSelect(fn) { selectListener = fn; },
    // the form's edits; false (and nothing stored) when they are not allowed, e.g. /p: in Extra options
    update(patch) {
      const h = current();
      try { H.clean({ ...h, ...patch }); } catch (e) { say(e.message); return false; }
      Object.assign(h, patch); store(); render();
      return true;
    },
    check() {
      if (busy) throw new Error("Wait for the vault operation to finish.");
      FreeRDPVault.validateOptions($("extra").value);
    },
    needsVault() { const h = current(); return h.vault && h.vaultSaved && !$("pass").value; },
    // before Connect waits for anything: the passkey prompt, while the click still counts
    async prepare() {
      if (!this.needsVault() || vault?.unlocked) return;
      if (!available) throw new Error("This host's password is in the passkey vault, which this browser cannot open here.");
      busy = true; renderVault();
      try { await unlockAndAdopt(); } finally { busy = false; render(); }
    },
    // the connection's host and password, handed synchronously to consume and dropped after
    use(consume) {
      const h = current(), t = target(h);
      if (!t) throw new Error(h.direct ? "Enter the RDP server first." : "Enter the gateway first.");
      const base = { host: t, username: h.user, extra: h.extra, direct: h.direct };
      if (this.needsVault()) return vault.use(h.id, (e) => consume({ ...base, password: e.password }));
      const host = { ...base, password: $("pass").value };
      try { return consume(host); } finally { host.password = ""; $("pass").value = ""; }
    },
    lock,
  };
  render();
  (async () => {
    try {
      if (!window.isSecureContext || !window.PublicKeyCredential || !navigator.credentials || !window.crypto?.subtle) return;
      vault = new FreeRDPVault.Vault(); exists = await vault.exists(); available = true;
    } catch (e) { /* no vault here: renderVault says why */ }
    finally { renderVault(); }
  })();
})();
