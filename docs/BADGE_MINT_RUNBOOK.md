# Badge Mint Runbook (Phase 2 / D2c — manual multisig batch-mint)

> GnoBuilders badges are minted by the `samcrew-core-test1` **multisig** (the
> realm owner/admin). The backend has no transaction signer by design, so badges
> are minted in periodic batches by an operator + the multisig signers. This is
> the deliberate test13 choice; a backend relayer / user-claim voucher model is
> the **mainnet** design (not built here).

## How the queue stays trustworthy

`badge_mints` rows are only enqueued from **verified** completions:
- `CompleteQuest` re-verifies on-chain server-side before recording (Phase 0.1), and
- self-report quests are recorded only after **admin approval** (`ReviewQuestClaim`).

So the queue contains no forged completions — the operator can drain it directly
without re-verifying each row.

## Procedure

1. **Get the prod DB** (read a snapshot of `memba.db` from the Fly volume, or run
   against it directly with care). Confirm `GNO_RPC_URL`/`QUEST_RPC_URL` point at
   test13 if verifying.

2. **List pending mints + emit the mint calls:**
   ```sh
   cd backend
   go run ./cmd/badge-mint -db /path/to/memba.db
   ```
   This prints one `gnokey maketx call` per pending row — `MintQuestBadge(to, questId, "")`
   for quest badges, `MintRankBadge(to, tier, "")` for `rank:N` rows.

3. **Sign + broadcast each call with the multisig.** Adapt the printed `gnokey`
   template to your multisig signing flow (M-of-N member signatures → broadcast).
   The realm dedupes per `(owner, questId)`, so a re-run is safe.

4. **Record the result** for each row:
   ```sh
   go run ./cmd/badge-mint -db /path/to/memba.db -mark-minted -id <id> -tx <txhash>
   # or, on failure:
   go run ./cmd/badge-mint -db /path/to/memba.db -mark-failed -id <id> -reason "..."
   ```

5. **Surface the badges:** set `VITE_ENABLE_BADGES=true` (repo-root `.env`) so
   `AchievementGrid` renders earned badges on profiles. Verify `TotalSupply()`
   grew and a badge shows for a test wallet.

## Still TODO before this is fully "done" (not autonomous-buildable)

- **Badge artwork → IPFS → tokenURI.** The mint calls pass an empty tokenURI.
  Generate per-category + per-rank SVGs, pin to IPFS (the backend already has an
  IPFS proxy), and either pass the CID at mint time or `UpdateTokenURI` after.
- The first ceremony requires the multisig signers to be available.

## Mainnet (separate plan — do NOT build on test13)
- Soulbound-all `gnobuilders_badges_v3` (+ `MintRankBadge` tier bounds, ported tests).
- A backend hot-key relayer (D2a) or a signed-voucher `ClaimBadge` model (D2b).
