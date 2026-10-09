# Free play v2

Free play is playable without a wallet. A completed run may be verified and,
after explicit consent, anchored with its own receipt and per-game leaderboard.
The source supports Block Party Free, Space Invaders Free and Barricade FPS
through their exact versioned replay adapters. Daily/Classic contracts remain
separate. External games and Connect4 are outside this service.

The service is dormant by default: the backend configuration path is empty and
the public OS deployment manifest is `null`. The backend mounts a 404 handler
until an explicit valid configuration is supplied. Runtime, transport, budget,
limiter, board reader and publisher composition are implemented, but merging
this source does not deploy a realm, configure a signer or activate publication.

## Trusted deployment configuration

The only backend configuration entry point is
`MEMBA_ARCADE_FREEPLAY_CONFIG_PATH`. Empty or absent returns a nil configuration
without file, secret, Node, RPC or v2 runtime work. A nonempty value must be an
absolute local path. The regular UTF-8 JSON file is read once at startup and is
limited to 64 KiB. Invalid or unreadable configuration leaves the v2 route
disabled and emits a constant diagnostic, without the path or file contents.
Existing services and the general database migration sequence continue.

The document requires these exact case-sensitive fields, including explicit
`publish: false` when publication is disabled. Objects must contain every listed
field; unknown/duplicate keys, nulls, trailing values, numeric strings, fractional
or exponent-form integers and incomplete objects are rejected.

| Object | Required fields |
|---|---|
| root | `cost`, `budget`, `rpcUrl`, `rpcBlockAge`, `rpcTimeout`, `publishInterval`, `publish`, `limits`, `node` |
| `cost.target` | `chainId`, `realm` |
| `cost` | `target`, `gasWanted`, `storageBytes`, `feeMarginNumerator`, `feeMarginDenominator`, `maxFeeUgnot`, `maxDepositUgnot`, `maxPriceAge`, `quoteLifetime` |
| `budget` | `signer`, `maxAttempts`, `maxFeeUgnot`, `maxDepositUgnot` |
| `limits` | `ipRequests`, `walletRequests`, `maxEntries`, `window` |
| `node` | `nodeBin`, `timeout`, `concurrency`, `maxOutputBytes` |

Duration fields use positive integer unit segments such as `30s` or `1m30s`,
with units `ns`, `us`, `ms`, `s`, `m`, `h`. Signs, spaces, decimals, overflow and
zero are refused. Integer resource and monetary fields must fit their declared
Go integer type and pass the existing runtime validators. No economic or
resource defaults are provided by this loader. Test fixtures are synthetic
validation inputs, not recommended production limits.

`cost.target.chainId` must exactly match the server's `GNO_CHAIN_ID`; the realm
is fixed to `gno.land/r/samcrew/memba_arcade_scores_v2`. `budget.signer` is a
canonical Gno address, required even when publication is disabled. Transaction
fee/deposit caps must fit the daily budget. The existing RPC URL, freshness,
cost, budget and timeout validation remains authoritative; chain identity and
realm configuration are checked again by the concrete transport before use.
Legacy daily flags, signer variables and password defaults do not configure v2.

With `publish: false`, omit both `gnokeyBinary` and `keyringHome`; supplying
either is an error, even as an empty string. No secret accessor, gnokey command
or publisher is used. This mode still admits authenticated verification, quotes
and explicitly consented queueing: it is **not a read-only API mode**.

With `publish: true`, both paths are required and absolute. The dedicated
`MEMBA_ARCADE_FREEPLAY_KEYRING_PW` secret is looked up only by the broadcast
callback at send time. It must be present, nonempty, at most 1024 bytes, and
contain no CR, LF or NUL; canceled contexts refuse access. It is sent to gnokey
through stdin, never argv, config JSON or logs. Loader failures use
`invalid_freeplay_configuration`; secret failures use
`freeplay_secret_unavailable`. A missing secret at send time prevents emission;
parsing success does not prove key availability, funding or onchain roles.
Keyring provisioning is a separate operator action. This source does not import,
generate or finance keys, and does not promise secure erasure of Go strings.

The OS host imports `ARCADE_FREE_PLAY_DEPLOYMENT` from
`frontend/src/os/arcadeFreePlayDeployment.ts`, which remains `null`. A future
reviewed build may supply public chain/game/rules/version/origin/target fields.
The adapter validates those fields before lazily acquiring host storage, then
passes one stable configuration to the existing Shell runtime owner. It does
not read snapshots, create auth/clients or contact a network. Null never
acquires storage. Invalid manifests or unavailable storage return null; later
persistence failures remain visible to the existing result-saving flow.

There is no VITE flag, URL parameter, saved result or remote endpoint that can
supply this authority. Activation requires a separately reviewed public
manifest and rebuild as well as explicit backend operator configuration and
the release conditions below.

## Protocol

`H(fields...)` is SHA-256 over each field's unsigned 32-bit big-endian byte
length followed by its UTF-8 bytes, without separators or JSON encoding.
Decimal integers have no padding. Digests are lowercase hexadecimal.

- runID: H(`memba:free-run:v1`, chainId, realm, player, game, clientRunId).
- replayHash: H(`memba:free-replay:v1`, game, rules, decimal(simVersion), seed,
  replayCodec, canonicalReplay).
- payloadHash: H(`memba:free-anchor:v1`, chainId, realm, runID, player, game,
  rules, decimal(simVersion), seed, decimal(score), stateHash, replayHash).

The realm is `gno.land/r/samcrew/memba_arcade_scores_v2`. The player is derived
from the existing authenticated token, whose chain must match exactly; chainless
tokens cannot publish. The client persists one lowercase UUID v4 per run and
retains it across retries. Restart creates a new UUID. The first verified
payload is immutable. A changed replay under the same identity conflicts.
Identical replay hashes can belong to different players.

Block Party seed is `bp1:` followed by eight lowercase hexadecimal digits.
`U`, `R`, `D`, `L` are accepted moves; `Z` is accepted Undo. No-op moves, empty
Undo, and directional moves after game over are invalid. Undo restores the
complete prior state including RNG. The final replay state must be game over;
Undo after taking the publication snapshot must fork a new client UUID. The
certificate accepts at most 100,000 actions and an HTTP envelope of 1 MiB.
These are certification bounds, not a gameplay move budget.

State hash is H(`memba:bp-state:v1`, sixteen row-major decimal cells, decimal
score, decimal RNG state, decimal RNG call count, decimal moves, modifier, `1`).
The last field means game over. Shared TypeScript-generated vectors live in
`testdata/freeplay/vectors.json`; the Go verifier tests consume the same file.

## HTTP and publication

With the explicit dependencies installed, the router offers authenticated
`POST verify`, `GET runs/:runID`, `POST runs/:runID/quote` with body `{}`, and
`POST runs/:runID/publish` with `payloadHash`, `quoteId`, `nonce`. Public
`GET boards/:game?rules=...&simVersion=...&offset=0&limit=50` reads the realm
through an injected reader. A missing reader is an unavailable board, never an
empty local substitute. Each row must match the exact game, rules and version.

Quotes are generated by trusted policy. This preparation only supports studio
payment with explicit positive fee/deposit caps. No player-payment flow is
implemented. Atomic quote consumption and queue insertion make exact retries
idempotent even after expiration. A changed nonce or payload conflicts.

Before sending, the publisher obtains durable leases on the run and on the
(chain, signer) account, checks committed state, reserves the spending budget,
and commits an `unknown` broadcast marker. Only then does it call Anchor.
A crash after the marker, including before the actual send, requires readback
or operator reconciliation. Not-found is never permission to automatically
spend again. A signer with an unresolved send is pinned to that run, so another
queued run cannot reuse its account sequence. This also means that an unknown
send can intentionally block the account until reviewed.

All v2 workers for a dedicated signer must share the same SQLite database. Do
not share the key with the legacy batcher, another database or an external
writer. Transport calls must honor context cancellation; the operation deadline
is 45 seconds and its lease is 60 seconds. Counters distinguish durable broadcast
reservations, operational failures before sending, and pending-confirmation
rounds. Claiming a lease does not consume any attempt counter. A broadcast
reservation can count as one even if the process dies before network I/O.

Every unsuccessful operation persists its next eligible check: 5, 10, 20, 40,
80, 160, then at most 300 seconds between checks. SQLite enforces this backoff
across workers/restarts. Only pre-send operational failures stop at eight and
expose `retry_limit_operator_review_required`; they never pin the signer.
Pending confirmation continues without that limit and retains its actual error
or `confirmation_pending`, even if inclusion takes many polls. Exact readback
confirms the run and releases the signer in one transaction. When explicitly
configured with publication enabled, the runtime installs one publisher loop.
The store honors `nextCheckAt` on every claim across restarts.

An unknown broadcast that never becomes readable intentionally remains pinned.
RPC not-found alone cannot prove a transaction was never broadcast, including a
crash between the durable marker and Anchor. There is no automatic clearing or
rebroadcast path. The future operator procedure for a genuinely unresolved send
must prove its chain outcome and review spending before any new authorization;
it is still an activation prerequisite. A late exact receipt uses the ordinary
tested readback path and safely releases the signer, even after twelve or more
polls. No manual counter reset is needed for slow inclusion.

Confirmation requires exact committed receipt fields, schema 2, correct
chain/realm, positive height and canonical attester address. The transport must
validate RPC network and realm config getters and must not use transaction
stdout as evidence. A transaction hash may be absent when only readback is
available; the API does not invent one. Each run has its own receipt, including
scores below a personal best. The separate realm maintains the per-game best
index. The concrete RPC/gnokey transport is implemented; no live signer,
production activation or realm deployment is supplied by the configuration
wiring.

## Migration and rollout

`042_arcade_freeplay_v2.sql` adds independent runs, quotes, outbox and signer
lease tables and one lookup index. `043_arcade_freeplay_spending_v2.sql` adds
budget and spending tables and one index. Existing scores are not imported.
**The existing migration runner applies both migrations on startup even while
Free play is disabled.** Route disablement is not a migration gate. Deployment
therefore needs the release owner's migration decision and a fresh consistent
database backup.

Tests reconstruct chronological schema prefixes before 042 and before 043,
assert migration ledgers/tables/indexes, migrate twice and reopen SQLite
`VACUUM INTO` backups. They preserve the full legacy run and, where present, a
v2 run; they do not create historical spending or touch a production database.
These fixture proofs do not replace a fresh deployment backup/restore check.

Rollback may retain additive tables with the previous compatible binary. A
backup restore needs stopped writers and an explicit operator decision: it
loses writes since the backup. Reconcile queued, unknown or potentially
broadcast runs before reactivating any restored publisher; restoring an old
outbox is not authorization to send again.

Activation requires reviewed identities and economic/resource limits, a
provisioned dedicated signer, the correct realm, exact binary qualification,
recovery procedures, frontend consent and a release Go. Two separate blockers
remain outside this wiring:

- The HTTP service and publisher have no game/player allowlist. Selecting games
  in the UI cannot restrict direct API submissions or an existing outbox. A
  limited canary needs separately reviewed server enforcement.
- The Dockerfile installs `gnokey@v1.1.0`, while the v2 transport proof used e75.
  Qualify the exact served executable or review a separate image pin before any
  live broadcast. This wiring does not change the image or key provisioning.

## Expired unsent authorization

A fresh run view exposes `canReauthorize` only for queued runs whose consumed
quote expired, with no transaction marker, zero broadcast reservations and no
active outbox lease. This is informational; Queue repeats all checks under its
SQLite writer transaction when consuming a new explicitly consented quote. It
replaces only authorization metadata, clears the old lease owner to fence stale
workers, and resets pre-send failures/backoff. It never changes the verified
payload or clears a broadcast marker. Exact old retries remain idempotent until
a replacement wins; after replacement, obsolete authorization cannot take over.

The existing quote/publish endpoints serve this recovery; no additional write
route is introduced. Quote refuses queued runs that are not eligible. UI must
show the new quote and require a fresh explicit click, never renew automatically.
Submitted, confirmed and unknown outcomes are excluded, even after lease expiry.
Tests cover the HTTP view/quote/publish sequence, active lease refusal, concurrent
replacement versus stale reservation, old-worker fencing and one actual send
following fresh consent. The migration shape is unchanged by this addition.


### Authorization deadline, including waits

The publisher rechecks quote expiration after budget reservation, after acquiring
SQLite's writer and immediately before Anchor. Reservation and Anchor share a
context deadline bounded by the remaining authorization and the45second operation
limit. The concrete transport must honor that deadline immediately before its
actual broadcast. Confirmation readback is independent of the quote deadline.

If the still-running invocation proves it has not called Anchor, it may roll back
its own first intent, with signer/outbox owner and quote fencing, to queued with
zero broadcast attempts. The failure then releases its lease and allows a new
explicit quote after expiry. No recovery worker can infer that proof from a
marker. After crash, a commit error, or any Anchor invocation, ambiguity remains
pinned and is never cleared by this cancellation path.

A successful spending reservation is conservatively retained even when no
broadcast follows. It is a charged allowance, not evidence of an onchain payment.
The source deliberately does not refund that allowance automatically; a future
budget implementation must account for this distinction and receive independent
review. This preserves the spending ceiling without claiming an unimplemented
atomic refund protocol.

## Exact SI/FPS worker (dormant opt-in)

`NewFreePlayRunner(parent)` extracts a dedicated embedded bundle importing the
reviewed Space Invaders Free codec/engine and Barricade FPS codec/engine directly.
It shares the parent's concurrency semaphore and bounded Node subprocess
implementation. It does not dispatch to Daily/Classic or reimplement either sim.
The two committed bundles are rebuilt together and checked independently in CI.

`FreePlayHTTPConfig.Verifier` is optional. Nil keeps SI/FPS ineligible; Block
Party always uses its existing Go verifier. When explicitly configured, main
constructs the shared parent and the Free play runtime owns a dedicated child.
With no configuration it constructs neither for Free play. Construction requires
an explicit parent; there is no fallback network, engine, game, version or signer. Close removes the
private extracted bundle. Request deadlines include the shared queue wait; the
subprocess timeout bounds execution after admission.

Preflight bounds shape/scope/cost before a child starts. The worker checks the
actual terminal state, claimed score and canonical transcript. Go validates the
compact verdict and independently recomputes replay/run/payload commitments.
Malformed output, timeout or crash are infrastructure errors (HTTP503), distinct
from a rejected replay (422). A verified response is not onchain confirmation.

Validation evidence:6 positive fixture envelopes,14SI+9FPS rejections, legacy
loops, shared capacity/cancellation, actual child kill/reap, stdout/stderr caps,
private permissions and cleanup. See testdata/freeplay/worker-provenance.md.
Worker tests use fixture envelopes and no live signing/broadcast. They do not
authorize production activation or establish production resource/economic limits.
