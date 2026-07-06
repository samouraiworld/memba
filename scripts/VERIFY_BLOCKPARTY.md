# Verifying the Block Party daily seed

Block Party's daily board is generated from a deterministic seed. This
document explains, honestly, what that does and does not guarantee, and how
to check it yourself.

## What "verifiably un-rigged" actually means here

A spike proved a Gno realm cannot compute this seed on-chain (no verifiable
randomness primitive available to a realm today), so the seed is derived
**off-chain**, by the backend, from a **public** input: the hash of a Gno
block that nobody — including us — could have pre-picked.

Concretely:

- Every day has a "qualifying block": the lowest-height block on the public
  test13 chain whose header time is `>= 00:00:00 UTC` of that date.
- The seed is `SHA256(blockHash + "blockparty:" + date)`, truncated to the
  first 4 bytes, read as a big-endian `uint32`.
- The modifier (`standard` / `doubles` / `rush`), par score, and move budget
  are all pure functions of that seed.

Because the qualifying block is selected by a rule anyone can apply
themselves (not "whichever block we felt like"), and its hash is public chain
data that existed before we could have known which block would land first
after midnight, **nobody — including the Memba team — can choose today's
board in advance.** That is the specific, narrow claim this script lets you
check.

### What this does NOT prove

- **It does not make the leaderboard trustless.** In v1, scores are computed
  server-side from a submitted move log (`SubmitScore` replays the moves
  against the seeded board and derives the score itself) — the server is
  trusted to replay and record honestly. This script only proves the *board*
  wasn't hand-picked; it says nothing about score integrity or leaderboard
  correctness.
- **It does not verify the backend's storage/caching layer.** The backend
  caches the challenge for a date on first request (immutable thereafter).
  This script re-derives the seed independently from chain data; it doesn't
  inspect the backend's database.
- **It relies on you trusting the public RPC node you query** (or trusting
  that multiple independent public nodes agree, which you can check by
  passing `--rpc` for more than one node).

## Running the script

```sh
# Today's board (UTC), against the default public test13 RPC:
node scripts/verify-blockparty-seed.mjs

# A specific date:
node scripts/verify-blockparty-seed.mjs --date 2026-07-06

# Against a different public RPC node (e.g. to cross-check two nodes agree):
node scripts/verify-blockparty-seed.mjs --date 2026-07-06 --rpc https://test13.rpc.onbloc.xyz

# Sanity-check the derivation itself against a hardcoded known-good vector
# (no network access, verifies the JS math hasn't drifted from the Go source
# of truth in backend/internal/blockparty/seed.go):
node scripts/verify-blockparty-seed.mjs --selftest
```

Requires Node 18+ (uses built-in `fetch`); no npm dependencies.

**Note on RPC hosts:** The backend derives the seed from its own public test13 RPC (default `https://rpc.testnet13.samourai.live:443`), while this script defaults to `https://rpc.test13.testnets.gno.land`. Both are public test13 nodes and should agree — that cross-node agreement is precisely the verification point. You can pass `--rpc` to check against another public node and confirm they derive the same seed.

### Reading the output

The script prints:

```
blockHeight, blockHash, blockTime   — the qualifying block it found
seed, modifier, par, moveBudget     — derived from that block + date
```

Compare `seed`, `blockHeight`, `blockHash`, `modifier`, `par`, and
`moveBudget` against the same fields in the backend's `GetDailyChallenge` RPC
response for the same date. If they match, the backend derived the board the
same way anyone else could have — it did not substitute a different block or
a different formula.

### Not-ready days

If the chain tip hasn't reached midnight UTC yet (rare, but possible right at
the day boundary, or on a stalled node), the script prints a clear `NOT
READY` message and exits with status code `2` rather than guessing. Try again
in a minute, or against a different public RPC node.

## Source of truth

This script is a byte-accurate reimplementation of:

- `backend/internal/blockparty/seed.go` — `DeriveSeed`, `DeriveModifier`, `DerivePar`
- `backend/internal/blockparty/blockselect.go` — `SelectDailyBlock`
- `backend/internal/blockparty/budget.go` — `MoveBudget`

If the backend's derivation ever changes, this script (and its `--selftest`
vector) must be updated in the same change, or the "verifiable" claim becomes
false.

## Live-node wire-format handling (fixed)

The real public test13 RPC nests the block hash under
`result.block_meta.block_id.hash` in the `/block?height=N` response — the
top-level `result.block_id` key is not present on that node's response shape.
This script reads `block_meta.block_id.hash` (with a top-level fallback), and
the backend's `httpBlockFetcher.BlockAt`
(`backend/internal/service/blockparty_chain.go`) now does the same **and
fails loud if no block hash is present** rather than silently deriving the
seed from an empty hash. This parse is guarded by
`backend/internal/service/blockparty_chain_test.go`
(`TestHttpBlockFetcher_ParsesRealWireFormat`, `TestHttpBlockFetcher_EmptyHashFailsLoud`),
which exercise the real wire shape end-to-end — the gap that previously let
this ship unnoticed was that every earlier test mocked the fetcher. So the
backend and this script now derive the same seed from the same live-node
field.
