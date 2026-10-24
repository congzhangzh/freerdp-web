// The host bar under the safety notice (hosts.js), each host's passkey vault option, and the
// export and import of the hosts. The page (app.js) shows the selected host in the form and
// sends the form's edits back with update().
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const H = FreeRDPHosts;
  let state = H.load(localStorage);
  let vault = null, available = false, exists = false, busy = false, selectListener = () => {}, pendingText = "";
  let methods = null;   // what opens the vault, readable while locked: { passkeys, code }
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
  // a host's link, index.html?v=<host:port>: the address only (no name, user or settings)
  const linkTo = (address) => location.origin + location.pathname + "?v=" + encodeURIComponent(address).replace(/%3A/gi, ":");
  // following one: the saved host with that address, or a new host for it
  function openLink(address) {
    address = address.trim();
    if (!address || address.length > 255 || /[\s/]/.test(address)) return false;
    const found = state.hosts.find((h) => target(h) === address || h.host === address || h.directHost === address);
    if (found) { select(found.id); say(`“${found.name}”, from the link.`); return true; }
    const h = H.blank(H.uniqueName(state, address));
    if (window.directSocketsAvailable) { h.direct = true; h.directHost = address; } else h.host = address;
    state.hosts.push(h);
    select(h.id);
    say(`“${h.name}”: a new host from the link. Check the address before you connect.`);
    return true;
  }
  $("hostLink").onclick = () => {
    const t = target(current());
    if (!t) { say("Enter the address first; the link carries it."); return; }
    const link = linkTo(t);
    navigator.clipboard.writeText(link).then(() => say("Link copied: " + link), () => say("The link: " + link));
  };
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
  async function refreshMethods() { methods = await vault.methods(); exists = !!methods; }
  function renderVault() {
    const h = current(), on = h.vault, unlocked = !!vault?.unlocked;
    $("vaultKeep").checked = on;
    $("vaultPanel").hidden = !on;
    $("pass").placeholder = on && h.vaultSaved ? "Kept in the vault: leave empty" : "";
    let text;
    if (!available) text = "The vault needs HTTPS (or localhost) and a browser with passkeys that support PRF.";
    else if (!exists) text = "There is no vault in this browser yet: create one, with a passkey.";
    else if (!unlocked) text = (h.vaultSaved ? "Saved. Connect asks for your passkey." : "Unlock the vault to save this host's password in it.") +
      (methods?.passkeys > 1 ? ` Any of its ${methods.passkeys} passkeys opens it.` : "") +
      (methods?.code ? " No passkey at hand? Use the recovery code." : " Its passkey gone, or on another device? Delete the vault and create a new one.");
    else text = h.vaultSaved ? "Saved in the vault. Type a new password and save it to replace it." : "Type the password above, then save it in the vault.";
    if (busy) text = "Waiting for the passkey…";
    $("vaultStatus").textContent = text;
    const show = (id, visible, enabled = true) => { $(id).hidden = !visible; $(id).disabled = busy || !enabled; };
    show("vaultCreate", available && !exists);
    show("vaultUnlock", available && exists && !unlocked);
    show("vaultSave", unlocked);
    show("vaultForget", unlocked && h.vaultSaved);
    show("vaultLock", unlocked || busy, true);
    show("vaultDelete", available && exists);
    $("vaultLock").disabled = false;   // also cancels a pending passkey prompt
    $("vaultRecover").hidden = !(available && exists && !unlocked && methods?.code);
    $("vaultCodeUnlock").disabled = busy;
    $("vaultKeys").hidden = !unlocked;
    if (!unlocked) { $("vaultCodeBox").hidden = true; $("vaultCodeText").textContent = ""; }
    else renderKeys();
  }
  // the vault's keys: passkeys of any provider and the recovery code; removing one asks twice
  let removeArmed = { id: "", at: 0 };
  function renderKeys() {
    const keys = vault.keys(), passkeys = keys.filter((k) => k.kind === "passkey").length;
    $("vaultKeyList").replaceChildren(...keys.map((k) => {
      const li = document.createElement("li");
      const when = k.added ? ", added " + new Date(k.added).toLocaleDateString() : "";
      li.textContent = (k.kind === "code" ? "Recovery code" : "Passkey: " + k.label) + when + (k.current ? " (opened it now)" : "");
      if (k.kind === "code" || passkeys > 1) {
        const b = document.createElement("button");
        b.type = "button"; b.className = "small"; b.disabled = busy;
        b.textContent = removeArmed.id === k.id && Date.now() - removeArmed.at < 4000 ? "Remove: click again" : "Remove";
        b.onclick = () => removeKey(k);
        li.append(b);
      }
      return li;
    }));
    $("vaultAddKey").disabled = $("vaultNewCode").disabled = busy;
    $("vaultNewCode").textContent = keys.some((k) => k.kind === "code") ? "Replace the recovery code" : "Create a recovery code";
  }
  function removeKey(k) {
    if (removeArmed.id !== k.id || Date.now() - removeArmed.at > 4000) {
      removeArmed = { id: k.id, at: Date.now() }; renderKeys();
      setTimeout(renderKeys, 4100);
      say(k.kind === "code" ? "Removing the recovery code: only passkeys will open the vault."
        : `Removing “${k.label}”: it stops opening the vault. A passkey that was lost or stolen? Change the passwords that matter too.`);
      return;
    }
    removeArmed = { id: "", at: 0 };
    run(async () => { await vault.removeKey(k.id); await refreshMethods(); say(k.kind === "code" ? "Recovery code removed." : `“${k.label}” removed from the vault.`); });
  }
  function lock() { vault?.lock(); $("pass").value = ""; renderVault(); }
  $("vaultKeep").onchange = () => {
    current().vault = $("vaultKeep").checked;
    if (current().vault) current().vaultNever = false;   // asked for again after "Never for this host"
    store(); render();
    selectListener(current(), true);
  };
  $("vaultCreate").onclick = () => run(async () => { await vault.create(); await refreshMethods(); say("Vault created. Save this host's password in it."); });
  $("vaultUnlock").onclick = () => run(unlockAndAdopt);
  // another passkey for the same vault: a phone, Google Password Manager, iCloud Keychain, Windows
  // Hello, a security key… The system's dialog picks where it is made ("Use a phone or tablet",
  // "Use a different passkey"); each one unlocks the vault on its own.
  $("vaultAddKey").onclick = () => run(async () => {
    const label = $("vaultKeyName").value.trim();
    try { await vault.addPasskey(label); }
    catch (e) {
      if (e.name === "InvalidStateError") throw new Error("That passkey provider already holds a passkey of this vault: choose another one (a phone, a security key…).");
      throw e;
    }
    $("vaultKeyName").value = ""; await refreshMethods();
    say(`Passkey${label ? ` “${label}”` : ""} added: it opens the vault too.`);
  });
  $("vaultNewCode").onclick = () => run(async () => {
    const code = await vault.newRecoveryCode(); await refreshMethods();
    $("vaultCodeText").textContent = code; $("vaultCodeBox").hidden = false;
    say("Recovery code created; an earlier one no longer opens the vault. It is shown below this once.");
  });
  $("vaultCodeCopy").onclick = () => navigator.clipboard.writeText($("vaultCodeText").textContent).then(
    () => say("Recovery code copied."), () => say("Select the code and copy it."));
  const unlockWithCode = () => run(async () => {
    const code = $("vaultCodeInput").value;
    try { await vault.unlockWithCode(code); } finally { $("vaultCodeInput").value = ""; }
    adopt();
    say("Vault unlocked with the recovery code. Add a passkey you have now, and maybe a new recovery code.");
  });
  $("vaultCodeUnlock").onclick = unlockWithCode;
  // Enter in the vault's own fields acts there; it must not submit the form (Connect)
  for (const [field, action] of [["vaultCodeInput", unlockWithCode], ["vaultKeyName", () => $("vaultAddKey").click()]])
    $(field).addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); action(); } });
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
  // only its own passkey opens the vault (its PRF secret): without it, the way out is to start
  // over. Asks twice, like deleting a host; the hosts stay, their saved passwords go.
  let vaultDeleteArmed = 0;
  $("vaultDelete").onclick = () => run(async () => {
    const saved = state.hosts.filter((h) => h.vaultSaved);
    if (Date.now() - vaultDeleteArmed > 4000) {
      vaultDeleteArmed = Date.now(); $("vaultDelete").textContent = "Delete the vault: click again";
      setTimeout(() => { $("vaultDelete").textContent = "Delete the vault"; }, 4000);
      say(saved.length ? `This deletes ${saved.length} saved password${saved.length > 1 ? "s" : ""}. To keep ${saved.length > 1 ? "them" : "it"}, unlock and export first.`
        : "This deletes the vault in this browser.");
      return;
    }
    vaultDeleteArmed = 0; $("vaultDelete").textContent = "Delete the vault";
    await vault.destroy(); exists = false; methods = null; $("pass").value = "";
    for (const h of saved) h.vaultSaved = false;
    store();
    say(`Vault deleted${saved.length ? `, with ${saved.length} saved password${saved.length > 1 ? "s" : ""}` : ""}. Create a new one with the passkey you have now.`);
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

  // ---- after a connection with a typed password: offer to keep it in the passkey vault, the way
  // a phone offers to save a password after a sign-in. The password waits here, in memory only,
  // until the offer is answered or two minutes pass (the session's own copy lives in the client).
  let offer = null;
  function dropOffer() { if (offer) clearTimeout(offer.timer); offer = null; }
  function keepOffer(h, password) {
    dropOffer();
    if (available && password && !h.vaultNever) offer = { id: h.id, password, timer: setTimeout(dropOffer, 120000) };
  }
  const offeredHost = () => offer && state.hosts.find((h) => h.id === offer.id);

  // ---- for the page
  window.FreeRDPHostsUI = {
    current,
    get selected() { return state.selected; },
    onSelect(fn) { selectListener = fn; },
    openLink,
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
      keepOffer(h, host.password);
      try { return consume(host); } finally { host.password = ""; $("pass").value = ""; }
    },
    // the host whose typed password may be kept, or null: { name, update } (update: replaces one)
    saveOffer() { const h = offeredHost(); return h ? { name: h.name, update: h.vaultSaved } : null; },
    // keep it: one passkey prompt (creating the vault on first use), then locked again
    async acceptSave() {
      const h = offeredHost();
      if (!h) throw new Error("Nothing to save any more.");
      if (busy) throw new Error("Wait for the vault operation to finish.");
      busy = true;
      try {
        if (!exists) { await vault.create(); await refreshMethods(); }
        else if (!vault.unlocked) await unlockAndAdopt();
        await vault.save({ id: h.id, label: h.name, host: target(h) || "unset", username: h.user,
          password: offer.password, extra: h.extra, direct: h.direct });
        h.vault = true; h.vaultSaved = true; h.vaultNever = false; store();
      } finally { dropOffer(); busy = false; lock(); render(); }
    },
    declineSave(never) {
      const h = offeredHost();
      if (h && never) { h.vaultNever = true; store(); }
      dropOffer();
    },
    lock,
  };
  render();
  (async () => {
    try {
      if (!window.isSecureContext || !window.PublicKeyCredential || !navigator.credentials || !window.crypto?.subtle) return;
      vault = new FreeRDPVault.Vault(); available = true;
      try { await refreshMethods(); } catch (e) { exists = await vault.exists(); }   // a record this page cannot read
    } catch (e) { /* no vault here: renderVault says why */ }
    finally { renderVault(); }
  })();
})();
