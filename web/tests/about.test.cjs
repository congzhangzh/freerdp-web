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
    Decoders: "AV1: WebCodecs (browser), dav1d 1.5.4 as fallback, in this page · H.264: WebCodecs (browser) · Opus 1.6.1",
    Libraries: "zlib 1.3.2", Built: "2026-10-27, Emscripten 6.0.12",
    Page: "this checkout, abc123, with uncommitted changes", Overrides: "freerdp from a local directory", "Release kit": "20261028.2"});
});
test("About without MANIFEST or RELEASE (a local build): only what the page knows", () => {
  assert.deepEqual(A.rows({}), [["Version", "–"], ["Engine", "–"],
    ["Decoders", "AV1: WebCodecs (browser), dav1d as fallback, in this page · H.264: WebCodecs (browser)"]]);
  assert.deepEqual(A.parseManifest("<html>not a manifest</html>"), {sources: {}, overrides: []});
});
