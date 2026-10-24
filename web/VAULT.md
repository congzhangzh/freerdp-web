# The passkey vault

Each saved host keeps its password where you choose. By default that is your browser's
password manager, which fills the form's password field. A host can instead keep its
password in the **passkey vault**: encrypted in this browser and unlocked with any of the
vault's passkeys (this device's, a phone's, a security key…) or, without one, its recovery code.
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

### Several passkeys, and a recovery code

A vault opens with any of its keys. **Advanced** lists them once the vault is unlocked, with
the date each was added and which one opened it now:

- **Add a passkey** (give it a name: *Phone*, *Windows Hello*…) makes another passkey for the
  same vault. The system's dialog chooses where: this device (Windows Hello, Touch ID, Google
  Password Manager in Chrome, iCloud Keychain in Safari), *Use a phone or tablet* (the phone
  keeps it, Android or iPhone), or a security key. A provider that already holds one of the
  vault's passkeys is refused, so two keys of one vault never sit in one place. The passkey
  needs PRF, like the first; one that lacks it is refused and nothing changes.
- **Connect** and **Unlock with passkey** show the system's chooser with every passkey of the
  vault: pick any. They share the vault's PRF salt, so one prompt is enough with every
  provider, also those that do not support PRF per credential.
- **Create a recovery code** shows a code of 28 letters and digits, once
  (`ABCD-EFGH-…`, without 0, O, 1 or I; about 140 random bits). Keep it on paper or in a
  password manager. **Unlock with the recovery code** appears while the vault is locked and
  opens it without any passkey; then add a passkey you have now. **Replace the recovery
  code** makes a new one, and the old one stops opening the vault.
- **Remove** (click twice) drops a key. A vault keeps at least one passkey; to start over
  without any, delete the vault.

So a new phone is one step: unlock with a passkey you have (or the code), then **Add a
passkey** on the new phone. A lost passkey: unlock with another key, **Remove** the lost one,
and change the passwords that matter (see *Limits*).

Only the vault's own keys open it. A passkey's PRF output is a secret its provider never
hands out, and each passkey has its own; a passkey that is not one of the vault's keys does
not open it, even with the same name. A synced copy of a key does (for example a Google
Password Manager passkey on an Android phone signed in to the same account). With no key at
all (every passkey gone, no recovery code), **Delete the vault** (two clicks) starts over:
the hosts stay, their saved passwords go; create a new vault and type the passwords again.

Moving the vault to another browser or origin is still **Export…** with the passwords,
encrypted with a passphrase, then **Import…** there (*Export* below).

Hosts saved in the vault by earlier versions of the page, with their own list of names,
become hosts of the host bar the first time the vault is unlocked.

## Encryption and storage

WebAuthn creation requires a resident passkey with user verification and PRF enabled. A separate verified assertion evaluates the vault's random 32-byte PRF salt; browsers need not evaluate PRF during creation (when they do, with user verification, that value is used and the second prompt is skipped). HKDF-SHA-256 derives a wrapping key from that result. AES-256-GCM encrypts the entire collection, including names, addresses, users and the keys' names, with an independent random data key, using separate authenticated contexts and random 96-bit nonces.

Every key wraps that same data key (envelope encryption, like the key slots of disk encryption):

| Key | Wrapping key | Stored for it |
|---|---|---|
| Passkey | HKDF-SHA-256 of its PRF output for the vault's salt | credential identifier, wrapped data key |
| Recovery code | PBKDF2-SHA-256 of the code, 600,000 iterations, its own 16-byte salt | salt, iteration count, wrapped data key |

The IndexedDB record (format version 2) contains only its format version, revision token, the PRF salt, the list of keys above and the ciphertext. Credential identifiers and salts are public encryption metadata; the keys' names and dates are inside the ciphertext. While the vault is unlocked the page keeps the wrapping key that opened it (a non-extractable `CryptoKey`), so adding a passkey or a recovery code wraps the data key again without another prompt. A version 1 record (one passkey, written by earlier versions of the page) opens as a version 2 record with that one key, and is written as version 2 at its next change. No RDP secret is sent to an authentication backend.

The unlocked data key is a nonextractable `CryptoKey`. Every change persists a new encrypted snapshot; IndexedDB compares revision tokens within the write transaction so two tabs cannot silently overwrite each other's edits. Unsupported PRF, absent user verification, a wrong credential, decryption failure or storage failure aborts the operation. A failed PRF registration may leave an unused passkey in the operating system; remove it there if desired.

The host bar's list (names, addresses, users, settings) lives in localStorage and never holds a password (`hosts.js`). Password query parameters are ignored and removed from the displayed URL; do not send passwords in URLs, since an initial request can already be retained by a server or browser history. Password arguments are masked in page logs, and the connection bridge clears its temporary argument array after handing it to WebAssembly.

## Reconnect

A session that drops comes back without a passkey prompt: the page keeps the password it
connected with (from the vault or the form) in memory, encrypted under a non-extractable
`CryptoKey`, and gives it to the next client in the same page. Never in storage; Disconnect,
another host, a refused logon or closing the page drop it. See *Reconnect* in
[`docs/webui-design.md`](../docs/webui-design.md).

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

Removing a key deletes its wrapped copy of the data key; the data key itself stays (a new one would need every remaining passkey's prompt). A copy of the record taken before the removal, together with the removed passkey or code, still opens the passwords of that time: after losing a passkey or a code, change the passwords that matter. The vault protects stored credentials, not a compromised origin: JavaScript executing on this origin can access credentials while unlocked. User verification and PRF are local key-release checks, not server-side WebAuthn signature verification. The same origin and passkey are required to unlock; clearing browser storage loses the vault unless the hosts were exported with their passwords. JavaScript strings and garbage collection do not permit guaranteed memory erasure. FreeRDP necessarily retains session credentials in WASM memory while a session runs; locking the local vault does not revoke the active RDP session.

## Verification

`node --test web/tests/*.test.cjs` (Node 20 or newer) runs the vault's crypto and state tests with real Web Crypto and simulated authenticators (encrypted metadata, multiple entries, updates and deletion, wrong keys, tampering, fail-closed PRF checks, lock cancellation, concurrent writes, deleting a vault whose passkey is gone; a second passkey from another provider, a provider that already holds one refused, removing a key, the recovery code and its replacement, reading a version 1 record), and the host list's tests (no password in storage, migration, export and import, encrypted with a passphrase or not).

`node test-page.mjs <client dir>` runs the page with the built client in Chrome, with a virtual CTAP2 authenticator with PRF (`WebAuthn.addVirtualAuthenticator`; the page still calls `navigator.credentials.create/get`). It saves a host's password, checks that the IndexedDB record holds no password, user or address, reloads, and checks that Connect unlocks the vault and gives the client exactly that password. It adds a second passkey on a second virtual authenticator and a recovery code, checks that the record lists three keys and no names, removes the first authenticator and unlocks with the second, removes that one too and unlocks with the recovery code. It then removes every passkey and checks that **Delete the vault** asks twice, deletes the record and lets a new passkey create a new vault. Only synthetic credentials are used. `test-vault-save.mjs` runs the offer against the CI xrdp session with the same virtual authenticator: a typed password is offered, Save creates the vault with a single passkey ceremony, a reload then connects with the saved password (one ceremony, and xrdp's log records the login), a different typed password is offered as an update, and Never for this host stops the offer. This verifies the browser and application integration, not a physical authenticator, a biometric prompt, a system passkey provider or the installed app's origin; those remain manual checks. The client still connects with `/cert:ignore`, so none of this establishes the RDP server's identity.

## Rebuild and reproduce locally

The page needs a FreeRDP tree with the Emscripten client (the open upstream pull requests #13728, #13731, #13732 and #13733) and a prefix with the WASM builds of its dependencies. Build output goes to `cache-vault/` and `dist/`; browser test profiles to `.chrome/`; evidence to `out/`.

```sh
docker build -t freerdp-wasm-vault-toolchain -f Dockerfile.wasm-vault .
WASM_DEPS=<dependency prefix> bash build-wasm-vault.sh <FreeRDP source dir>
python3 serve.py 8180 dist
```

The build script reads the dependency prefix (`WASM_DEPS`) without changing it. The toolchain image pins the tested Emscripten image digest and adds Ninja plus ccache. Force a new CMake configuration with `WASM_RECONFIGURE=1` after changing configuration flags. The output records its source HEAD in `dist/SOURCE_COMMIT` and any tracked uncommitted changes in `dist/SOURCE_CHANGES.patch`.

Open **http://localhost:8180** consistently for your own passkey test: the encrypted store belongs to that origin, and changing hostname or port changes storage. Do not enable a virtual authenticator when checking your own provider.
