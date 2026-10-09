# FPS Free play preparation — not connected

These modules have **no application/session import**, transport, storage, wallet,
LaunchContext, or production activation. The existing game still exports C1 debug
replays. A must port/register the verifier before any FPS score is eligible for
publication. Classic and FPS remain incompatible categories within `barricade`.

The interface was checked against A client PR #1586, head `554ca706`, especially
`games/arcade/freeplay/README.md`. Integration is intentionally deferred: inject
A's `hashFreePlayFields` and `createFreePlaySnapshot` into
`prepareFpsTerminalSnapshot(clientRunId, log, ports)`. The structurally compatible
input is `FreePlayInput`; no duplicate client, retry/outbox or endpoint is added.
A's session/storage lifecycle owns persistence, auth, quote/review/confirm and
receipt validation. C returns frozen primitive input before async hashing; A's
snapshot is a separate client-owned value. No claimed hash is sent as authority.

The owner must allocate and persist a lowercase UUID v4 **once per run at start**,
retain it for all retries, and fork on restart. This preparation accepts that
identity; it never generates/reconstructs it or implements parallel storage.
When persistence fails, keep the local result/export. The C1 fixed-seed in-memory
session is not yet that durable lifecycle. Do not call this adapter from render.

## Codec proposal for A's Go port

- Game `barricade`, rules `barricade-fps-c1`, simVersion `3` (C1 engine unchanged).
- Codec `barricade-fps-inputs-v1`.
- Seed: nonempty ASCII `[a-zA-Z0-9:_-]`, at most 128 characters/bytes. This
  certification subset avoids ambiguous Unicode seed/JSON encodings; gameplay
  debug logs outside it remain local/exportable, not silently rewritten.
- Wire is a JSON array `[finalTick, events]`, with no spaces in canonical output.
  Event rows: `[tick,"F",x,y,z]`, `[tick,"R"]` reload, `[tick,"P"]` patch,
  `[tick,"C"]` continue. Exact row arity; all numeric values are integers,
  negative zero rejected, directions in [-10000,10000] with z <= -1000.
- `0 < finalTick <= 10800`, at most 20000 events, encoded transcript <=1,000,000
  ASCII bytes. Tick order is nondecreasing and every tick < finalTick. Preserve
  the submitted order for actions at the same tick (e.g. patch then continue).
- Decode may accept JSON whitespace and equivalent numeric spellings; reconstruct
  decimal integer rows before hashing. No hash of incoming raw JSON formatting.
- For each tick, apply that tick's actions in order, then advance once. Reject an
  action when `apply` returns the unchanged state: no-op reload, cooldown fire,
  duplicate patch etc cannot become accepted journal entries. C1's partial debug
  `replay()` remains unchanged; this stricter publication verifier is separate.
- Stop exactly at the declared terminal tick, and reject unconsumed/trailing input
  or a nonterminal ending. `finishReason` is `won` or `lost`; score is recalculated.

## Commitments

Use A's `H(fields...) = SHA256(uint32_be(UTF8_length) || UTF8(field) ...)`:

```
stateHash = H("memba:barricade-fps-state:v1", canonicalState)
replayHash = H("memba:free-replay:v1", "barricade", "barricade-fps-c1", "3",
               seed, "barricade-fps-inputs-v1", canonicalReplay)
```

The exact state string is the compact JSON array from `sim/fps/replay.ts`:

```
[rules, version, seed, tick, rng, phase, wave, waveStarted, spawned, nextId,
 hp, ammo, reloadUntil, fireAt, repairUntil, patchAvailable, score, kills, shots,
 [[enemy.id, enemy.axis, enemy.kind, enemy.progress, enemy.speed, enemy.hp], ...]]
```

Keep enemy array order, explicit false/true and empty arrays. No floating-point
values or implicit object field order enter the commitment. This is a new
64-hex cryptographic diagnostic/preparation value, distinct from C1's local
16-hex FNV digest. A computes runID and payloadHash using its existing contract;
there are no replacements here. No registry activation is included.

## Porting traps and fixtures

`sim/fps/{types,engine,collision,replay}.ts` are untouched from C1. Go must preserve
unsigned uint32 FNV/xorshift arithmetic, fallback nonzero RNG, truncation toward
zero in millimetre interpolation, the exact integer shield window and rational
slab comparisons (cross products), nearest intersection and smaller enemy ID on
exact distance ties. The camera's trigonometry/interpolation is not authority.
Wave transitions, repair timeout, reload/cooldown, rejected actions and the
10800-tick loss rule must match the source order. Static scenery is decorative.

`fixtures/terminal-vectors.json` contains complete envelope/canonical replay,
score/reason, canonical terminal state, stateHash and replayHash for:

- a real C1 exported winning run with damage, repair, reload and same-tick actions;
- a deterministic unattended terminal loss with surviving enemies in the state.

`fixtures/won-repair.json` preserves the source debug journal for audit. The
terminal test uses an independent Node SHA256/LP implementation for expected
vectors and checks JSON normalization, invalid order/arity/direction, rejected
commands, incomplete/trailing runs, immutable capture across await and UUID/hash
validation. To deliberately regenerate vectors after an approved codec change:

```
UPDATE_FPS_FIXTURES=1 node node_modules/vitest/vitest.mjs run src/games/barricade/fps/freeplay/terminal.test.ts --maxWorkers=1 --no-file-parallelism
```

Normal tests never regenerate them. A's Go conformance against these fixtures is
still required. No end-to-end publication or receipt is claimed.
