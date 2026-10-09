# Free play client preparation

Nothing in this directory is imported by a game or application route yet. No
config, environment flag, wallet hook or LaunchContext is changed. Launch
intentions are ephemeral and belong to D; these snapshots identify completed
runs and have their own persistence lifecycle.

The game adapter records a complete accepted replay under a stable lowercase
UUID v4. It creates `createFreePlaySnapshot(input)` only at a valid terminal
state, with the locally computed claimed score. Restart and Undo after taking
this snapshot must fork a new UUID. The captured input is immutable. Keep the
local result when certification limits, connectivity or quota prevent anchoring.

Inject `createFreePlayClient({ origin, target, auth, fetch })`. `origin` is a
trusted configured backend origin, never a URL from a query or stored snapshot.
There is no default network or implicit production activation. The injected auth
adapter exposes the active identity, a revision that changes on every session /
wallet / network transition (including A→B→A), a subscription to those changes,
and an async token provider returning both token and its bound identity. Never
return a cached token under a different identity. Tokens are only used in the
Authorization header and never persisted. Redirects and cookies are disabled.
The backend remains responsible for cryptographic authentication and replay.

Create one session per completed run, outside render, with the client and a
storage adapter. The constructor persists the snapshot or throws if persistence
is unavailable; retain the game result and offer a local export in that case.
Reuse/dispose sessions in the owner lifecycle. `FreePlayResult` is an optional
presentational consumer. It does not connect a wallet, start a game, automatically
publish, poll or subscribe to a launch intent. The owner handles wallet connection.
An injected auth subscription invalidates the controller and aborts in-flight
work on identity changes. Every API action also revalidates identity before the
request and after async boundaries, so a late callback cannot confirm another
wallet's result. A new run owns a different storage key and controller.

Snapshots use `memba:arcade:freeplay:v1:<clientRunId>`. Their allowlist stores the
input, optional player/network/realm binding, result/receipt and any explicitly
consented publication request. Unknown fields, tokens, secrets and auth revisions
are stripped. The quote nonce is the request's idempotency binding, not a bearer
credential; the backend still requires the same authenticated owner. Quotes that
have only been reviewed are not persisted as publication consent.

On reload use `loadFreePlaySnapshot` and create a new session. Persisted receipts
start as untrusted saved data: `refresh` must authenticate and read the backend
again before the panel announces confirmation. Run, replay and payload SHA256
commitments are checked against the captured input and player/chain/realm. A
wrong account or network requires reconnecting the original identity; the client
does not silently rebind a snapshot. A different player should start a new run.

The flow is verify → review quote → explicit confirm. Before publication the
exact quote ID/nonce/payload request is persisted. An ambiguous failure offers a
retry of that same request, including after reload; it never silently issues a
new quote or a second authorization. The server supplies publication state and
committed receipts. The caller can offer manual refresh or schedule reads using
server `nextCheckAt`; no polling loop is included. A score labelled verified or
queued is never displayed as confirmed. This UI currently supports studio-paid
quotes only, displaying player charge and studio fee/deposit caps.

Tests are scoped to injected clients/auth/storage and shared backend vectors.
No wallet signing, network request or production activation is needed. Game
adapters and result-panel mounting remain separate reviewed integrations.
