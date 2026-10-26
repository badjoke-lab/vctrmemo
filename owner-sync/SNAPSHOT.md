# Browser-only encrypted owner snapshot (experimental)

This is an additional recovery path for the isolated `/rc/synced/#k=...` browser workspace, **not** Vector account sync, a permanent cloud backup, or a migration of legacy `vctrmemo-v2` notes.

## What is stored

- The complete v2 causal operation history (`sync.ops`), including deletes and unresolved field conflicts. The original per-device actor and counter are **not** copied to another device.
- The history is UTF-8 JSON cut into 6,000-byte pieces. SHA-256 of the **complete original bytes** is the snapshot identifier, and every part carries that ID, its index, and its total count.
- Each part is wrapped in the existing secret-derived AES-256-GCM and signed Nostr event. The public relay cannot read the plaintext, but knows the pseudonymous event author, publication times and approximate sizes.
- A receiver buffers at most 3 unfinished snapshots, checks count, byte bounds, digest, every operation and **every predecessor ID** before proposing a merge through `vctrmemo-owner-apply`.
- Parts cannot safely be applied independently. Any omitted, altered, wrong-key, malformed, duplicated-ID or causally incomplete history must not replace local content.

## Visible behavior

1. Mac and smartphone open the **same private** `/rc/synced/#k=...` URL; never share the full link publicly.
2. The owner-sync panel includes **「復旧用の暗号化スナップショットを保存」**. Pressing it sends a full encrypted snapshot to the public Nostr relays, in parts. A completion message means relay acceptance, **not guaranteed permanent retention**.
3. The browser may also publish an updated snapshot at least 90 seconds after connection, with at least one real edit, and later when at least 50 new operations have accumulated and 30 minutes have elapsed. Failed automatic attempts wait at least five minutes before retrying.
4. A fresh/reconnected browser announces itself. An online existing peer can send its recent edits and a complete snapshot, rate-limited to avoid re-sending on every relay packet.
5. Incoming valid snapshots **merge** into the existing workspace; they never replace its storage wholesale. Active Japanese IME composition delays application until conversion ends.
6. Existing manual **JSON エクスポート** remains the independent, local recovery copy. Keep it even after an encrypted snapshot succeeds.

## Hard limits and exclusions

- 4 MiB maximum unencrypted snapshot; up to 700 parts of 6,000 bytes each; 12,000 valid causal operations in the engine. A larger workspace needs compaction plus a checkpoint design and is **not supported** by this feature.
- A relay can refuse, rate-limit, or delete events or return incomplete history; a full multipart snapshot **cannot be recovered** if even one part is missing and no other peer can resend it.
- Automatic snapshots are best effort while a device is online and not paused. Do not claim guaranteed cross-device restoration without a full receive/merge confirmation.
- Same-paragraph concurrent editing remains MV-register conflict management, not a character-level CRDT. A valid snapshot retains the competing versions; it does not silently resolve them.
- Device revocation, key rotation, durable external backup storage, and genuine Vector WebXDC integration are separate incomplete milestones.

## Verification

- `owner-sync/tests/snapshot.test.mjs`: signed-key encryption, multipart random order, missing/tampered parts, duplicate and missing causal parents.
- `owner-sync/tests/snapshot-relay.test.mjs`: new device with **no old operation events**, restoring 125 previous text changes via encrypted relay packets delivered with loss/reordering.
- Existing `owner-sync/tests/browser-live.py`: public relay A⇄B, pause/reconnect and focused-editor regression. It does not by itself guarantee retention of snapshots across relay downtime.
- `tests/test-restore-browser.py`: isolated local JSON import/export atomicity, independent of Nostr.
