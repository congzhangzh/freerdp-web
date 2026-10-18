# Local saved-host vault

The FreeRDP web client can keep several host profiles behind one passkey. Open the client on a secure origin (HTTPS or localhost; passkey support inside the isolated web app still needs verification), choose **Create vault**, and complete the authenticator prompts. Fill in a host, username, password, optional name and connection options, then choose **Save host**. Use **New host** to add another profile. After reloading, unlock the vault and select a host before connecting.

Selecting a saved host displays its metadata and leaves the password field empty. **Connect** uses that host’s stored password directly. To update a profile, edit its fields and save before connecting; a blank password keeps its existing password, while a nonempty password replaces it. **Delete host** removes the selected encrypted profile. **Lock** clears decrypted profiles and form fields, and cancels a pending authenticator operation. Reloading is required for another RDP session because the current Emscripten runtime invokes `callMain` once.

## Encryption and storage

WebAuthn creation requires a resident passkey with user verification and PRF enabled. A separate verified assertion evaluates a random 32-byte PRF salt; browsers need not evaluate PRF during creation. HKDF-SHA-256 derives a wrapping key from that result. AES-256-GCM wraps an independent random data key and encrypts the entire profile collection, including names and addresses, using separate authenticated contexts and random 96-bit nonces. The IndexedDB record contains only its format version, revision token, credential identifier, PRF salt, wrapped key and ciphertext. The passkey identifier and salt are public encryption metadata. No RDP secret is sent to an authentication backend.

The unlocked data key is a nonextractable `CryptoKey`. Host mutations persist a new encrypted snapshot; IndexedDB compares revision tokens within the write transaction so two tabs cannot silently overwrite each other’s edits. Unsupported PRF, absent user verification, a wrong credential, decryption failure or storage failure aborts the operation. A failed PRF registration may leave an unused passkey in the operating system; remove it there if desired.

The manual connection form still remembers ordinary connection settings in localStorage. Saved-vault connections skip that setting persistence. Password query parameters are ignored and removed from the displayed URL; do not send passwords in URLs, since an initial request can already be retained by a server or browser history. Password arguments are masked in page logs, and the connection bridge clears its temporary argument array after handing it to WebAssembly.

## Limits and verification

The vault protects stored credentials, not a compromised origin: JavaScript executing on this origin can access credentials while unlocked. User verification and PRF are local key-release checks, not server-side WebAuthn signature verification. The same origin and passkey are required to unlock; clearing browser storage loses the vault, and no recovery/export mechanism is provided. JavaScript strings and garbage collection do not permit guaranteed memory erasure. FreeRDP necessarily retains session credentials in WASM memory while a session runs; locking the local vault does not revoke the active RDP session.

Run `node --test web/tests/*.test.cjs` (individual test detail is also available with `node web/tests/vault.test.cjs` and `node web/tests/bridge.test.cjs`) using Node 20 or newer. These tests use real Web Crypto for HKDF and AES-GCM, and a simulated authenticator for PRF. They cover encrypted metadata, multiple hosts, updates/deletion, wrong keys, tampering, fail-closed PRF checks, lock cancellation and concurrent writes. The browser integration test also runs the actual WebAuthn API against a Chrome virtual CTAP2 authenticator with PRF enabled, saves two hosts, reloads/unlocks, and logs into the local CI RDP server using a saved password. It waits for received RDP graphics commands and captures the displayed remote desktop. This verifies the browser/application integration, not a physical authenticator, biometric prompt, system passkey provider or isolated-app origin. Physical-provider PRF support remains a separate manual check.

## Rebuild and reproduce locally

The page needs a FreeRDP tree with the Emscripten client (the open upstream pull requests #13728, #13731, #13732 and #13733) and a prefix with the WASM builds of its dependencies. Build output goes to `cache-vault/` and `dist/`; browser test profiles to `.chrome/`; evidence to `out/`.

From this repository:

```sh
docker build -t freerdp-wasm-vault-toolchain -f Dockerfile.wasm-vault .
WASM_DEPS=<dependency prefix> bash build-wasm-vault.sh <FreeRDP source dir>
python3 serve.py 8180 dist
```

The build script reads the dependency prefix (`WASM_DEPS`) without changing it. The toolchain image pins the tested Emscripten image digest and adds Ninja plus ccache. Force a new CMake configuration with `WASM_RECONFIGURE=1` after changing configuration flags. Normal incremental runs reuse the configuration. The output records its source HEAD in `dist/SOURCE_COMMIT` and any tracked uncommitted changes in `dist/SOURCE_CHANGES.patch`. (FreeRDP's `bulk_free` clashed with the Emscripten allocator's symbol; upstream renamed it to `freerdp_bulk_free`.)

Open **http://localhost:8180** consistently for your own passkey test. The encrypted store belongs to that origin; changing hostname or port changes storage. Do not enable a virtual authenticator when checking your own provider.

For the automated browser test, start the dedicated `grd-wasm-xrdp-ci` server and a local websockify listener at `127.0.0.1:6081` forwarding to `127.0.0.1:13390`, then run:

```sh
node test-vault-browser.mjs
```

This test launches a fresh isolated Chrome profile and configures `WebAuthn.addVirtualAuthenticator` through DevTools Protocol with `hasPrf: true`, `isUserVerified: true`, and `automaticPresenceSimulation: true`. User verification/presence are deliberately simulated. The application still calls `navigator.credentials.create/get`; the test does not replace those JavaScript functions. Only synthetic RDP credentials are used. Reloading within that browser retains the virtual authenticator; the test closes the browser afterwards. Its encrypted test database belongs to its separate profile.

Verified on 2026-10-14: eight crypto/state tests, seven application bridge tests, and the browser integration test passed. The cold WASM build took 115 seconds; the symbol-fix incremental build took 40 seconds. A single-object repeat produced one direct ccache hit out of one request. These measurements include different build work and are not a speed comparison. The final linker log has no `bulk_free` signature mismatch; it still reports the existing pthread/memory-growth performance warning.

Local screenshots: `out/vault-unlocked.png` and `out/vault-rdp-session.png`; browser log: `out/vault-browser.log`. The existing connection default includes `/cert:ignore`, so this verification does not establish remote-server certificate identity.
