const {test} = require("node:test");
const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {join} = require("node:path");
const S = require("../server.js");
// the sample the browser test (test-server.mjs) serves as install.json
const sample = JSON.parse(readFileSync(join(__dirname, "..", "..", "test-server-install.json"), "utf8"));

test("install.json: distributions grouped by the name's first word, in their order", () => {
  const k = S.parse(sample);
  assert.equal(k.release, "20261028.2");
  assert.deepEqual(k.families.map((f) => [f.name, f.id, f.servers.map((s) => s.name)]), [
    ["Debian", "server-debian", ["Debian 13"]],
    ["Ubuntu", "server-ubuntu", ["Ubuntu 26.04"]],
    ["Fedora", "server-fedora", ["Fedora 45", "Fedora 44"]]]);
  const debian = k.families[0].servers[0];
  assert.equal(debian.sessions, "Wayland: GNOME, KDE Plasma, sway; Xorg: the default session");
  assert.deepEqual(debian.more.map((m) => m.what), ["Xorg session"]);
  assert.deepEqual(k.families[2].servers[1].more, []);   // "more" absent
  assert.equal(k.start, "sudo systemctl enable --now xrdp");
});
test("install.json: an entry without a name or a command, a link that is not https, are skipped", () => {
  const k = S.parse(sample);
  assert.equal(k.families.flatMap((f) => f.servers).length, 4);
  assert.deepEqual(k.clients.map((c) => c.platform), ["Linux x86_64", "Windows x64"]);
  assert.equal(S.parse({...sample, url: "http://example.com/"}).url, S.LATEST);
});
test("install.json that has nothing to show is none: the page keeps its link to the latest release", () => {
  for (const bad of [null, "text", 42, [], {}, {server: "x"}, {server: []}, {server: [{name: "Debian 13"}]}])
    assert.equal(S.parse(bad), null, JSON.stringify(bad));
  const k = S.parse({server: [{name: "Debian 13", command: "sudo apt install ./xrdp.deb"}]});
  assert.deepEqual([k.release, k.url, k.start, k.clients], ["", S.LATEST, "", []]);
});
test("install.json's windows: the Windows host with an https link and a command, else none", () => {
  const k = S.parse(sample);
  assert.equal(k.windows.file, "freerdp-host-20261030.1-windows-x86_64.zip");
  assert.match(k.windows.command, /freerdp-shadow-service\.exe install/);
  assert.equal(k.windows.remove, ".\\freerdp-shadow-service.exe uninstall");
  for (const bad of [undefined, "x", {}, {command: "c", url: "http://example.com/x.zip"}, {url: "https://example.com/x.zip"}])
    assert.equal(S.parse({...sample, windows: bad}).windows, null, JSON.stringify(bad));
});
test("install.json's av2: the line that turns AV2 on in xrdp, when the packages have it", () => {
  assert.deepEqual(S.parse(sample).av2, sample.av2 ? {what: sample.av2.what, command: sample.av2.command} : null);
  const cmd = "sudo sed -i 's/^order = \\[ \"AV1\"/order = [ \"AV2\", \"AV1\"/' /etc/xrdp/gfx.toml && sudo systemctl restart xrdp";
  assert.deepEqual(S.parse({...sample, av2: {what: "AV2", command: cmd}}).av2, {what: "AV2", command: cmd});
  for (const bad of [undefined, "x", {}, {what: "AV2"}, {command: ""}])
    assert.equal(S.parse({...sample, av2: bad}).av2, null, JSON.stringify(bad));
});
test("demo.json's freerdp-tk videos: files in demo/ only, a title and a video each", () => {
  const demo = {videos: [{title: "the splash's", src: "demo/xrdp-gnome.mp4"}], clients: [
    {title: "xrdp + GNOME Wayland, AV1, freerdp-tk release", src: "demo/freerdp-tk-release.mp4",
     poster: "demo/freerdp-tk-release.jpg", caption: "Unpacked, started, saved."},
    {title: "elsewhere", src: "https://example.com/x.mp4"},
    {title: "up a folder", src: "demo/../x.mp4"},
    {title: "", src: "demo/untitled.mp4"},
    {title: "a bad poster", src: "demo/freerdp-tk-uvx.mp4", poster: "javascript:alert(1)"}]};
  assert.deepEqual(S.clips(demo), [
    {title: "xrdp + GNOME Wayland, AV1, freerdp-tk release", src: "demo/freerdp-tk-release.mp4",
     poster: "demo/freerdp-tk-release.jpg", caption: "Unpacked, started, saved."},
    {title: "a bad poster", src: "demo/freerdp-tk-uvx.mp4", poster: "", caption: ""}]);
  for (const none of [null, {}, {videos: []}, {clients: "x"}]) assert.deepEqual(S.clips(none), []);
  // the Windows host's videos: the same rules, under "windows"
  assert.deepEqual(S.clips({windows: [{title: "on Windows", src: "demo/windows-host.mp4"}, {title: "x", src: "https://e/x.mp4"}]}, "windows"),
    [{title: "on Windows", src: "demo/windows-host.mp4", poster: "", caption: ""}]);
  assert.deepEqual(S.clips({windows: [{title: "on Windows", src: "demo/windows-host.mp4"}]}), []);
  // and the Mac host's, under "mac"
  assert.deepEqual(S.clips({mac: [{title: "on a Mac", src: "demo/mac-host.mp4", poster: "demo/mac-host.jpg"}]}, "mac"),
    [{title: "on a Mac", src: "demo/mac-host.mp4", poster: "demo/mac-host.jpg", caption: ""}]);
});
test("install.json's mac: an entry per processor with an https link and a command; the restart command alone", () => {
  const k = S.parse(sample);
  assert.deepEqual(k.mac.map((m) => [m.platform, m.file]), [
    ["Apple Silicon", "freerdp-host-20261102.2-macos-arm64.zip"], ["Intel", "freerdp-host-20261102.2-macos-x86_64.zip"]]);
  assert.match(k.mac[0].command, /launchctl bootstrap gui\/\$\(id -u\)/);
  // the kit's "then" is a sentence that ends with the command; the page keeps the command
  assert.equal(k.mac[0].kickstart, "launchctl kickstart -k gui/$(id -u)/org.freerdp.shadow");
  assert.match(k.mac[0].remove, /^launchctl bootout /);
  const one = {platform: "Intel", file: "f.zip", url: "https://example.com/f.zip", command: "c"};
  assert.equal(S.parse({...sample, mac: [{...one, kickstart: "k", then: "Then run: x"}]}).mac[0].kickstart, "k");
  assert.equal(S.parse({...sample, mac: [{...one, then: "Then allow it."}]}).mac[0].kickstart, "");
  for (const bad of [undefined, "x", {}, [{...one, url: "http://example.com/f.zip"}], [{...one, command: ""}], [{...one, platform: ""}], [null]])
    assert.deepEqual(S.parse({...sample, mac: bad}).mac, [], JSON.stringify(bad));
});
