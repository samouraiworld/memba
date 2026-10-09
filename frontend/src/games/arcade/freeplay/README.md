# Free play client preparation

The client is prepared for separately reviewed game consumers. No production
config, environment flag or LaunchContext is changed. Launch
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

The same client owns public `board({game,rules,simVersion,offset,limit}, signal)`
for D and game UIs. It calls GET boards/:game without cookies or an auth token,
validates the exact chain/realm/game/rules/version and every receipt, rejects
cross-game rows and duplicate players, and preserves pagination order. An RPC/API
error is unavailable, not an empty leaderboard. An empty confirmed response is
valid. There is no global-board query. Abort an old request when changing the
selected board; responses carry their exact context for the consuming UI.

A queued quote may expire before any transaction was sent. A fresh API read can
return `canReauthorize: true` only when the server proves zero broadcast attempts,
an empty transaction marker and an inactive lease. The panel surfaces expiry and
lets the player review a new quote, then explicitly consent again. Until that
click the old saved request is retained. The server atomically fences expired
workers when replacing authorization; submitted/unknown outcomes cannot use this
path. `canReauthorize` is deliberately not trusted or persisted across reload.

### Shared recovery index

`listFreePlaySnapshots(storage, { game?, offset?, limit? })` returns
`{ snapshots, unavailable, total, nextOffset? }`. The limit defaults to10 and is
bounded at20. The shared index retains20 recent IDs per game (60 total), with no
tokens, identity revision, receipt or replay duplicated in it. The canonical
snapshot keys remain unchanged. Every successful `saveFreePlaySnapshot`, including
session persistence, updates this index. Consumers must use this API instead of a
second per-game persistence system.

After a reload or new run, a game or Your runs can list its saved results and pass
a selected snapshot to `createFreePlaySession`. That session starts as `saved`;
a stored receipt is never a fresh confirmation. The user requests `refresh` to
recheck the same account/network. No API request, wallet connect or publication is
triggered by listing. Resume the same saved publication request after ambiguity;
do not silently obtain a new quote.

The index is discovery metadata. Eviction only removes its old ID, never the
canonical snapshot. Earlier unindexed snapshots remain loadable by a known UUID;
opening/saving one indexes it. Storage provides no transactional cross-tab index
merge: simultaneous writes may omit an ID from discovery while its canonical
snapshot remains intact. Callers should refresh their list after storage events.
A corrupt index fails closed. Missing/corrupt entries in a bounded page increment
`unavailable` while intact results remain visible. No storage enumeration or
unbounded migration is performed.

If the snapshot write succeeds but the index write exceeds quota, persistence
throws before any publication I/O. The canonical snapshot remains loadable by ID
and may already contain consent; reopening it must preserve and retry that exact
request. Keep a local export available when storage fails. This is a local saved
results list, never a cross-game leaderboard.

### Live OS authentication and runtime handoff

`createOsFreePlayAuth({readSession})` uses the existing token serializer and
signing guards without signing. The OS supplies its committed session and calls
`refreshIdentity()` after commits; create/dispose this bridge in its lifecycle.
Live RPC reads use frozen copies from `getWalletRpcContext`; its synchronous
observer advances an independent revision on every setter, including unverified
network transitions and A→B→A. The signing epoch semantics are unchanged.
Nested observer notifications are coalesced to prevent recursion; each nested
setter still updates the context and revision immediately. Listener exceptions
and unsubscribe cannot block the remaining listeners.

The bridge also consumes real Adena account/session-invalidated events, rejects
that session's old token, expires credentials on a timer and rechecks the existing
wallet action ticket at every identity/token boundary. OS lock/logout/refresh
can invalidate work even without an RPC setter. Tokens remain private in memory.
Six tests exercise real hooks/events/guards with only the Adena provider and HTTP
boundary replaced; these are not a full Shell/browser recipe.

`FreePlayRuntimeProvider` is a neutral optional dependency provider for WindowBody,
native ArcadeWindow and classic pages. Its stable `games` map supplies per-game
`client?`, `target?`, `storage`, `connect?`, `rules`, and `simVersion`; no values are
constructed or activated by the provider. `recovery` carries the original game/ID
and an explicit close callback. `subscribeSavedRuns?` belongs to the OS storage
owner. Explicit game props take priority over the provider; an explicit null can
disable a game integration. A missing provider keeps local play available.
Opening an archive must only mount a separate result view while preserving the
current game engine and its paused state. Shell/Phone/WindowBody integration is
reserved to D and remains pending its reviewed inventory.
