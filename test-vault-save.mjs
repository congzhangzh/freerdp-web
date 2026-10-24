import { connectTestSession } from "./test-connect.mjs";
// "Save the password?" after connecting, with Chrome's virtual authenticator (a platform passkey
// with user verification and PRF), against the CI xrdp session:
//   1. connect with a typed password: the offer appears; Save creates the vault and keeps it
//   2. after a reload, Connect with an empty password unlocks the vault and logs in
//   3. Never for this host: no offer on the next connection
// WebAuthn needs a domain, so the page is opened on localhost, not 127.0.0.1.
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = new URL(".chrome/", import.meta.url).pathname;
const profile = mkdtempSync(join(base, "vs-"));
const chrome = spawn("google-chrome", ["--headless=new", "--remote-debugging-port=9345", `--user-data-dir=${profile}`, "--no-first-run",
  "--window-size=1280,900", "--enable-unsafe-swiftshader",
  ...(process.env.CHROME_FLAGS ? process.env.CHROME_FLAGS.split(" ") : []), "about:blank"], { stdio: "ignore", env: { ...process.env, TMPDIR: base } });
chrome.on("exit", () => { rmSync(profile, { recursive: true, force: true });
  for (const n of readdirSync(base)) if (n.startsWith("com.google.Chrome.")) rmSync(join(base, n), { recursive: true, force: true }); });
let t; for (let i = 0; i < 150 && !t; i++) { await sleep(200); try { t = (await (await fetch("http://127.0.0.1:9345/json")).json()).find((x) => x.type === "page"); } catch {} }
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const p = new Map(); let logs = [];
const ceremonies = [];
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m.result ?? m.error); p.delete(m.id); }
  if (m.method === "Runtime.consoleAPICalled") logs.push(m.params.args.map((a) => a.value).join(" "));
  if (m.method === "WebAuthn.credentialAdded" || m.method === "WebAuthn.credentialAsserted") ceremonies.push(m.method.slice(9)); });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, userGesture: true, awaitPromise: true })).result?.value;
const results = {};
// xrdp's own record of logins: the count of "logged in" lines for the test user
const logins = () => execFileSync("docker", ["exec", "grd-wasm-xrdp-ci", "sh", "-c",
  "grep -c 'login status for test : logged in' /var/log/xrdp-sesman.log || true"]).toString().trim() | 0;
const check = (name, ok) => { results[name] = !!ok; console.log(ok ? "PASS" : "FAIL", name); };
const url = (process.env.PAGE || "http://localhost:8080/index.html") + "?v=127.0.0.1:6081&u=test&extra=/gfx&fs=0";
const session = async () => { await sleep(15000); return ev("JSON.stringify({ session: document.body.classList.contains('session'), status: document.getElementById('status').textContent, bar: !saveBar.hidden, text: saveText.textContent })"); };

await send("Runtime.enable");
await send("WebAuthn.enable", { enableUI: false });
const auth = await send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal",
  hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true } });
console.log("virtual authenticator:", JSON.stringify(auth));

// 1. typed password: the offer, then Save
await send("Page.navigate", { url });
await connectTestSession(send).catch(e => { chrome.kill(); throw e; });
let s = JSON.parse(await session()); console.log("connected with a typed password:", JSON.stringify(s));
check("the offer appears after connecting with a typed password", s.bar && /Save the password/.test(s.text));
await ev("saveYes.click(), 1"); await sleep(3000);
s = JSON.parse(await ev("JSON.stringify({ text: saveText.textContent, host: FreeRDPHostsUI.current() })"));
console.log("after Save:", s.text, "| ceremonies:", ceremonies.join(", "));
check("Save keeps the password in the vault", /Saved in the passkey vault/.test(s.text) && s.host.vault && s.host.vaultSaved);
console.log("passkey prompts to create the vault and save:", ceremonies.length);

// 2. reload (Disconnect does that), then Connect with an empty password: the vault unlocks it
ceremonies.length = 0; logs = []; const before = logins();
await send("Page.navigate", { url });
await connectTestSession(send, { password: "" }).catch(e => { chrome.kill(); throw e; });
s = JSON.parse(await session()); console.log("connected from the vault:", JSON.stringify(s), "| ceremonies:", ceremonies.join(", "));
check("Connect with the saved password unlocks the vault once and connects", s.session && ceremonies.length === 1 && !/failed|exited/.test(s.status));
check("no offer when the password came from the vault", !s.bar);
const after = logins();
check("xrdp logged the user in with the password from the vault", after === before + 1);
if (after !== before + 1) console.log(`xrdp's logins: ${before} before, ${after} after`);
const login = logs.filter((l) => /ERRCONNECT|logon|LOGON|failed/i.test(l));
check("no logon error in the client log", !login.length); if (login.length) console.log(login.join("\n"));

// 3. Never for this host
await send("Page.navigate", { url });
await connectTestSession(send, { password: "test" }).catch(e => { chrome.kill(); throw e; });
s = JSON.parse(await session());
check("a typed password that replaces a saved one offers an update", s.bar && /Update the saved password/.test(s.text));
await ev("saveNever.click(), 1"); await sleep(500);
await send("Page.navigate", { url });
await connectTestSession(send, { password: "test" }).catch(e => { chrome.kill(); throw e; });
s = JSON.parse(await session());
check("after Never for this host, no offer", !s.bar);

ws.close(); chrome.kill();
process.exit(Object.values(results).every(Boolean) ? 0 : 1);
