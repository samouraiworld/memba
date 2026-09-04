# Block Party v1 operations and recovery

Date: 2026-09-04
Scope: daily challenge derivation, public reads, score delivery, local recovery, and incident triage

## Current production truth

The public Pearl frontend and backend are independently gated. On 2026-09-04 the frontend route was visible, while the backend returned Connect `unimplemented` / HTTP 501 because `BLOCKPARTY_ENABLED` was off. That is a configuration mismatch, not a not-ready challenge and not an empty leaderboard. Changing production flags remains an owner action.

The backend has four distinct outcomes that must not be collapsed:

| Surface | Healthy result | Empty/not ready | Dependency failure | Disabled |
| --- | --- | --- | --- | --- |
| Challenge | HTTP 200, `ready: true`, full provenance | HTTP 200, `ready: false` | Connect `internal` | Connect `unimplemented` |
| Leaderboard | HTTP 200 with entries | HTTP 200 with `entries: []` | Connect `internal` | Connect `unimplemented` |
| Streak | HTTP 200 with counters | HTTP 200 with zero counters for an unknown valid address | Connect `internal` | Connect `unimplemented` |
| Submit | HTTP 200 authoritative replay result | n/a | typed Connect error | Connect `unimplemented` |

Frontend v1 displays challenge, leaderboard, streak, and submission states independently. A failed leaderboard request must say unavailable; only a successful empty response may say there are no verified scores.

## Safe read-only probe

Set a task-specific API URL. Do not put tokens, wallet addresses, or move logs in terminal history or incident tickets.

```sh
export BP_API_URL="https://api.example.invalid"
export BP_DATE="2026-09-04"

curl --fail-with-body --silent --show-error \
  -H 'Content-Type: application/json' \
  --data "{\"date\":\"${BP_DATE}\"}" \
  "${BP_API_URL}/memba.v1.MultisigService/GetDailyChallenge"

curl --fail-with-body --silent --show-error \
  -H 'Content-Type: application/json' \
  --data "{\"date\":\"${BP_DATE}\",\"limit\":3}" \
  "${BP_API_URL}/memba.v1.MultisigService/GetDailyLeaderboard"
```

Expected challenge invariants when `ready: true`:

- `date` exactly matches the requested UTC date.
- `seed` is an unsigned 32-bit integer.
- `modifier` is `standard`, `doubles`, or `rush`.
- `moveBudget` is positive and matches the modifier's server rule.
- `blockHeight` is positive and `blockHash` is non-empty.
- The independent verifier below reproduces the height, hash, seed, modifier, par, and budget.

Do not use `SubmitScore` as a synthetic probe. It authenticates, consumes per-wallet quota, and establishes that wallet's immutable first submission for the UTC day.

## Seed provenance check

The backend intentionally uses one configured node and verifies its chain identity on `/status` and every `/block` response. It does not fail over because caching a seed from another chain would permanently falsify the daily proof.

Run the public verifier against an independent Pearl node:

```sh
node scripts/verify-blockparty-seed.mjs --selftest
node scripts/verify-blockparty-seed.mjs --date "${BP_DATE}"
```

Interpretation:

- Verifier exit 0 and matching API fields: provenance is consistent.
- Verifier exit 2: the selected node has not produced the qualifying block yet.
- Chain mismatch, missing hash, malformed block time, or unreachable RPC: dependency failure; do not substitute a different chain or manually create a challenge row.
- API `ready: false` while the independent Pearl node has a qualifying block: inspect the configured seed RPC's health and chain identity.
- API provenance differs from two agreeing independent Pearl nodes: disable Block Party and investigate before accepting submissions. Never rewrite an existing day's challenge in place.

The selected frontend navigation network is not authoritative seed provenance. Until the API carries a dedicated provenance field, UI copy must not claim that the selected frontend chain produced the seed. The server's configured and verified seed chain is the source of truth.

## Cache and offline behavior

Daily cache records use `bp:challenge:v1:<encoded-scope>:<UTC-date>`. A record is eligible only when all fields validate, its scope and date exactly match, and it is no more than 36 hours old. Legacy unscoped records are ignored. A cached record remains visibly distinguishable from a network response and must not be represented as freshly confirmed.

This fallback preserves deterministic play, not competitive availability:

- It never substitutes another date or network.
- It never caches `ready: false`.
- Server replay remains authoritative.
- A player can convert the cached seed into an explicitly unranked Practice board. The locked cached Daily board cannot accept input or be submitted until a fresh response confirms it live.

Local best and guest streak writes are progressive enhancement. Denied storage, quota exhaustion, and malformed records must not prevent play. Practice best is written monotonically as score increases, so a refresh or tab crash does not discard the best completed portion of a run. Older restored result views cannot rewind the guest streak.

## Submission delivery contract

The database remains first-write-wins for `(date, address)`; the schema and replay rules did not change. v1 makes delivery retry-safe:

- The first valid replay is inserted and is the leaderboard entry.
- An exact retry with the same authoritative score, move log, and final board hash returns success. This covers a lost HTTP response after the database commit.
- A different replay for that address/date returns `already_exists` and explicitly states that the first submission wins.
- Streak bumping is same-date idempotent, so an exact retry cannot double-count the day.
- Invalid characters, no-op padding, over-budget logs, non-today dates, failed authentication, and per-wallet rate limits continue to reject before scoring is accepted.

Client submission UI should retain the exact date and move log until it receives a definitive success or conflict, label the intermediate state as pending/checking, and offer a user-driven retry. It must not claim on-chain or attested status from replay success alone.

## Read-only database diagnostics

Use the platform's approved database access path and read-only mode. Never paste addresses or move logs into shared incident channels.

```sql
SELECT date, block_height, length(block_hash) AS hash_length, seed, modifier, par, created_at
FROM blockparty_challenges
WHERE date = '2026-09-04';

SELECT date, count(*) AS submissions, min(score) AS min_score, max(score) AS max_score
FROM blockparty_scores
WHERE date = '2026-09-04'
GROUP BY date;

SELECT count(*) AS malformed_challenges
FROM blockparty_challenges
WHERE block_height <= 0 OR block_hash = '' OR seed < 0 OR seed > 4294967295
   OR modifier NOT IN ('standard', 'doubles', 'rush') OR par < 0;
```

Do not delete, update, or reseed rows during incident triage. Challenge rows are immutable evidence. Any repair that would alter an issued daily requires a separate compatibility and fairness decision.

## Incident sequence

1. Record UTC time, public route, API host, HTTP status, Connect code, and which of the four surfaces failed. Avoid wallet identifiers and replay contents.
2. Run challenge and leaderboard read probes independently.
3. If disabled, confirm the intended flag state with the owner. Do not infer that a 501 is an RPC outage.
4. If challenge derivation fails, verify the configured node reports the expected chain and compare against the independent seed verifier.
5. If only leaderboard or streak fails, treat it as storage/read health; do not disable deterministic local Practice unnecessarily.
6. If exact score retries return conflict, compare only server-side hashes under restricted access. Never ask the user to publish their auth token or raw move log.
7. If provenance or replay integrity is uncertain, stop ranked submissions through the owner-controlled kill switch. Practice can remain available on the frontend.
8. Preserve logs and immutable rows, remediate in code/config through normal review, then rerun the checks below before owner re-enable.

## Release and recovery checks

```sh
export GOCACHE=/tmp/memba-blockparty-go-cache
cd backend
go test ./internal/blockparty ./internal/blockparty/engine ./internal/service

cd ../frontend
npm test -- --run src/game src/pages/BlockPartyGame.test.tsx
npx playwright test --project=chromium e2e/blockparty.spec.ts
npx playwright test --project=iphone --project=pixel e2e/mobile/blockparty.mobile.spec.ts
```

For legacy par reachability diagnostics, use `blockparty.SeedScoreCeiling` and the opt-in sweeps documented in `BLOCK_PARTY_FAIRNESS_2026-09-04.md`. Do not rewrite stored par mid-day. The UI may suppress an impossible target using the mirrored deterministic TypeScript ceiling while the response remains compatibility-stable.

Before release, also run the repository's full typecheck, lint, build, unit, deterministic-vector, CI-safety, color/theme, and `git diff --check` gates. Treat infrastructure timeouts and unrelated failures as blockers, not passes.

## Owner-only actions

The following are deliberately not automated by this runbook:

- changing `BLOCKPARTY_ENABLED`, seed RPC URL, or expected chain id;
- deleting or rewriting challenge, score, or streak rows;
- deploying, merging, or changing frontend flags;
- submitting a score with an operations wallet;
- performing admin, multisig, secret, or on-chain actions.

An owner may use the total backend kill switch as containment. Re-enable only after the configured node proves the intended chain, the challenge agrees with independent derivation, read surfaces are healthy, and focused tests pass.
