const {test} = require("node:test");
const assert = require("node:assert/strict");
const {webcrypto} = require("node:crypto");
globalThis.crypto ??= webcrypto;
const {Vault, connectionArgs} = require("../vault.js");
function authenticator({enabled=true, output=true, uv=true, secret=42, wrongId=false, get, early=false, gets}={}) {
  const id = new Uint8Array([1,2,3]), authData = new Uint8Array(37); authData[32] = uv ? 5 : 1;
  return {
    async create(options) {
      assert.equal(options.publicKey.authenticatorSelection.userVerification, "required");
      assert.equal(options.publicKey.authenticatorSelection.residentKey, "required");
      assert.equal(options.publicKey.extensions.prf.eval.first.length,32);
      if (early) return {rawId:id, response:{getAuthenticatorData:() => authData.buffer},
        getClientExtensionResults:() => ({prf:{enabled, results:{first:new Uint8Array(32).fill(secret).buffer}}})};
      return {rawId:id, getClientExtensionResults:() => ({prf:{enabled}})};
    },
    async get(options) {
      assert.equal(options.publicKey.userVerification, "required");
      assert.equal(options.publicKey.extensions.prf.eval.first.length,32);
      if (gets) gets.count++;
      if (get) await get(options);
      return {rawId:wrongId ? new Uint8Array([4]) : id, response:{authenticatorData:authData},
        getClientExtensionResults:() => output ? {prf:{results:{first:new Uint8Array(32).fill(secret)}}} : {}};
    }
  };
}
function memoryStore() {
  let value;
  return async (operation, next, expected) => {
    if (operation === "get") return structuredClone(value);
    if (operation === "delete") { value = undefined; return; }
    assert.equal(value?.revision ?? null, expected, "revision conflict");
    value = structuredClone(next);
  };
}
const host = (name="alpha", password="synthetic-secret-one") => ({host:name+".local:3389",
  username:name+"-user", password, label:name+" label", extra:"/gfx:AV1:i444", direct:true});
async function fixture() {
  const store=memoryStore(), vault=new Vault(store,authenticator()); await vault.create();
  return {store,vault};
}
test("multi-host encrypted roundtrip hides passwords and metadata; lock requires reauthentication", async () => {
  const {store,vault}=await fixture(), a=await vault.save(host()), b=await vault.save(host("beta","second-secret"));
  const record=await store("get"), serialized=JSON.stringify(record);
  for (const value of ["alpha.local", "alpha-user", "alpha label", "synthetic-secret-one", "beta.local", "second-secret"])
    assert.ok(!serialized.includes(value), value+" leaked");
  assert.notEqual(record.keys[0].wrappedKey.iv,record.payload.iv);
  assert.equal(vault.list().length,2); assert.ok(!("password" in vault.list()[0]));
  let copy; vault.use(b,h=>{copy=h; assert.equal(h.password,"second-secret");}); assert.equal(copy.password,"");
  vault.lock(); assert.equal(vault.unlocked,false); assert.throws(()=>vault.list()); assert.throws(()=>vault.use(a,()=>{}));
  await vault.unlock(); vault.use(a,h=>assert.equal(h.password,"synthetic-secret-one"));
});
test("update, keep password, and delete persist encrypted and preserve another host", async () => {
  const {store,vault}=await fixture(), a=await vault.save(host()), b=await vault.save(host("beta","second-secret"));
  const before=await store("get");
  await vault.save({...host("changed",""),id:a},true);
  const after=await store("get"); assert.notEqual(before.payload.iv,after.payload.iv);
  vault.lock(); await vault.unlock(); vault.use(a,h=>{assert.equal(h.host,"changed.local:3389");assert.equal(h.password,"synthetic-secret-one");});
  await vault.save({...host("changed","replacement"),id:a}); await vault.remove(b);
  vault.lock(); await vault.unlock(); assert.equal(vault.list().length,1); vault.use(a,h=>assert.equal(h.password,"replacement"));
});
test("wrong PRF secret and encrypted box tampering fail closed", async () => {
  const {store,vault}=await fixture(); await vault.save(host()); const record=await store("get");
  await assert.rejects(new Vault(store,authenticator({secret:43})).unlock(),{name:"OperationError"});
  const boxes={wrappedKey:r=>r.keys[0].wrappedKey, payload:r=>r.payload};
  for (const box of Object.values(boxes)) for (const field of ["iv","ciphertext"]) {
    const copy=structuredClone(record), bytes=Uint8Array.from(atob(box(copy)[field]),c=>c.charCodeAt(0));
    bytes[0]^=1; box(copy)[field]=btoa(String.fromCharCode(...bytes));
    const broken=new Vault(async()=>copy,authenticator());
    await assert.rejects(broken.unlock(),{name:"OperationError"}); assert.equal(broken.unlocked,false);
  }
});
test("missing PRF, missing UV and mismatched credentials never persist a vault", async () => {
  for (const options of [{enabled:false},{output:false},{uv:false},{wrongId:true}]) {
    const store=memoryStore(), vault=new Vault(store,authenticator(options));
    await assert.rejects(vault.create()); assert.equal(await store("get"),undefined); assert.equal(vault.unlocked,false);
  }
});
test("locking cancels late authenticator results and rejects overlapping operations", async () => {
  const {store,vault}=await fixture(); await vault.save(host()); vault.lock();
  let release, entered; const started=new Promise(r=>entered=r), gate=new Promise(r=>release=r);
  vault.credentials=authenticator({get:async()=>{entered();await gate;}});
  const pending=vault.unlock(); await started;
  await assert.rejects(vault.unlock(),/in progress/); vault.lock(); release();
  await assert.rejects(pending,{name:"AbortError"}); assert.equal(vault.unlocked,false);
  assert.throws(()=>vault.list());
});
test("lock during encryption cannot resurrect plaintext state", async () => {
  const {vault}=await fixture(); const pending=vault.save(host()); vault.lock();
  await assert.rejects(pending,{name:"AbortError"}); assert.equal(vault.unlocked,false);
});
test("two tabs detect stale writes instead of overwriting saved hosts", async () => {
  const {store,vault}=await fixture(), other=new Vault(store,authenticator()); await other.unlock();
  await vault.save(host()); await assert.rejects(other.save(host("beta")),/revision conflict/);
  other.lock(); await other.unlock(); assert.equal(other.list()[0].host,"alpha.local:3389");
});
test("selected host builds exact WASM argv including its password; extra options cannot override identity", async () => {
  const {vault}=await fixture(), a=await vault.save(host()), b=await vault.save(host("beta","second-secret"));
  const args=vault.use(b,h=>connectionArgs(h,"1920x1080"));
  assert.ok(args.includes("/v:beta.local:3389")); assert.ok(args.includes("/u:beta-user")); assert.ok(args.includes("/p:second-secret"));
  assert.ok(!args.includes("/p:synthetic-secret-one")); assert.ok(args.includes("/sound"));
  for (const extra of ["/p:leak", "/v:evil", "/u:other", "/gp:leak", "/args-from:file", "/from-stdin", "/gateway:p:leak", "/proxy:user:secret@host", "/pth:hash", "/endpointfedauth:token", "/tls:secrets-file:out", "/print-reconnect-cookie"])
    assert.throws(()=>connectionArgs({...host(),extra},"800x600"));
  assert.throws(()=>vault.use(a,async()=>{}),/synchronous/);
});
test("the screen's scale goes to the server at connect above 100 %, clamped to 500; Extra options win", () => {
  const scale=(s,extra="")=>connectionArgs({...host(),extra},"3024x1964",s).filter(a=>/^\/scale/.test(a));
  assert.deepEqual(scale(undefined),[]); assert.deepEqual(scale(100),[]); assert.deepEqual(scale(90),[]);
  assert.deepEqual(scale(200),["/scale-desktop:200"]); assert.deepEqual(scale(149.6),["/scale-desktop:150"]);
  assert.deepEqual(scale(600),["/scale-desktop:500"]);
  assert.deepEqual(scale(200,"/scale-desktop:125"),["/scale-desktop:125"]); assert.deepEqual(scale(200,"/scale:140"),["/scale:140"]);
});
test("a passkey that evaluates the PRF while it is created needs one prompt, and unlocks the same vault", async () => {
  const gets={count:0}, store=memoryStore(), vault=new Vault(store,authenticator({early:true,gets}));
  await vault.create(); assert.equal(gets.count,0);
  const id=await vault.save(host()); vault.lock();
  await vault.unlock(); assert.equal(gets.count,1);
  vault.use(id,h=>assert.equal(h.password,"synthetic-secret-one"));
});
test("a PRF value from creation without user verification is not used: a second prompt runs", async () => {
  const gets={count:0}, vault=new Vault(memoryStore(),authenticator({early:true,uv:false,gets}));
  await assert.rejects(vault.create(), /User verification/); assert.equal(gets.count,1);
});
test("a vault whose passkey is gone can be deleted without unlocking, and a new passkey starts over", async () => {
  const {store,vault}=await fixture(); await vault.save(host()); vault.lock();
  const other=new Vault(store,authenticator({secret:7}));
  await assert.rejects(other.unlock(),{name:"OperationError"});
  await other.destroy(); assert.equal(await store("get"),undefined); assert.equal(await other.exists(),false);
  await other.create(); const id=await other.save(host("beta","second-secret")); other.lock();
  await other.unlock(); assert.deepEqual(other.list().map(h=>h.id),[id]);
  await assert.rejects(vault.unlock(),{name:"OperationError"});
});
test("deleting an unlocked vault locks it and clears its passwords from the page", async () => {
  const {store,vault}=await fixture(); await vault.save(host());
  await vault.destroy(); assert.equal(vault.unlocked,false); assert.throws(()=>vault.list());
  assert.equal(await store("get"),undefined);
});

// Several providers, each holding its own passkeys with their own PRF secrets: create() makes
// one (refusing an excluded one it already holds), get() answers for the first one it holds.
function provider(name, secret) {
  const held=new Map(), authData=new Uint8Array(37); authData[32]=5;
  const b64=b=>btoa(String.fromCharCode(...new Uint8Array(b)));
  return {name, held,
    async create(options) {
      const pk=options.publicKey;
      if ((pk.excludeCredentials||[]).some(c=>held.has(b64(c.id)))) throw new DOMException("already registered","InvalidStateError");
      const id=crypto.getRandomValues(new Uint8Array(16)); held.set(b64(id),{secret,name:pk.user.name});
      return {rawId:id, getClientExtensionResults:()=>({prf:{enabled:true}})};
    },
    async get(options) {
      const c=options.publicKey.allowCredentials.find(c=>held.has(b64(c.id)));
      if (!c) throw new DOMException("no passkey here","NotAllowedError");
      const prf=new Uint8Array(32).fill(held.get(b64(c.id)).secret); prf[0]^=options.publicKey.extensions.prf.eval.first[0];
      return {rawId:c.id, response:{authenticatorData:authData}, getClientExtensionResults:()=>({prf:{results:{first:prf}}})};
    }};
}
test("a second passkey from another provider opens the same vault; names stay encrypted", async () => {
  const store=memoryStore(), phone=provider("phone",11), hello=provider("hello",22);
  const vault=new Vault(store,phone); await vault.create(); const a=await vault.save(host());
  vault.credentials=hello; await vault.addPasskey("Windows Hello");
  assert.deepEqual(vault.keys().map(k=>[k.kind,k.label,k.current]),[["passkey","First passkey",true],["passkey","Windows Hello",false]]);
  const record=await store("get"); assert.equal(record.version,2); assert.equal(record.keys.length,2);
  assert.ok(!JSON.stringify(record).includes("Windows Hello"));
  for (const p of [phone,hello]) {
    const other=new Vault(store,p); await other.unlock(); other.use(a,h=>assert.equal(h.password,"synthetic-secret-one"));
    assert.equal(other.keys().find(k=>k.current).label, p===phone ? "First passkey" : "Windows Hello");
  }
  assert.deepEqual(await new Vault(store,phone).methods(),{passkeys:2,code:false});
});
test("a provider that already holds a passkey of the vault is refused, and nothing changes", async () => {
  const store=memoryStore(), phone=provider("phone",11), vault=new Vault(store,phone); await vault.create();
  const before=await store("get");
  await assert.rejects(vault.addPasskey("again"),{name:"InvalidStateError"});
  assert.deepEqual(await store("get"),before); assert.equal(phone.held.size,1);
});
test("removing a passkey stops it opening the vault; the last passkey cannot be removed", async () => {
  const store=memoryStore(), phone=provider("phone",11), key=provider("key",33);
  const vault=new Vault(store,phone); await vault.create(); await vault.save(host());
  vault.credentials=key; const id=await vault.addPasskey("Security key");
  await vault.removeKey(id); vault.lock();
  await assert.rejects(new Vault(store,key).unlock(),{name:"NotAllowedError"});
  vault.credentials=phone; await vault.unlock(); assert.equal(vault.keys().length,1);
  await assert.rejects(vault.removeKey(vault.keys()[0].id),/at least one passkey/);
});
test("a recovery code opens the vault without a passkey; a new code replaces the old one", async () => {
  const store=memoryStore(), vault=new Vault(store,provider("phone",11)); await vault.create(); const a=await vault.save(host());
  const code=await vault.newRecoveryCode(); assert.match(code,/^([A-HJ-NP-Z2-9]{4}-){6}[A-HJ-NP-Z2-9]{4}$/);
  assert.ok(!JSON.stringify(await store("get")).includes(code.replace(/-/g,"")));
  assert.deepEqual(await vault.methods(),{passkeys:1,code:true});
  const lost=new Vault(store,provider("elsewhere",44));
  await assert.rejects(lost.unlock(),{name:"NotAllowedError"});
  await lost.unlockWithCode(" "+code.toLowerCase().replace(/-/g," ")+" ");
  lost.use(a,h=>assert.equal(h.password,"synthetic-secret-one"));
  assert.equal(lost.keys().find(k=>k.current).kind,"code");
  // the way back to passkeys: add one while the code has the vault open
  lost.credentials=provider("new phone",55); await lost.addPasskey("New phone");
  const second=await lost.newRecoveryCode(); lost.lock();
  await assert.rejects(new Vault(store).unlockWithCode(code),/does not open/);
  await assert.rejects(new Vault(store).unlockWithCode("short"),/28 letters/);
  const back=new Vault(store,lost.credentials); await back.unlock(); assert.equal(back.keys().length,3);
  await new Vault(store).unlockWithCode(second);
});
test("a version 1 vault opens and is written as version 2 with its passkey kept", async () => {
  const {store,vault}=await fixture(), a=await vault.save(host());
  const v2=await store("get"), {keys,...rest}=v2;
  const v1={...rest,version:1,credentialId:keys[0].credentialId,wrappedKey:keys[0].wrappedKey};
  await store("put",v1,v2.revision);
  const old=new Vault(store,authenticator()); await old.unlock();
  assert.equal(old.keys()[0].label,"First passkey"); old.use(a,h=>assert.equal(h.password,"synthetic-secret-one"));
  await old.save(host("beta","second-secret")); const after=await store("get");
  assert.equal(after.version,2); assert.equal(after.credentialId,undefined); assert.equal(after.keys[0].credentialId,keys[0].credentialId);
  old.lock(); await old.unlock(); assert.equal(old.list().length,2);
});
test("a record this version cannot read is refused, not opened", async () => {
  for (const record of [{version:3}, {version:2,keys:[]}, {version:2,keys:[{kind:"code",salt:"AA==",iterations:1000,wrappedKey:{}}]}])
    await assert.rejects(new Vault(async()=>record,authenticator()).unlock(),/No supported vault/);
});
