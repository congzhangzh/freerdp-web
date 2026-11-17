const {test} = require("node:test");
const assert = require("node:assert/strict");
const A = require("../about.js");
// a MANIFEST as the release kit writes it (build-wasm-client.sh), plus site.sh's line
const MANIFEST = `FreeRDP web client (preview), built 2026-10-27 with emcc (Emscripten gcc/clang-like replacement + linker emulating GNU ld) 6.0.12 (5488e0871d46d19a3209988190fa6a653126256f)
page: freerdp-web 77fc7eb3e8ca23ea73a064876dee61ab21b0a448

sources (sources.lock):
  freerdp          20261026.4 c12c6df85789c3757b24a76a74ed3f4978ffa667
  sdl3_wasm        3.4.18+timer 1d615c14f95a3389bf0026e719144ad51378e40c
  opus             1.6.1     6ffcb593207be92584df15b32466ed64bbec99109f007c82205f0194572411a1
  dav1d            1.5.4     686616b7c69eb88d44459391ab25cac13b6647a3b288835c5784e71c1514a5c5
  zlib             1.3.2     bb329a0a2cd0274d05519d61c667c062e06990d72e125ee2dfa8de64f0119d16
`;

test("MANIFEST: the build date, the compiler, the page's commit, each source (a git commit or a tarball's hash)", () => {
  const m = A.parseManifest(MANIFEST);
  assert.equal(m.built, "2026-10-27"); assert.equal(m.emscripten, "6.0.12");
  assert.equal(m.page, "77fc7eb3e8ca23ea73a064876dee61ab21b0a448");
  assert.deepEqual(m.sources.freerdp, {version: "20261026.4", commit: "c12c6df85789c3757b24a76a74ed3f4978ffa667"});
  assert.deepEqual(m.sources.dav1d, {version: "1.5.4", commit: ""});
  assert.deepEqual(Object.keys(m.sources), ["freerdp", "sdl3_wasm", "opus", "dav1d", "zlib"]);
  assert.deepEqual(m.overrides, []);
});
test("About: the version, the engine and the build, with the decoders the client has", () => {
  const rows = Object.fromEntries(A.rows({version: "20261028.1", engine: "JSPI", release: "20261028.2",
    manifest: A.parseManifest(MANIFEST + "\npage from site.sh: this checkout, abc123, with uncommitted changes\nOVERRIDE freerdp: local directory /x (not from sources.lock)\n")}));
  assert.deepEqual(rows, {
    Version: "FreeRDP Web 20261028.1", Engine: "JSPI",
    FreeRDP: "20261026.4 (commit c12c6df857)", SDL: "3.4.18+timer (commit 1d615c14f9)",
    "AV1 decoder": "WebCodecs (browser); fallback: dav1d 1.5.4 (in this page)",
    "H.264 decoder": "WebCodecs (browser)", "Audio decoder": "Opus 1.6.1",
    Libraries: "zlib 1.3.2", Built: "2026-10-27, Emscripten 6.0.12",
    Page: "this checkout, abc123, with uncommitted changes", Overrides: "freerdp from a local directory", "Release kit": "20261028.2"});
});
test("About: an AV2 decoder row only when the build has libavm", () => {
  const m = A.parseManifest(MANIFEST + "  avm              20261030.1 dc33252c968799c9a0053236f723a44e3c5460f3\n");
  const rows = Object.fromEntries(A.rows({manifest: m}));
  assert.equal(rows["AV2 decoder"], "libavm 20261030.1 (in this page)");
  assert.equal(rows.Libraries, "zlib 1.3.2");   // avm has its own row
  assert.equal(Object.fromEntries(A.rows({manifest: A.parseManifest(MANIFEST)}))["AV2 decoder"], undefined);
});
test("About without MANIFEST or RELEASE (a local build): only what the page knows", () => {
  assert.deepEqual(A.rows({}), [["Version", "–"], ["Engine", "–"],
    ["AV1 decoder", "WebCodecs (browser); fallback: dav1d (in this page)"], ["H.264 decoder", "WebCodecs (browser)"]]);
  assert.deepEqual(A.parseManifest("<html>not a manifest</html>"), {sources: {}, overrides: []});
});

// since kit e462e7c / 8129436 (2026-11-17): a kit line, a freerdp-upstream line, and each source's
// address as a fourth column (possibly none); the site gate stopped on it ("About names FreeRDP and
// SDL from the client's MANIFEST (undefined / undefined)")
const MANIFEST_2 = `FreeRDP web client (preview), built 2026-11-17 with emcc (Emscripten gcc/clang-like replacement + linker emulating GNU ld) 6.0.13 (e13ee988ce3d87a738dd8f3661d02223308c412a)
page: freerdp-web 41113cf07873a6100aa59eba490bf7e0f358c2af

kit: rdp-release-kit 8129436aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
freerdp-upstream: master 0123456789abcdef0123456789abcdef01234567 +213
sources (sources.lock):
  freerdp          20261117.1 5be282e0a95f2e5040c063b2fb2a6ba60c3075ed https://github.com/congzhangzh/FreeRDP
  sdl3_wasm        3.4.18+timer 1d615c14f95a3389bf0026e719144ad51378e40c https://github.com/congzhangzh/SDL
  dav1d            1.5.4     686616b7c69eb88d44459391ab25cac13b6647a3b288835c5784e71c1514a5c5 https://downloads.videolan.org/pub/videolan/dav1d/1.5.4/dav1d-1.5.4.tar.xz
  zlib             1.3.2     bb329a0a2cd0274d05519d61c667c062e06990d72e125ee2dfa8de64f0119d16 
`;
test("MANIFEST since 2026-11-17: the kit and upstream lines, the sources with their address, and About still names FreeRDP and SDL", () => {
  const m = A.parseManifest(MANIFEST_2);
  assert.equal(m.kit, "8129436aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.deepEqual(m.upstream, {branch: "master", commit: "0123456789abcdef0123456789abcdef01234567", ahead: 213});
  assert.deepEqual(m.sources.freerdp, {version: "20261117.1", commit: "5be282e0a95f2e5040c063b2fb2a6ba60c3075ed", url: "https://github.com/congzhangzh/FreeRDP"});
  assert.deepEqual(m.sources.zlib, {version: "1.3.2", commit: ""});   // an empty address: none
  assert.deepEqual(Object.keys(m.sources), ["freerdp", "sdl3_wasm", "dav1d", "zlib"]);
  const rows = Object.fromEntries(A.rows({version: "20261117.2", engine: "JSPI", manifest: m}));
  assert.equal(rows.FreeRDP, "20261117.1 (commit 5be282e0a9)");
  assert.equal(rows.SDL, "3.4.18+timer (commit 1d615c14f9)");
});
