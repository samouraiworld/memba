# Space Invaders Free publication adapter — source preparation

This is a proposed game codec and a dormant consumer of A's shared client.
There is no new endpoint, auth implementation, wallet hook, default network,
realm activation, signer, polling loop or broadcast in this game. A must accept
this codec in the shared verifier before it can be offered by a live service.
The existing Daily publisher and version stay unchanged.

## Ownership and integration

B owns these game files and the page's optional `publication` prop. A owns
`frontend/src/lib/arcadeFreePlay.ts`, `games/arcade/freeplay/**` and all shared
backend code. D owns the shell and LaunchContext. No `config.ts` or gate changes
are authorized here; concrete auth/config adaptation is coordinated through the Lead.
This branch does not copy A's files into its base or import an unresolved shared
module. It consumes the real A functions through an injected, narrow factory.
The shared session remains the sole owner of verify/quote/publish/retry/auth
invalidation, persistence, receipt checking and publication status.

Binding after A3 is composed (API read at `554ca706`):

```tsx
import { createSpaceInvadersPublication } from "../games/space-invaders/lib/freePlayPublication";
import { createFreePlaySnapshot, loadFreePlaySnapshot } from "../games/arcade/freeplay/snapshot";
import { createFreePlaySession } from "../games/arcade/freeplay/session";
import { FreePlayResult } from "../games/arcade/freeplay/FreePlayResult";

// client and storage are the trusted host-injected A implementations.
// connectAccount is the existing wallet UI, never invoked at game start.
const publication = createSpaceInvadersPublication({
  createSnapshot: createFreePlaySnapshot,
  createSession: snapshot => createFreePlaySession({ snapshot, client, storage }),
  renderSession: session => <FreePlayResult session={session} />,
  connect: connectAccount,
  recovery: {
    loadSnapshot: id => loadFreePlaySnapshot(storage, id),
    inputOf: snapshot => snapshot.input,
  },
});
// Supply a stable adapter to <SpaceInvadersGame publication={publication} />.
```

Preparing a session happens once at terminal Free gameover, outside render, and
must persist the snapshot before returning. Preparing performs no API action.
The shared buttons then make verification and publication explicit. An auth
change invalidates A's controller; B never copies a token or binds a receipt to
another run. Menu/Back retains the same session. Restart disposes that session
and creates a new identity, while A's stored snapshot is retained independently.
Unmount disposes subscriptions. A connection callback is optional and only runs
from its dedicated button.

If secure identity creation, codec eligibility or session persistence fails,
local gameplay and its score survive. The result offers a local JSON export;
the cap-plus-one recorder overflow is labelled incomplete in that export.
Neither a local replay check nor an exported package is a mainnet receipt.
The shared panel alone may label a score confirmed after its verified readback.
No adapter prop means no publication panel or service action.

## Stable run identity

Each new Free run gets a fresh lowercase UUID v4 from cryptographic bytes and
retains its numeric seed. Rotation, pause, re-focus, launch intents, menu,
connection and retries never regenerate the UUID. No insecure identity fallback
is invented. The single active identity is written to
`memba:space-invaders:active-free:v1`; it contains only game, rules, version,
UUID and canonical seed. An unavailable store does not prevent local play.

A owns complete terminal snapshots under `memba:arcade:freeplay:v1:<UUID>`.
Its session must persist before it exposes verification/publication, including
when the initial identity write failed. This source does not promise resumable
mid-run simulation: the active identity record is not an input journal.
The saved-results host selects a UUID from A's shared bounded index; B owns no
second index, storage scan, persistence schema or controller. The selected UUID
is opened through A's loader and session, as specified below. A saved receipt
must be re-read, not trusted from localStorage. Shared bounded discovery and
host/auth binding remain coordination work; no automatic publication is added.

## Open a saved result without starting a run

The consumer exposes `publication.recover(clientRunId)` when the factory receives
`recovery: { loadSnapshot, inputOf }`. The loader may be synchronous or return a
Promise, must be A's bounded validated loader, and returns an existing snapshot
or null. `inputOf` only projects `snapshot.input` for B's game/rules/version/codec
and UUID equality checks. Recovery calls the same A `createSession(snapshot)`
and `FreePlayResult`; it never calls `createSnapshot`, creates an identity,
replays a simulation or sends API work. A alone validates/persists the full
snapshot and owns receipt state. Its recovered controller starts `saved`, even
when the stored snapshot contains a confirmed receipt.

```tsx
// Selection comes from A's shared saved-results UI/index; no query-string launch.
<SpaceInvadersGame
  publication={publication}
  recovery={{ clientRunId: selectedId, onClose: returnToSavedResults }}
/>
```

This explicit page mode mounts only `SavedFreePlayResult`, not the game. Any
pending `launch` prop is neither consumed nor run while recovery is selected.
The host must clear stale launch intent before leaving this mode; selecting a
saved result is not a request to discard a live run. Only offer this transition
from the saved-results host after explicitly leaving gameplay.

The adapter must remain stable between renders. The view retains one prepared
session until UUID/adapter changes or unmount. A session that arrives after
unmount is immediately disposed; missing, corrupt, unsupported or wrong-game
snapshots show a recovery error without falling through to gameplay or deleting
storage. Back invokes the host callback only. Connection and A's `Check saved
result` require explicit clicks; there is no automatic refresh/verify/quote or
publish. Only A may show confirmation after validated fresh readback. This
consumer does not invent a gameover summary, new-best badge or local replay
verification from an old receipt.

The provided binding uses A3's existing one-ID loader. The future shared bounded
index/reader must preserve these semantics; adapt the injected loader in the
host when A finalizes its API, without introducing another game-owned index.

## Proposed immutable game contract for A

| Field | Value |
| --- | --- |
| game | `space-invaders` (never legacy `invaders`) |
| rules | `si-free-standard-v1` |
| simVersion | `1` (existing deterministic engine version) |
| seed | `si1:` + exactly 8 lowercase hex digits, direct uint32 including zero |
| replayCodec | `si-deltas-v1` |
| finishReason | `game-over` |
| claimedScore | terminal integer score, advisory; server recomputes |

Do **not** pass the seed string through the Daily FNV seed derivation. It directly
encodes the exact numeric value supplied to `newGame` in the Free session.

Canonical replay is ASCII:

```text
finalTick;tick|move10|fire|0;tick|move10|fire|0;...
```

There is no trailing separator/newline/space, no JSON inside the replay string,
no signs on nonnegative integers and no redundant leading zero. `move10` may
have one minus sign only when negative; negative zero is rejected. Re-encoding
a parsed replay must produce identical bytes. Outer HTTP JSON whitespace does
not affect this string or its commitments.

- `finalTick` is an integer in `[1,216000]`; at most 10000 deltas; at most
  1000000 canonical ASCII bytes, within A's 1 MiB request envelope.
- A delta is exactly four integers. Tick is in `[0,finalTick)` and strictly
  increasing. `move10` is `[-10,10]`, fire is 0/1, pause is always **0**.
- The first delta is at tick0 with fire1: the direct-play launch impulse is
  part of the live simulation and recorder. Consecutive identical move/fire
  deltas are rejected, matching the recorder's change-only representation.
- Inputs hold until the next delta. Decode `move = move10 / 10`, exactly as
  consumed live after quantization. No repair, sorting, deduplication or clamping
  is allowed in the verifier.
- Pause and loss of focus/space consume no simulation ticks and add no pause
  event. Simulation steps use `1000/60` ms. Stop at the **first** gameover: final
  phase must be terminal and `firstGameoverTick === finalTick`. Padding after a
  terminal state, a mid-run snapshot and a Daily seed are rejected.
- These are certification resource bounds, not a gameplay duration budget.
  Beyond them the game remains playable; no truncated log is promised eligible.

The state hash remains the engine's FNV-1a scored-state digest, eight lowercase
hex digits, from `lib/verify.ts`. It is not a cryptographic anti-bot proof.
The backend runs this exact TypeScript engine inside its existing bounded Node
worker; no Go engine rewrite is planned. A adds a Free dispatch that decodes the
direct uint32 seed and canonical deltas, preserving JavaScript rounding, uint32
RNG/overflow and IEEE numeric operations. The Go envelope validates the request
and commitments around that worker; it must not reuse the Daily FNV seed path.

A's LP/SHA256 commitments are unchanged:

```text
replayHash = H("memba:free-replay:v1", game, rules, "1", seed, replayCodec, replay)
runID      = H("memba:free-run:v1", chainId, realm, player, game, clientRunId)
payloadHash = H("memba:free-anchor:v1", chainId, realm, runID, player, game,
                rules, "1", seed, decimal(score), stateHash, replayHash)
```

`H` is A's uint32-BE length-prefixed UTF-8 SHA256. The game does not implement a
second production commitment/transport client. The player/chain/realm binding
comes from A's authenticated flow. Reusing the UUID with another payload is a
conflict, not another identity. Duplicate replay hashes across players remain
allowed. Rules/version select only this game's board; no global board is added.

## Fixtures and acceptance

`testdata/freeplay_vectors.json` includes four full terminal inputs, decoded
uint32 seed/deltas/final tick, exact first gameover, score/state hash and A's
run/replay/payload commitments. Seeds are 0,1,4242,uint32 max; the 4242 scenario
uses fractional steering. Fourteen mutated envelopes pin version/rules/seed,
noncanonical numbers, duplicate ticks, pause injection, wrong score and terminal
padding rejection. Status is explicitly proposed until A validates the adapter.

Regenerate offline with `node src/games/space-invaders/lib/testdata/generate-freeplay.mjs`
from frontend. Its short deterministic simulations do not call any service.
`freePlayCodec.test.ts` replays the valid fixtures and checks commitments and
rejections. They can be copied by A into its owned testdata; B does not edit the
backend. Acceptance requires these vectors to pass both the Go envelope and
the new Free dispatch of the exact bounded TS worker. No Go/worker integration
test or end-to-end mainnet evidence is claimed here.

Before activation: A registers the exact codec/rules and proves its fixtures;
compose the shared client and Lead-coordinated auth/config, connect A's shared
saved-result discovery to the recovery prop, measure resource ceilings, then
validate a complete optional
verify → quote → explicit consent → confirmed readback flow plus cancellation,
wrong network/account, reload and retry. D consumes the per-game board via A's
existing public board reader. Activation and any transaction need the separate
coordinated release decision.
