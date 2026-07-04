# Activity Bot Runbook (W7.3) — TESTNET ONLY

`cmd/activitybot` generates bounded, testnet-only on-chain activity so the Memba
feed/marketplace don't look like a ghost town during the launch window. It is
**not** a production system and must never run against mainnet or hold mainnet
funds.

## Safety model (why this is safe)

- **No private key in Go.** Like `badge-mint`, the bot never loads a raw key. It
  plans a bounded batch and either prints `gnokey maketx` commands (default,
  dry-run) or shells out to `gnokey` (`--broadcast`) using a key referenced by
  **name** from gnokey's keyring. The throwaway key lives only in gnokey's
  keyring / a `flyctl` secret — never in the repo, never in an env var read by
  Go.
- **Kill switch.** `ACTIVITYBOT_ENABLED` must equal `"true"`. Anything else and
  the bot logs "disabled" and exits `0` — so a scheduled job is a clean no-op
  until you explicitly turn it on, and turning it off is a one-line change.
- **Hard rails (compile-time constants, not flags):**
  - `MaxActionsPerRun = 25` — one invocation can never do more.
  - `MaxTransfersPerDay = 100` — value-moving actions across a rolling UTC day,
    tracked in the `--state` JSON file so a frequent schedule can't exceed it.
  - `MaxTransferUgnot = 1_000_000` (1 GNOT) — caps any single transfer.
  - `MaxGasWanted` / `MaxGasFeeUgnot` — per-tx gas ceilings.
- **Clean exit.** The run stops at the first broadcast error and never panics
  mid-batch; the day counter only advances for value-moving actions that were
  actually sent, and the state file is persisted even on error.

## One-time setup (owner)

1. **Generate a fresh throwaway key for test13** (never reuse an existing key):
   ```sh
   gnokey add activitybot --recover   # or generate; record the mnemonic offline
   ```
   Log the public address it prints — that is the bot wallet.
2. **Fund it from the faucet only**, to faucet scale (a few GNOT). The bot wallet
   must never hold more than faucet-scale funds; if it accumulates, sweep the
   excess back.
3. **Store the key material only in a secret**, never in the repo:
   ```sh
   flyctl secrets set ACTIVITYBOT_PRIVKEY="<mnemonic-or-armor>"   # consumed by the deploy's gnokey import, not by Go
   ```
   On the runner, import it into gnokey's keyring as `activitybot` before the bot
   runs (e.g. in the job's setup step). The Go binary only ever sees the key
   *name*.

## Running it

Dry-run (safe anywhere — prints the commands, sends nothing):
```sh
go run ./cmd/activitybot -scenario cmd/activitybot/scenario.example.json
# → "disabled" unless ACTIVITYBOT_ENABLED=true; then prints gnokey commands
```

Broadcast (testnet, key must be in gnokey's keyring as `activitybot`):
```sh
ACTIVITYBOT_ENABLED=true go run ./cmd/activitybot \
  -scenario scenario.json -broadcast -key activitybot \
  -state /var/lib/activitybot/state.json
```

Edit `scenario.json` (see `scenario.example.json`) to control what activity is
produced. `feed_post` actions need `feedRealm` set to the deployed feed realm
(`memba_feed_v1` is owner-deployed; until then, use only `transfer` actions or
leave feed posts out). `transfer` actions move faucet-scale ugnot between
throwaway addresses.

## Scheduling — Fly has NO declarative cron

`fly.toml` cannot express a cron schedule, so pick one:

- **GitHub Actions `schedule:`** (recommended) — a workflow that checks out,
  installs gnokey, imports `ACTIVITYBOT_PRIVKEY` into the keyring, and runs the
  bot with `ACTIVITYBOT_ENABLED=true`. Persist `state.json` as an artifact/cache
  so the daily counter survives across runs.
- **`fly machines run`** — a one-shot machine invoked on a schedule from an
  external trigger.
- **Manual** — run it by hand during a launch push.

> ⚠️ **Exactly one scheduler — never run two concurrently.** The daily-cap
> counter in `state.json` is a read-modify-write with no lock, so two overlapping
> runs are last-write-wins and can exceed `MaxTransfersPerDay`. On GitHub Actions,
> set a `concurrency:` group on the workflow so a new run cancels/queues rather
> than overlapping a previous one, and treat the persisted `state.json` as owned
> by that single serialized job.

## Known limitations (bounded, testnet-acceptable)

- **UTC midnight straddle.** The day is stamped at process start, so a run that
  crosses 00:00 UTC records all its transfers under the starting day; the next
  run then sees a new day and resets the counter. Worst case you send up to
  `MaxActionsPerRun` (25) extra value-moving actions around the boundary — bounded
  and faucet-scale. Schedule away from the UTC midnight minute if it matters.
- **Dry-run output is illustrative, not verbatim-pasteable.** The printed
  `gnokey …` lines single-quote args with spaces but do not escape embedded
  single quotes, so a body like `it's live` won't paste cleanly into a shell. The
  actual `--broadcast` path builds the argv directly (no shell), so this affects
  only hand-copying the dry-run preview.

## Rotation & incident response

- **Disable immediately:** unset `ACTIVITYBOT_ENABLED` (or set it to anything but
  `"true"`). The next scheduled run is a clean no-op.
- **Rotate the key:** disable → generate a new `activitybot` key → refund the old
  wallet's excess to the faucet/treasury → update the `ACTIVITYBOT_PRIVKEY`
  secret → re-enable. Do this monthly or after any incident.
- The bot wallet is disposable by design — if it's ever compromised, the blast
  radius is at most `MaxTransfersPerDay * MaxTransferUgnot` of faucet funds.

## Definition of done (verify before leaving it running)

- A 24h run produces visible feed/marketplace activity, **zero errors**.
- The bot wallet holds **only faucet funds**.
- The kill switch verified: with `ACTIVITYBOT_ENABLED` unset, a run is a no-op.
