# Experimental owner-only encrypted sync (browser preview)

**Status: PROTOTYPE. Not merged. Not available inside Vector Mini Apps. Not signed in with the Vector account.**

This implements a genuinely different transport from WebXDC's chat-wide updates: two ordinary browser pages can use a shared 256-bit pairing key to publish and read encrypted individual vctrmemo operations on public Nostr relays. It does **not** require a second Vector user. It does **not** verify ownership of a Vector identity: possession of the pairing key grants full access.

## Flow

1. Open the browser-only vctrmemo preview over HTTPS.
2. In the bottom-right **本人の端末間同期（ブラウザ実験版）**, generate a new 64-character pairing secret.
3. Back up your local vctrmemo JSON data before enabling experimental sync.
4. Copy the secret to your own other device through a secure channel. Never post it to a chat or URL.
5. Select **同期開始** and explicitly approve encrypted relay publishing.
6. On your second browser, enter the same secret and select **同期開始**.
7. Leave each app running with internet access to watch for encrypted changes. The current UI polls the local operation log and publishes pending operations. Remote operations merge into the local causal history and reload the preview when it is safe to do so.

## Privacy and security boundaries

- **E2EE:** HKDF-SHA256 derives AES-256-GCM for individual operations; random 96-bit IV. Nostr events are Schnorr-signed using the pairing key; incoming event signatures and author are checked and ciphertext is authenticated before merge.
- Relays can see event timestamps, sizes, event counts and a pseudonymous public key. They cannot read the page content without the secret.
- **Device registration is only via shared possession of the secret.** There is no Vector user identity authentication, no device-specific revocation, no key rotation and no secure hardware storage. The secret is stored unencrypted in this browser origin's localStorage to enable reconnect; other code running on that origin could potentially access it.
- The prototype uses publicly operated relays which may refuse connections, rate limit, delete data, or become unavailable. Two relay endpoints are initial best-effort defaults, **not an availability SLA**.
- The Nostr initial-history query is limited (5,000 events per relay, subject to relay limits), making this unsuitable for large workspaces without checkpoint/snapshot and range repair.
- Concurrent independent edits are merged with the existing vctrmemo field-level operation history; text character-level CRDT merging is **not** implemented.
- The Vector .xdc is **not changed** by this browser-only script. Vector's Mini App sandbox blocks direct external relay connections, so this does NOT complete Vector's own automatic 2-device sync.
- Previously stored local workspaces are not migrated or deleted; the original `vctrmemo-v2` key and JSON import/export are preserved.

## Observed results (2026-10-22)

- [Live relay protocol smoke run](https://github.com/badjoke-lab/vctrmemo/actions/runs/39645799064): real signed, encrypted test event published and decrypted by an independent relay client, passed.
- [Independent Chromium page-edit run](https://github.com/badjoke-lab/vctrmemo/actions/runs/39646283412): two separate browser storage contexts and public relays; created page on browser A, observed it on B, changed its title on B and observed the change on A, passed.
- A disconnect/reconnect catch-up test has been added; it is **not considered verified** until its own GitHub Actions run succeeds.
- No Vector Mini App device-to-device relay transport, account identity binding or physical Android-to-desktop proof yet.

## Build and tests

The GitHub Actions PR workflow installs a pinned version of `nostr-tools` and `esbuild`, executes encryption unit tests and two-instance relay **mock** tests, and bundles `dist/site/owner-sync.js` only in the browser preview. It also verifies that `dist/vctrmemo.xdc` contains no owner-sync script.

**No real Vector host sync, production relay availability or storage-key migration proof is claimed.** Before any stable release, third-party dependency security, key lifecycle, replay behavior, storage quotas, offline catchup and true two-device tests must be completed.
