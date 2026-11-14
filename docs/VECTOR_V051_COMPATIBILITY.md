# vctrmemo × Vector v0.5.1 — verified compatibility and next implementation gates

Verified 2026-11-14 against the **VectorPrivacy/Vector v0.5.1 tag**, not an assumed older Vector version.

## Terminology

- Vector **client version**: v0.5.1 (released 2026-11-07); v0.5.0 Vigil added Vector Web, widescreen, roles/channels, voice/video, and a WebXDC-capable browser client.
- Bundled **Rust Vector SDK** in the **v0.5.1 tag**: `crates/vector-sdk/Cargo.toml` says **0.11.0**. The development `master` can have a newer 0.12.0 manifest. It is a Rust bot/backend SDK, **not** a replacement for the Mini App's JavaScript `window.webxdc` API. Do not conflate client/SDK version numbers.
- A **Mini App** is one shared `.xdc` message instance inside one Vector chat/Community channel. Sending the same package again creates a distinct instance.

## Observed host behavior in v0.5.1

| Surface | Source-confirmed behavior | Consequence for vctrmemo |
| --- | --- | --- |
| `window.webxdc.joinRealtimeChannel()` | Available to a shared .xdc instance; up to 128,000 bytes per payload, current participants only, loss is possible; peer direct IP exposure is possible | Appropriate for **synthetic diagnosis** and future explicitly shared ephemeral work, **not** durable personal notes |
| `webxdc.sendUpdate` / `setUpdateListener` | Updates are device-local, not shared with other participants; host `miniapp_get_updates` remains a stub | vctrmemo's older app logic cannot become automatic multi-device sync by merely upgrading Vector |
| Same-account Notes/self-DM Mini App | `get_active_peer_advertisements_in` filters `npub != ?2` (own npub), aggregates by `npub`, and peer departure/currentness are also keyed by account identity | Same-owner two-device discovery is **not verified** and has a concrete source-code blocker; never claim support based solely on a mock-host test |
| Vector Web | Browser supports Mini Apps, subject to the host's sandbox restrictions | Supports real host smoke tests across Mac/Android/Vector Web; browser-only Pages testing is **not** equivalent |
| Mini App sandbox | No arbitrary outbound HTTP/WebSocket and no direct WebRTC | Existing `/rc/synced/` public-Nostr-relay transport **cannot be copied unchanged into an .xdc** |
| Persistent notes | Each instance has localStorage / IndexedDB but no durable host multi-device WebXDC history | Local-first data and user-controlled, encrypted file backups remain mandatory |

## Preserve existing user data

1. Never import the owner's private-link backup into a chat shared with other people. The original `vctrmemo-encrypted-YYYY-MM-DD.vctrmemo` + private `#k=` link must stay private and separate.
2. Keep `/rc/synced/` as an isolated browser-only E2EE experiment while it is used; it must never silently replace existing `vctrmemo-v2` data or the stable `/synced/`.
3. Preserve v2 causal operation IDs, deletes, predecessor relationships and unresolved conflicts. Do **not** change storage key or actor identity as an incidental feature upgrade.
4. Keep personal workspace distinct from optional explicitly shared workspace; do not send full personal history into a shared chat via realtime or `sendUpdate`.

## v0.5.1 implementation roadmap with release gates

### Gate A — real Vector Mini App compatibility (no notes sent)

- The existing `vector-live/probe-core.mjs` and `vctrmemo-owner-realtime-auto-v2.xdc` transmit **only random challenge, response and host public identity**.
- Open **the same posted .xdc message**, not a second upload, using Vector v0.5.1 on Mac and Android and/or Vector Web.
- Verify open/render, back/foreground, focus/IME, local reload and `joinRealtimeChannel` availability. Try Notes/self-DM with **the same account** separately from a controlled two-account DM test.
- A mock-host unit test succeeding **does not** prove a same-account two-device session can communicate. The exact native-host issue is documented above. A negative result must not unlock Gate B.

### Gate B — portable offline recovery inside Vector

- Add user-controlled encrypted portable archive export/import inside the .xdc sandbox **without** using any network or exposing the `#k=` secret to a chat; confirm the host's download/save/file-picker behavior on macOS, Android and Vector Web.
- Validate counts, history structure, SHA-256/GCM and commit-on-confirmation in a test-only isolated package before changing the normal app.
- No account login, second account, recurring subscription, or paid backend required.

### Gate C — same-owner live sync (blocked by current host)

- Either upstream Vector implements per-device self Notes Mini App discovery plus a verified durable owner history pathway, **or** a separate private encrypted transport is designed and consented to with a documented sandbox bridge and threat model.
- Correctness acceptance: Mac→Android and Android→Mac, restart, offline edits on both devices, delayed reconnection, fresh third device, 12,000-operation capacity behavior, and no data loss under one-field conflicts.
- Until then label the Vector .xdc **local-only**, not automatic owner-sync. The browser-only private-link prototype is a different environment.

### Gate D — optional collaboration

- Distinct workspace identity, per-document invitation/permissions, explicit publishing, conflict preservation and participant revocation.
- Realtime data is ephemeral; snapshot plus durable offline recovery is still required. Do not grant a collaborator access to the personal workspace's archive.

## Primary sources

- Client release: https://github.com/VectorPrivacy/Vector/releases/tag/v0.5.1
- Mini Apps API, v0.5.1: https://github.com/VectorPrivacy/Vector/blob/v0.5.1/docs/miniapps/README.md
- WebXDC Iroh peer protocol: https://github.com/VectorPrivacy/Vector/blob/v0.5.1/docs/webxdc-realtime.md
- Same-account peer discovery exclusion: https://github.com/VectorPrivacy/Vector/blob/v0.5.1/crates/vector-core/src/db/miniapps.rs
- Host update stub: https://github.com/VectorPrivacy/Vector/blob/v0.5.1/src-tauri/src/miniapps/commands.rs
- Bundled SDK manifest: https://github.com/VectorPrivacy/Vector/blob/v0.5.1/crates/vector-sdk/Cargo.toml
