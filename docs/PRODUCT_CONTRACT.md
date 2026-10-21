# vctrmemo — Product Contract

## Product identity

vctrmemo is a Notion-style personal-first workspace for pages, blocks, structured databases, and their links, intended to integrate with Vector. A person must be able to create and edit data with **one account on one device**. No second user, second Vector account, chat group, or collaboration invite may be required for primary use.

## Non-negotiable boundaries

1. **Local personal workspace is the default.** Individual editing and persistence must not silently publish or import another chat participant's data.
2. **Same user's devices are not multiple users.** Single-owner multi-device synchronization and multi-user collaboration are independent workstreams.
3. **Sharing is voluntary, explicit, and scoped.** Chat-wide history transport is an experimental feature and is not a substitute for personal-account sync or selective Notion-style page sharing.
4. **No forced data model migration.** Preserve the existing `vctrmemo-v2` local storage and operation history; new architecture requires tested, reversible migration.
5. **Do not claim encryption, verified peer identity, or delivery guarantees** without production verification. The present localStorage is not encrypted by vctrmemo.
6. **No feature or name substitution.** The application is called `vctrmemo`, and pages/databases remain primary use cases.

## Architecture reality, as of v0.11

- The current browser application stores its operation log locally.
- The current WebXDC bridge is bound to the specific chat message's Mini App instance. Publishing the same XDC again creates a separate instance.
- The WebXDC sendUpdate API broadcasts to that instance's chat participants. It is **not** an account-private personal-storage API.
- Standard WebXDC documentation describes self-chat / Saved Messages as a *possible* single-user multi-device channel. Vector's actual support for it has not been established.
- Existing v0.10 and earlier chat update receipt is disabled by default in v0.11 and does not modify local pages until the user opts in. Opt-in merges received chat history; it does not create a separate collaborative workspace.
- Optional chat-wide sync and two-person test hooks must not be presented as the primary product.

## Pending implementation, not completed

- Verify Vector's same-account multiple-device model and whether a self-chat WebXDC instance is supported.
- Select an account-private, secure sync solution with key handling, identity, failure recovery, and no silent sharing. A separate sync service must not be adopted without explicit evaluation of privacy and costs.
- Define distinct personal versus shared workspace identities and access boundaries. Selective sharing requires its own access control and transport.
- Migrate and test existing local-first data before enabling any automatic transport.

## Documentation sources

- https://webxdc.org/docs/spec/messenger.html
- https://webxdc.org/docs/shared_state/conflicts.html
- https://webxdc.org/docs/faq/storage.html
- https://webxdc.org/docs/spec/sendUpdate.html

## v0.12 safety restriction

While owner-only multi-device sync and truly separate shared workspace permissions are unresolved, all chat-wide workspace updates are rejected and the app's chat-history sharing action is disabled, not merely hidden. Diagnostic probe messages contain no page or database data. The v0.11 toggle and chat-history merging are deprecated and disabled. Existing local keys, stored operations and backup formats are retained without automatic deletion or migration. See the draft usage-mode proposal in PR #1; it is not yet an approved final spec.
