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

1. **Generate + pin the badge assets** (one-time; re-run only when the quest
   catalog or rank tiers change). This writes the on-chain `tokenURI` targets:
   per-category + per-rank SVG art and one metadata JSON per quest/rank.
   ```sh
   cd frontend
   npx tsx scripts/gen-badge-assets.ts /tmp/badge-assets
   ```
   This writes to `/tmp/badge-assets/`: `quest-<category>.svg` (4),
   `rank-<tier>.svg` (7), and `<questId>.json` / `rank-<tier>.json` metadata
   (each metadata's `image` is a **relative sibling** SVG, so the whole set must
   be pinned as **one directory**).

   Pin that directory to IPFS — as a directory, preserving filenames — and note
   the **directory CID**:
   ```sh
   # e.g. via the kubo CLI, or any pinning service that keeps the dir structure:
   ipfs add -r -Q /tmp/badge-assets        # prints the directory CID
   ```
   The mint base URI is then `ipfs://<dir-CID>`. (The art the app renders on
   profiles is generated programmatically in-browser by `AchievementGrid`/
   `badgeArt.ts`, independent of this tokenURI — the pinned assets are for
   external/on-chain metadata consumers.)

2. **Get the prod DB** (read a snapshot of `memba.db` from the Fly volume, or run
   against it directly with care). Confirm `GNO_RPC_URL`/`QUEST_RPC_URL` point at
   test13 if verifying.

3. **List pending mints + emit the mint calls** (pass the pinned base so each
   mint carries its `tokenURI`):
   ```sh
   cd backend
   go run ./cmd/badge-mint -db /path/to/memba.db -metadata-base ipfs://<dir-CID>
   ```
   This prints one `gnokey maketx call` per pending row —
   `MintQuestBadge(to, questId, "ipfs://<CID>/<questId>.json")` for quest badges,
   `MintRankBadge(to, tier, "ipfs://<CID>/rank-<tier>.json")` for `rank:N` rows.
   Omit `-metadata-base` to mint with an empty tokenURI and set it later via the
   realm's `UpdateTokenURI`.

4. **Sign + broadcast each call with the multisig.** Adapt the printed `gnokey`
   template to your multisig signing flow (M-of-N member signatures → broadcast).
   The realm dedupes per `(owner, questId)`, so a re-run is safe.

5. **Record the result** for each row:
   ```sh
   go run ./cmd/badge-mint -db /path/to/memba.db -mark-minted -id <id> -tx <txhash>
   # or, on failure:
   go run ./cmd/badge-mint -db /path/to/memba.db -mark-failed -id <id> -reason "..."
   ```

6. **Surface the badges:** set `VITE_ENABLE_BADGES=true` (repo-root `.env`) so
   `AchievementGrid` renders earned badges on profiles. Verify `TotalSupply()`
   grew and a badge shows for a test wallet.

## Still TODO before this is fully "done" (not autonomous-buildable)

- **Pin the generated assets to a durable IPFS provider.** The pipeline (step 1)
  produces the SVGs + metadata, but the actual pin (a CID that stays online)
  needs a real pinning service / the backend IPFS proxy — done once per catalog
  version by the operator.
- The first ceremony requires the multisig signers to be available.

## Mainnet (separate plan — do NOT build on test13)
- Soulbound-all `gnobuilders_badges_v3` (+ `MintRankBadge` tier bounds, ported tests).
- A backend hot-key relayer (D2a) or a signed-voucher `ClaimBadge` model (D2b).
