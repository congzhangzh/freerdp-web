# The passkey vault

Each saved host keeps its password where you choose. By default that is your browser's
password manager, which fills the form's password field. A host can instead keep its
password in the **passkey vault**: encrypted in this browser and unlocked with a passkey.
Open the client on a secure origin (HTTPS or localhost); passkey support inside the
installed app (Isolated Web App) still needs checking with a real authenticator.

## Using it

The quick way, as on a phone: **connect with the password typed in the form**. Once the client
is past the connection sequence (with NLA, the server has accepted the password), the page asks
*Save the password of "host"?*:

- **Save with passkey** keeps it in the vault with one passkey prompt (Touch ID, Windows
  Hello, a security key…). The first time, that prompt also creates the vault: a passkey that
  evaluates the PRF while it is created needs no second prompt. The host's vault option is
  switched on.
- **Not now** (or no answer within 30 s) forgets the offer; the password was only held in the
  page's memory for it, at most two minutes.
- **Never for this host** stops asking for that host; switching its vault option on again in
  **Advanced** asks again.

A host whose saved password differs from the one typed gets *Update the saved password?*
instead. A connection that used the saved password gets no offer.

The same by hand:

1. Select the host, open **Advanced** and tick **Keep this host's password in the passkey
   vault**.
2. The first time, choose **Create vault** and complete the passkey prompt.
3. Type the password in the form and choose **Save the password**. The field is cleared;
   it now reads *Kept in the vault: leave empty*.
4. **Connect** asks for the passkey (once per page) and hands that password to the client.
   A password typed in the field wins over the saved one, for that connection only.

**Save the password** again replaces it; **Forget the saved password** removes it; deleting
the host removes it too. Switching the option off keeps the encrypted password until you
forget it. **Lock** clears the decrypted data from the page and cancels a pending passkey
prompt; the page also locks after a connection and when it closes. One page runs one RDP
session (the runtime's `callMain` runs once): reload it for the next.

Hosts saved in the vault by earlier versions of the page, with their own list of names,
become hosts of the host bar the first time the vault is unlocked.

## Encryption and storage

WebAuthn creation requires a resident passkey with user verification and PRF enabled. A separate verified assertion evaluates a random 32-byte PRF salt; browsers need not evaluate PRF during creation. HKDF-SHA-256 derives a wrapping key from that result. AES-256-GCM wraps an independent random data key and encrypts the entire collection, including names, addresses and users, using separate authenticated contexts and random 96-bit nonces. The IndexedDB record contains only its format version, revision token, credential identifier, PRF salt, wrapped key and ciphertext. The passkey identifier and salt are public encryption metadata. No RDP secret is sent to an authentication backend.

The unlocked data key is a nonextractable `CryptoKey`. Every change persists a new encrypted snapshot; IndexedDB compares revision tokens within the write transaction so two tabs cannot silently overwrite each other's edits. Unsupported PRF, absent user verification, a wrong credential, decryption failure or storage failure aborts the operation. A failed PRF registration may leave an unused passkey in the operating system; remove it there if desired.

The host bar's list (names, addresses, users, settings) lives in localStorage and never holds a password (`hosts.js`). Password query parameters are ignored and removed from the displayed URL; do not send passwords in URLs, since an initial request can already be retained by a server or browser history. Password arguments are masked in page logs, and the connection bridge clears its temporary argument array after handing it to WebAssembly.

## Export

**Export…** writes the hosts to a file. **Include the passwords kept in the passkey vault**
adds those passwords (after a passkey prompt); passwords in the browser's password manager
cannot be read by a web page, and the browser exports them itself. **Encrypt the file with a
passphrase** protects the whole file: PBKDF2-SHA-256 with 600,000 iterations and a random
salt derives an AES-256-GCM key. Without encryption, a file with passwords is readable by
anyone who gets it, and the dialog says so. **Import…** asks for the passphrase when the
file is encrypted, adds the hosts under new names when the names are taken, and puts the
file's passwords into the vault (create or unlock it first; otherwise they are dropped, and
the page says so).

## Limits

The vault protects stored credentials, not a compromised origin: JavaScript executing on this origin can access credentials while unlocked. User verification and PRF are local key-release checks, not server-side WebAuthn signature verification. The same origin and passkey are required to unlock; clearing browser storage loses the vault unless the hosts were exported with their passwords. JavaScript strings and garbage collection do not permit guaranteed memory erasure. FreeRDP necessarily retains session credentials in WASM memory while a session runs; locking the local vault does not revoke the active RDP session.

## Verification

`node --test web/tests/*.test.cjs` (Node 20 or newer) runs the vault's crypto and state tests with real Web Crypto and a simulated authenticator (encrypted metadata, multiple entries, updates and deletion, wrong keys, tampering, fail-closed PRF checks, lock cancellation, concurrent writes), and the host list's tests (no password in storage, migration, export and import, encrypted with a passphrase or not).

`node test-page.mjs <client dir>` runs the page with the built client in Chrome, with a virtual CTAP2 authenticator with PRF (`WebAuthn.addVirtualAuthenticator`; the page still calls `navigator.credentials.create/get`). It saves a host's password, checks that the IndexedDB record holds no password, user or address, reloads, and checks that Connect unlocks the vault and gives the client exactly that password. Only synthetic credentials are used. `test-vault-save.mjs` runs the offer against the CI xrdp session with the same virtual authenticator: a typed password is offered, Save creates the vault with a single passkey ceremony, a reload then connects with the saved password (one ceremony, and xrdp's log records the login), a different typed password is offered as an update, and Never for this host stops the offer. This verifies the browser and application integration, not a physical authenticator, a biometric prompt, a system passkey provider or the installed app's origin; those remain manual checks. The client still connects with `/cert:ignore`, so none of this establishes the RDP server's identity.

## Rebuild and reproduce locally

The page needs a FreeRDP tree with the Emscripten client (the open upstream pull requests #13728, #13731, #13732 and #13733) and a prefix with the WASM builds of its dependencies. Build output goes to `cache-vault/` and `dist/`; browser test profiles to `.chrome/`; evidence to `out/`.

```sh
docker build -t freerdp-wasm-vault-toolchain -f Dockerfile.wasm-vault .
WASM_DEPS=<dependency prefix> bash build-wasm-vault.sh <FreeRDP source dir>
python3 serve.py 8180 dist
```

The build script reads the dependency prefix (`WASM_DEPS`) without changing it. The toolchain image pins the tested Emscripten image digest and adds Ninja plus ccache. Force a new CMake configuration with `WASM_RECONFIGURE=1` after changing configuration flags. The output records its source HEAD in `dist/SOURCE_COMMIT` and any tracked uncommitted changes in `dist/SOURCE_CHANGES.patch`.

Open **http://localhost:8180** consistently for your own passkey test: the encrypted store belongs to that origin, and changing hostname or port changes storage. Do not enable a virtual authenticator when checking your own provider.
