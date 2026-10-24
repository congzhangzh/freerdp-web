// WebAuthn releases a local encryption key; this is not a server login verifier.
(function (root) {
  "use strict";
  const enc = new TextEncoder(), dec = new TextDecoder();
  const random = n => crypto.getRandomValues(new Uint8Array(n));
  const encode = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
  const decode = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
  const aborted = () => new DOMException("Vault operation cancelled or locked.", "AbortError");
  const aad = purpose => enc.encode("freerdp-vault:v1:" + purpose);
  async function wrappingKey(prf, salt) {
    const material = await crypto.subtle.importKey("raw", prf, "HKDF", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({name:"HKDF", hash:"SHA-256", salt,
      info:aad("wrap")}, material, {name:"AES-GCM", length:256}, false, ["encrypt", "decrypt"]);
  }
  async function seal(key, bytes, purpose) {
    const iv = random(12);
    return {iv:encode(iv), ciphertext:encode(await crypto.subtle.encrypt(
      {name:"AES-GCM", iv, additionalData:aad(purpose)}, key, bytes))};
  }
  async function open(key, box, purpose) {
    return new Uint8Array(await crypto.subtle.decrypt({name:"AES-GCM", iv:decode(box.iv),
      additionalData:aad(purpose)}, key, decode(box.ciphertext)));
  }
  // One prompt for any of the vault's passkeys: they share the vault's PRF salt (each passkey's
  // own PRF secret still gives it its own output), so plain eval works where evalByCredential
  // is missing. Returns the passkey the person picked and its PRF output.
  async function evaluate(credentials, ids, salt, signal) {
    const assertion = await credentials.get({signal, publicKey:{challenge:random(32),
      allowCredentials:ids.map(id => ({type:"public-key", id:decode(id)})), userVerification:"required",
      timeout:60000, extensions:{prf:{eval:{first:salt}}}}});
    const id = assertion && encode(assertion.rawId);
    if (!id || !ids.includes(id)) throw new Error("A different passkey was returned.");
    const flags = new Uint8Array(assertion.response.authenticatorData);
    if (flags.length < 37 || !(flags[32] & 4)) throw new Error("User verification was not confirmed.");
    const output = assertion.getClientExtensionResults().prf?.results?.first;
    if (!output || output.byteLength !== 32) throw new Error("This browser or passkey does not support PRF. No password was saved.");
    return {id, prf:new Uint8Array(output)};
  }
  // A new passkey with PRF: one prompt, or two when the authenticator only evaluates the PRF on
  // a later assertion. excludeCredentials keeps a provider from holding two keys of one vault.
  async function register(credentials, salt, check, signal, label = "", exclude = []) {
    const credential = await credentials.create({signal, publicKey:{challenge:random(32),
      rp:{name:"FreeRDP Local Vault"}, user:{id:random(32), name:label ? `freerdp-local-vault (${label})` : "freerdp-local-vault",
        displayName:label ? `FreeRDP Local Vault (${label})` : "FreeRDP Local Vault"},
      pubKeyCredParams:[{type:"public-key", alg:-7}, {type:"public-key", alg:-257}],
      authenticatorSelection:{residentKey:"required", userVerification:"required"},
      excludeCredentials:exclude.map(id => ({type:"public-key", id:decode(id)})),
      attestation:"none", timeout:60000, extensions:{prf:{eval:{first:salt}}}}});
    check();
    const created = credential?.getClientExtensionResults().prf;
    if (!created?.enabled && !created?.results)
      throw new Error("Passkey did not enable PRF. Nothing was saved; remove the unused passkey in system settings if needed.");
    const credentialId = encode(credential.rawId);
    // Authenticators that evaluate the PRF while creating the passkey save the second prompt
    // (one Touch ID instead of two); the value is the one a later unlock gets for this salt.
    // Taken only when the creation itself verified the user, as evaluate() requires.
    const early = created.results?.first, authData = credential.response?.getAuthenticatorData?.();
    const verified = authData && authData.byteLength >= 37 && (new Uint8Array(authData)[32] & 4);
    const prf = early?.byteLength === 32 && verified ? new Uint8Array(early)
      : (await evaluate(credentials, [credentialId], salt, signal)).prf;
    return {credentialId, prf};
  }
  // The recovery code: 28 symbols from a 32-letter alphabet without 0/O and 1/I (140 random
  // bits), in groups of four. PBKDF2 as for the encrypted export, though the code is not guessable.
  const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", CODE_ITERATIONS = 600000;
  function newCode() {
    const bytes = random(28), code = Array.from(bytes, b => CODE_ALPHABET[b & 31]).join("");
    bytes.fill(0);
    return code.match(/.{4}/g).join("-");
  }
  async function codeKey(code, salt, iterations) {
    const normal = String(code).toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (normal.length !== 28) throw new Error("A recovery code has 28 letters and digits.");
    const material = await crypto.subtle.importKey("raw", enc.encode(normal), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({name:"PBKDF2", hash:"SHA-256", salt, iterations},
      material, {name:"AES-GCM", length:256}, false, ["encrypt", "decrypt"]);
  }
  // Each key wraps the same data key. Version 1 had a single passkey; it reads as version 2.
  const keyId = k => k.kind === "code" ? "code" : k.credentialId;
  const wrapPurpose = k => k.kind === "code" ? "key:code" : "key";
  function normalize(record) {
    if (record?.version === 1) {
      const {credentialId, wrappedKey, ...rest} = record;
      record = {...rest, version:2, keys:[{kind:"passkey", credentialId, wrappedKey}]};
    }
    if (record?.version !== 2 || !Array.isArray(record.keys) || !record.keys.some(k => k?.kind === "passkey") ||
        !record.keys.every(k => k?.wrappedKey && (k.kind === "passkey" ? typeof k.credentialId === "string"
          : k.kind === "code" && typeof k.salt === "string" && Number.isInteger(k.iterations) && k.iterations >= 100000)))
      throw new Error("No supported vault was found.");
    return record;
  }
  const passkeyIds = record => record.keys.filter(k => k.kind === "passkey").map(k => k.credentialId);
  function validateOptions(extra) {
    if (typeof extra !== "string" || extra.split(/\s+/).some(arg =>
      /^[/+-](?:v|u|p|d|password|from-stdin|args-from|password-is-pin|gateway|g|gu|gp|gd|gat|pth|pass-the-hash|proxy|endpointfedauth|assistance|smartcard-logon|reconnect-cookie|print-reconnect-cookie|tls-secrets-file)(?::|$)/i.test(arg) || /^[/+-]tls:.*secrets/i.test(arg)))
      throw new Error("Use the host, user and password fields. Credential and secret-export options are not supported in Extra options.");
    return extra;
  }
  function validateHost(value) {
    if (!value || typeof value.host !== "string" || !value.host.trim() ||
        typeof value.username !== "string" || typeof value.password !== "string" ||
        typeof value.extra !== "string" || typeof value.direct !== "boolean") throw new Error("Invalid host entry.");
    // Connection identity belongs to these fields, never to free-form options.
    validateOptions(value.extra);
    return {id:value.id || crypto.randomUUID(), label:String(value.label || value.host).trim(),
      host:value.host.trim(), username:value.username, password:value.password,
      extra:value.extra, direct:value.direct};
  }
  // labels: the keys' names and dates, inside the encryption (the record holds no names)
  function validatePayload(payload) {
    if (!payload || !Array.isArray(payload.hosts)) throw new Error("Invalid vault contents.");
    const hosts = payload.hosts.map(validateHost);
    if (new Set(hosts.map(h => h.id)).size !== hosts.length) throw new Error("Duplicate host identifiers.");
    const labels = {};
    if (payload.labels !== undefined) {
      if (!payload.labels || typeof payload.labels !== "object" || Array.isArray(payload.labels)) throw new Error("Invalid vault contents.");
      for (const [id, v] of Object.entries(payload.labels)) {
        if (!v || typeof v.label !== "string" || typeof v.added !== "number") throw new Error("Invalid vault contents.");
        labels[id] = {label:v.label.slice(0, 60), added:v.added};
      }
    }
    return {hosts, labels};
  }
  const cleanLabel = (label, fallback) => String(label || "").trim().slice(0, 40) || fallback;
  function vaultStore() {
    let database;
    const db = () => database ??= new Promise((resolve, reject) => {
      const request = indexedDB.open("freerdp-credential-vault", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("vault");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return async (operation, value, expectedRevision) => {
      const database = await db();
      return new Promise((resolve, reject) => {
        const tx = database.transaction("vault", operation === "get" ? "readonly" : "readwrite");
        const store = tx.objectStore("vault"), request = store.get("default");
        let result, conflict = false;
        request.onsuccess = () => {
          result = request.result;
          if (operation === "get") return;
          if (operation === "delete") { store.delete("default"); return; }
          // Atomic compare-and-swap: another tab must not silently lose its edits.
          if ((result?.revision ?? null) !== expectedRevision) { conflict = true; tx.abort(); return; }
          store.put(value, "default");
        };
        tx.oncomplete = () => resolve(operation === "get" ? result : undefined);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(conflict ? new Error("Vault changed in another tab. Lock and unlock to reload it.") : tx.error || aborted());
      });
    };
  }
  class Vault {
    // #kek and #slot: the key that unlocked the vault, kept while unlocked so that adding a
    // passkey or a recovery code can wrap the data key again without another prompt
    #key = null; #kek = null; #slot = null; #payload = null; #record = null; #epoch = 0; #busy = false; #controller = null;
    constructor(store = vaultStore(), credentials = navigator.credentials) { this.store = store; this.credentials = credentials; }
    get unlocked() { return !!this.#key; }
    get busy() { return this.#busy; }
    async exists() { return !!(await this.store("get")); }
    // what can open the vault, readable while locked: the number of passkeys and whether a
    // recovery code exists (the names stay encrypted); null without a vault
    async methods() {
      const record = await this.store("get");
      if (!record) return null;
      const r = normalize(record);
      return {passkeys:passkeyIds(r).length, code:r.keys.some(k => k.kind === "code")};
    }
    lock() {
      this.#epoch++; this.#controller?.abort(); this.#key = this.#kek = this.#slot = null;
      // Strings cannot be reliably overwritten in JavaScript; drop all retained references.
      if (this.#payload) for (const h of this.#payload.hosts) h.password = "";
      this.#payload = this.#record = null;
    }
    async #operation(action) {
      if (this.#busy) throw new Error("Another vault operation is in progress.");
      this.#busy = true; const epoch = this.#epoch;
      const controller = this.#controller = new AbortController();
      const check = () => { if (this.#epoch !== epoch || controller.signal.aborted) throw aborted(); };
      try { return await action(check, controller.signal); }
      finally { this.#busy = false; this.#controller = null; }
    }
    async create(label) {
      return this.#operation(async (check, signal) => {
        if (await this.store("get")) throw new Error("A vault already exists. Unlock it to save more hosts.");
        check();
        const salt = random(32), {credentialId, prf} = await register(this.credentials, salt, check, signal);
        const raw = random(32); let plaintext;
        try {
          check(); const kek = await wrappingKey(prf, salt);
          const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
          const payload = {hosts:[], labels:{[credentialId]:{label:cleanLabel(label, "First passkey"), added:Date.now()}}};
          plaintext = enc.encode(JSON.stringify(payload));
          const slot = {kind:"passkey", credentialId, wrappedKey:await seal(kek, raw, "key")};
          const record = {version:2, revision:crypto.randomUUID(), salt:encode(salt), keys:[slot],
            payload:await seal(key, plaintext, "hosts")};
          check(); await this.store("put", record, null); check();
          this.#key = key; this.#kek = kek; this.#slot = slot; this.#record = record; this.#payload = payload;
        } finally { prf.fill(0); raw.fill(0); plaintext?.fill(0); }
      });
    }
    // with any of the vault's passkeys: the system's passkey chooser offers each of them
    async unlock() {
      return this.#operation(async (check, signal) => {
        const stored = await this.store("get"); check();
        if (!stored) throw new Error("No supported vault was found.");
        const record = normalize(stored), salt = decode(record.salt);
        const {id, prf} = await evaluate(this.credentials, passkeyIds(record), salt, signal);
        try { check(); await this.#open(check, record, record.keys.find(k => keyId(k) === id), await wrappingKey(prf, salt)); }
        finally { prf.fill(0); }
      });
    }
    // without a passkey: the recovery code, created earlier while unlocked
    async unlockWithCode(code) {
      return this.#operation(async check => {
        const stored = await this.store("get"); check();
        if (!stored) throw new Error("No supported vault was found.");
        const record = normalize(stored), slot = record.keys.find(k => k.kind === "code");
        if (!slot) throw new Error("This vault has no recovery code.");
        const kek = await codeKey(code, decode(slot.salt), slot.iterations); check();
        try { await this.#open(check, record, slot, kek); }
        catch (e) { if (e.name === "OperationError") throw new Error("That recovery code does not open this vault."); throw e; }
      });
    }
    async #open(check, record, slot, kek) {
      let raw, plaintext;
      try {
        raw = await open(kek, slot.wrappedKey, wrapPurpose(slot));
        const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
        plaintext = await open(key, record.payload, "hosts");
        const payload = validatePayload(JSON.parse(dec.decode(plaintext))); check();
        this.#key = key; this.#kek = kek; this.#slot = slot; this.#record = record; this.#payload = payload;
      } finally { raw?.fill(0); plaintext?.fill(0); }
    }
    // For a passkey that is gone or on another device: no passkey can open the vault without its
    // own PRF secret, so starting over is the way out. The passwords in it are lost; locked or not.
    async destroy() {
      this.lock();
      return this.#operation(async check => { check(); await this.store("delete"); });
    }
    // ---- the keys: passkeys from any provider (phone, Google Password Manager, iCloud Keychain,
    // Windows Hello, a security key) and one recovery code, each wrapping the same data key
    keys() {
      this.#require();
      return this.#record.keys.map(k => {
        const id = keyId(k), l = this.#payload.labels[id];
        return {id, kind:k.kind, label:l?.label || (k.kind === "code" ? "Recovery code" : "Passkey"),
          added:l?.added || 0, current:keyId(this.#slot) === id};
      });
    }
    async #unwrapped(action) {
      const raw = await open(this.#kek, this.#slot.wrappedKey, wrapPurpose(this.#slot));
      try { return await action(raw); } finally { raw.fill(0); }
    }
    async addPasskey(label) {
      return this.#operation(async (check, signal) => {
        this.#require();
        const salt = decode(this.#record.salt), exclude = passkeyIds(this.#record);
        const {credentialId, prf} = await register(this.credentials, salt, check, signal, cleanLabel(label, ""), exclude);
        try {
          check(); const kek = await wrappingKey(prf, salt);
          const slot = {kind:"passkey", credentialId, wrappedKey:await this.#unwrapped(raw => seal(kek, raw, "key"))};
          const payload = structuredClone(this.#payload);
          payload.labels[credentialId] = {label:cleanLabel(label, `Passkey ${exclude.length + 1}`), added:Date.now()};
          await this.#commit(check, payload, [...this.#record.keys, slot]);
          return credentialId;
        } finally { prf.fill(0); }
      });
    }
    // a new code replaces the old one, which stops opening the vault; returned once, never stored
    async newRecoveryCode() {
      return this.#operation(async check => {
        this.#require();
        const code = newCode(), salt = random(16), kek = await codeKey(code, salt, CODE_ITERATIONS); check();
        const slot = {kind:"code", salt:encode(salt), iterations:CODE_ITERATIONS,
          wrappedKey:await this.#unwrapped(raw => seal(kek, raw, "key:code"))};
        const payload = structuredClone(this.#payload);
        payload.labels.code = {label:"Recovery code", added:Date.now()};
        await this.#commit(check, payload, [...this.#record.keys.filter(k => k.kind !== "code"), slot]);
        return code;
      });
    }
    // Removing a key drops its wrapped copy of the data key. A copy of the record taken before
    // still opens with that key: change the passwords that matter after losing a passkey.
    async removeKey(id) {
      return this.#operation(async check => {
        this.#require();
        const keys = this.#record.keys.filter(k => keyId(k) !== id);
        if (keys.length === this.#record.keys.length) throw new Error("That key does not open this vault.");
        if (!keys.some(k => k.kind === "passkey")) throw new Error("A vault keeps at least one passkey; to start over, delete the vault.");
        const payload = structuredClone(this.#payload); delete payload.labels[id];
        await this.#commit(check, payload, keys);
      });
    }
    #require() { if (!this.unlocked) throw new Error("Unlock the vault first."); }
    list() { this.#require(); return this.#payload.hosts.map(({password, ...metadata}) => ({...metadata})); }
    // a new encrypted snapshot; a version 1 record is written as version 2 from here on
    async #commit(check, payload, keys = this.#record.keys) {
      let plaintext, committed = false;
      try {
        plaintext = enc.encode(JSON.stringify(payload));
        const record = {...this.#record, keys, revision:crypto.randomUUID(), payload:await seal(this.#key, plaintext, "hosts")};
        check(); await this.store("put", record, this.#record.revision); check();
        for (const h of this.#payload.hosts) h.password = "";
        this.#record = record; this.#payload = payload; committed = true;
      } finally { plaintext?.fill(0); if (!committed) for (const h of payload.hosts) h.password = ""; }
    }
    async #mutate(change) {
      return this.#operation(async check => {
        this.#require(); const payload = structuredClone(this.#payload);
        let result;
        try { result = change(payload); } catch (e) { for (const h of payload.hosts) h.password = ""; throw e; }
        await this.#commit(check, payload); return result;
      });
    }
    async save(value, keepPassword = false) {
      return this.#mutate(payload => {
        const index = payload.hosts.findIndex(h => h.id === value.id);
        if (keepPassword && index < 0) throw new Error("The saved host no longer exists.");
        const host = validateHost({...value, password:keepPassword ? payload.hosts[index].password : value.password});
        if (index < 0) payload.hosts.push(host); else payload.hosts[index] = host;
        return host.id;
      });
    }
    async remove(id) { return this.#mutate(payload => { payload.hosts = payload.hosts.filter(h => h.id !== id); }); }
    // Callback must be synchronous; the connection bridge waits for WASM before reading.
    use(id, consume) {
      this.#require(); if (this.busy) throw new Error("Wait for the vault operation to finish.");
      const source = this.#payload.hosts.find(h => h.id === id);
      if (!source) throw new Error("Select a saved host.");
      const host = {...source};
      try { const result = consume(host); if (result?.then) throw new Error("Credential consumer must be synchronous."); return result; }
      finally { host.password = ""; }
    }
  }
  // scale: the screen's scale in percent (devicePixelRatio × 100). Above 100 it goes to the server at
  // connect (/scale-desktop), not only with the first display layout, so a scale-aware server
  // starts at the right size; FreeRDP then keeps that scale for the session's later layouts
  function connectionArgs(host, size, scale = 100) {
    const value = validateHost(host);
    const args = ["/v:" + value.host, "/u:" + value.username, "/p:" + value.password,
      "/cert:ignore", "/size:" + size, "/dynamic-resolution", ...value.extra.split(/\s+/).filter(Boolean)];
    if (!args.some(a => /^[/+-](sound|audio-mode)/.test(a))) args.push("/sound");
    const percent = Math.min(500, Math.round(scale));
    if (percent > 100 && !args.some(a => /^[/+-]scale(?:-desktop)?(?::|$)/i.test(a))) args.push("/scale-desktop:" + percent);
    return args;
  }
  const api = {Vault, vaultStore, connectionArgs, validateOptions};
  root.FreeRDPVault = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
