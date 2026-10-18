const {test} = require("node:test");
const assert = require("node:assert/strict");
const H = require("../hosts.js");
const memory = (init = {}) => { const m = new Map(Object.entries(init)); return {getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), m}; };

test("a first visit gets one host with the defaults", () => {
  const s = H.load(memory());
  assert.equal(s.hosts.length, 1); assert.equal(s.hosts[0].name, "My server");
  assert.equal(s.selected, s.hosts[0].id); assert.equal(s.hosts[0].session.codec, "auto");
});
test("old settings become the first host; the old default extra becomes AV1 4:4:4", () => {
  const old = {host: "127.0.0.1:13390", user: "alice", extra: "/gfx:AV1:i444", fullscreen: true};
  const h = H.load(memory({"freerdp-web-settings": JSON.stringify(old)})).hosts[0];
  assert.equal(h.host, "127.0.0.1:13390"); assert.equal(h.user, "alice"); assert.equal(h.fullscreen, true);
  assert.equal(h.extra, ""); assert.equal(h.session.codec, "av1-444");
});
test("hosts never store a password or credential options", () => {
  const st = memory(), s = H.load(st);
  s.hosts[0].password = "secret-in-memory";
  H.save(st, s);
  assert.ok(!st.m.get(H.KEY).includes("secret-in-memory"));
  assert.throws(() => H.clean({name: "x", extra: "/p:leak"}));
});
test("broken entries are skipped, a missing selection falls back to the first host", () => {
  const st = memory({[H.KEY]: JSON.stringify({selected: "gone", hosts: [null, {name: "A", host: "a:1"}, {name: "B", extra: "/p:x"}]})});
  const s = H.load(st);
  assert.deepEqual(s.hosts.map(h => h.name), ["A"]); assert.equal(s.selected, s.hosts[0].id);
});
test("unique names", () => {
  const s = {hosts: [{name: "Lab"}, {name: "Lab 2"}]};
  assert.equal(H.uniqueName(s, "Lab"), "Lab 3"); assert.equal(H.uniqueName(s, "Office"), "Office");
});
test("export without passwords, import gives fresh ids and no passwords", async () => {
  const s = H.load(memory()); s.hosts[0].name = "Office"; s.hosts[0].vault = true; s.hosts[0].vaultSaved = true;
  const text = await H.exportText(s);
  assert.ok(!text.includes(s.hosts[0].id)); assert.ok(!text.includes("vaultSaved"));
  const back = await H.importText(text);
  assert.equal(back[0].host.name, "Office"); assert.notEqual(back[0].host.id, s.hosts[0].id);
  assert.equal(back[0].password, ""); assert.equal(back[0].host.vaultSaved, false);
});
test("passwords only when given; encrypted with a passphrase, refused without it or with a wrong one", async () => {
  const s = H.load(memory()); const id = s.hosts[0].id;
  const plain = await H.exportText(s, {passwords: new Map([[id, "pw-1"]])});
  assert.ok(plain.includes("pw-1"));
  const sealed = await H.exportText(s, {passwords: new Map([[id, "pw-1"]]), passphrase: "correct horse"});
  assert.ok(!sealed.includes("pw-1")); assert.ok(!sealed.includes("127.0.0.1"));
  await assert.rejects(H.importText(sealed), H.NeedPassphrase);
  await assert.rejects(H.importText(sealed, "wrong"), /Wrong passphrase/);
  const back = await H.importText(sealed, "correct horse");
  assert.equal(back[0].password, "pw-1"); assert.equal(back[0].host.host, "127.0.0.1:3390");
});
test("files that are not ours are refused", async () => {
  await assert.rejects(H.importText("not json"), /not JSON/);
  await assert.rejects(H.importText(JSON.stringify({format: "other", version: 1})), /not a FreeRDP Web hosts file/);
  await assert.rejects(H.importText(JSON.stringify({format: H.FORMAT, version: 1, hosts: [{name: "x", extra: "/p:y"}]})));
});
