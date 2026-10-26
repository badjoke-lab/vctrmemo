# Offline recovery with an encrypted file

Experimental **browser-only** vctrmemo workspace (`/rc/synced/#k=...`). This is **not** the Vector WebXDC app, automatic cloud backup, or the existing plaintext JSON export.

## Save a recovery file (while the original device still works)

1. Open the private workspace on the Mac or phone. Keep its **complete `#k=` URL** in your own private Notes.
2. Expand **本人の端末間同期**.
3. Click **暗号化バックアップをファイル保存**. Save the resulting `vctrmemo-encrypted-YYYY-MM-DD.vctrmemo` file on a drive you control.
4. Store the file and the private URL **in separate secure places**. The file by itself has no embedded decryption key. Anyone with both can read your notes and edit this shared workspace.
5. Continue keeping the manual JSON backup independently. No third-party relay guarantees retention.

The encrypted file contains the **complete causal operation history** (pages, blocks, deleted records and unresolved conflict versions). It does not copy the old device identity, workspace encryption key, or relay delivery metadata. No file content is uploaded during this operation.

## Restore when the original device is offline, lost or retired

1. On the replacement device, open the **exact same private URL** (same `#k=`).
2. Open the sync panel. **You do not need to connect to Nostr**, and you may press **同期を停止** while restoring.
3. Click **暗号化バックアップから復元** and choose the stored `.vctrmemo` file.
4. The app checks AES-256-GCM authentication, the SHA-256 plaintext digest, every operation ID and causal predecessor. It previews the operation count and asks for confirmation.
5. All new operations are applied through the existing editor's single writer. Existing notes are merged rather than replaced; the old actor identity is not copied. On repeat import, already-present operations are ignored.
6. After confirming the pages, you can resume network sync if desired.

A wrong private URL/key, damaged file, incomplete history, conflicting operation ID, or a combined history above 12,000 operations must be **rejected before writing anything**. If the file is missing or the key is lost, neither Nostr nor this recovery file can restore the notes.

## Security limits

- Crypto: HKDF-SHA256 from the secret stored only in the URL fragment, a distinct backup-specific derivation domain, AES-256-GCM with a random 96-bit nonce and authenticated context; SHA-256 of the plaintext also checked. A backup never includes its decryption key.
- Hard limit: 8 MiB of plaintext full history and 12,000 causal operations; this is a limited initial recovery format, not unlimited storage.
- Editing the same field offline on multiple devices can still create MV-register conflicts. Recovery preserves conflicting versions rather than silently choosing one.
- A `.vctrmemo` file must be deliberately saved and moved or stored by the owner. This does **not** provide automatic off-device backup, restore without the key, device revocation, or key rotation.
- If the original workspace is already broken, the app's safe-stop raw JSON export is a separate emergency workflow.

## Tests

- `owner-sync/tests/portable-backup.test.mjs`: encrypted roundtrip, wrong key, tampering, multiple causal operations, conflicts, incomplete history, capacity limits.
- `tests/test-portable-browser.py`: browser-to-browser transfer using real file download and upload, **all external WebSocket connections blocked**, separate browser storage profiles, full project comparison and invalid-file rejection.
- Existing snapshot and two-browser public relay tests remain independent and must continue passing.

Never commit a real user backup or a `#k=` secret to this repository or CI.
