# escrow_v4 on gno.land mainnet: canary runbook

This is the owner-run procedure for the first real escrow contract on gno.land mainnet (`gnoland-1`), after the PR that allowlists `gno.land/r/samcrew/escrow_v4` is merged and before the Services lane is announced. Nothing in it is automated, and nothing in it is signed by CI or by Memba's backend.

The canary is one small contract between two owner-controlled wallets: one milestone of the realm's minimum amount, taken through Create, Fund, Complete, Release and Archive, with an on-chain read after every step.

## The realm

| | |
|---|---|
| Path | `gno.land/r/samcrew/escrow_v4` |
| Published | height 299934, tx `1lodnG2cv0gzOzIpbqJYefDUkNWQaL3AY1mwfYQUbFI=`, by the samcrew 2-of-3 `g136j0m08pkm2lwwde9dmlx8uee26llent9s5cpf` |
| Enabled | height 299936 |
| Realm address (holds escrowed coins) | `g12ltehxlya9pa6q3eneuz5d70sl89parkw0md40` |
| Admin, fallback fee recipient | the 2-of-3 above (`GetAdmin()`, `GetFeeRecipient()`) |
| Fee spine | `gno.land/r/samcrew/memba_market_config`: `GetFeeBPS("service")` = 200 (2 %), `GetTreasury()` = the 2-of-3 |
| Minimum milestone | 1,000 ugnot (`MinMilestoneAmount`) |
| Open contracts per client | 5 (`MaxActivePerClient`) |
| Pause | admin only. New contracts and funding stop until `Unpause`; every other state change stops for `MaxPauseBlks` = 183,273 blocks (about 7 days), then exits reopen on their own. After an `Unpause`, the next `Pause` is refused for another 183,273 blocks. |

State read on 2026-09-24 (about height 300737): not paused, `cooldownUntil` 0, `GetCreatedCount()` 0, `TotalLiabilities()` 0, realm balance empty, no pending admin or fee recipient.

## What Memba can and cannot do today

- The Services lane shows only when `VITE_ENABLE_SERVICES=true` (Netlify build env, owner-controlled) **and** `escrow_v4` is in `REALM_ALLOWLIST.mainnet`. Keep `VITE_ENABLE_MARKETPLACE_V2` off: the v2 Services lane renders the design seed catalogue, not real listings.
- The lane reads `GetPauseStateJSON()` and shows a banner when new contracts are refused (or when the read fails). The hire dialog refuses to sign in the same cases and when the client already holds 5 open contracts.
- The lane has **no listings** (`SERVICES = []`) and no "hire by address" form, so nobody can reach the hire dialog yet. There is **no Fund, Complete, Release, Dispute, Cancel or Claim button** either: the builders exist, the screens do not.
- What the UI does do: "Your escrow contracts" lists the connected client's contracts, looks one up by id, and offers **Archive** (client, settled contract) and **Expire** (anyone, never-funded contract past its `expireAt`).

So the canary signs Create, Fund, Complete and Release with `gnokey`, and does Archive from the Memba UI, which exercises Memba's own mainnet signing path once.

## Before you start

1. **Two single-key wallets you control**, neither of them the 2-of-3:
   - **C**, the client: needs about 3 GNOT (a 1,000 ugnot milestone, a storage deposit capped at 2.21 GNOT, gas).
   - **F**, the freelancer: needs about 0.1 GNOT for one call's gas.
   Keeping both away from the treasury address makes the 20 ugnot fee visible on its own.
2. **Check you are on mainnet.** An RPC that answers is not proof of the chain:
   ```sh
   curl -s https://rpc.gno.land:443/status | jq -r .result.node_info.network   # must print gnoland-1
   ```
3. **Record the baseline** (all reads below). Expected: not paused, created 0, live 0, active 0, archived 0, liabilities 0, realm balance empty, fee 200 bps, treasury = the 2-of-3. If `GetCreatedCount()` is not 0, the canary contract id is that number, not `0`: use it wherever this runbook says `0`.
4. Record the bank balances of C, F and the treasury.

### How to read

With `gnokey`:

```sh
R=https://rpc.gno.land:443
E=gno.land/r/samcrew/escrow_v4
gnokey query vm/qeval -remote $R -data "$E.GetPauseStateJSON()"
gnokey query vm/qeval -remote $R -data "$E.TotalLiabilities()"
gnokey query vm/qeval -remote $R -data "$E.GetCreatedCount()"
gnokey query vm/qeval -remote $R -data "$E.GetLiveCount()"
gnokey query vm/qeval -remote $R -data "$E.GetActiveCount()"
gnokey query vm/qeval -remote $R -data "$E.GetArchivedCount()"
gnokey query vm/qeval -remote $R -data "$E.GetClientActiveCount(\"<C>\")"
gnokey query vm/qeval -remote $R -data "$E.GetContractJSON(\"0\")"
gnokey query vm/qeval -remote $R -data "$E.GetClientContractsJSON(\"<C>\", \"\", 20)"
gnokey query vm/qeval -remote $R -data 'gno.land/r/samcrew/memba_market_config.GetFeeBPS("service")'
gnokey query vm/qeval -remote $R -data 'gno.land/r/samcrew/memba_market_config.GetTreasury()'
gnokey query bank/balances/g12ltehxlya9pa6q3eneuz5d70sl89parkw0md40 -remote $R
```

Without `gnokey`, the same reads go through `abci_query`; the `data` parameter **must be base64**:

```sh
q() { curl -s "$R" -H 'content-type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"abci_query\",\"params\":{\"path\":\"vm/qeval\",\"data\":\"$(printf '%s' "$1" | base64 | tr -d '\n')\"}}" | jq -r '.result.response.ResponseBase.Data' | base64 -d; echo; }
q "$E.GetPauseStateJSON()"
```

Transaction results (events, storage deposit) are in `block_results?height=<h>` for the height the broadcast reports.

### Budgets

The gas limits and deposit caps below are what Memba's builders compute for these exact arguments (`frontend/src/lib/marketplace/escrowBudget.ts`; if they ever disagree, that file wins). The gas fee is 1 ugnot per 1,000 gas. The chain locks only the storage a call really adds; `-max-deposit` is a ceiling. Check the flag names against `gnokey maketx call -h` for the binary you use.

| Call | Signer | `-gas-wanted` | `-gas-fee` | `-max-deposit` | `-send` |
|---|---|---:|---:|---:|---:|
| CreateContract | C | 39000000 | 39000ugnot | 2210000ugnot | |
| FundMilestone | C | 32000000 | 32000ugnot | 200000ugnot | 1000ugnot |
| CompleteMilestone | F | 32000000 | 32000ugnot | 200000ugnot | |
| ReleaseFunds | C | 37000000 | 37000ugnot | 200000ugnot | |
| ArchiveContract | C (Memba UI) | 39000000 | set by Memba | 200000ugnot | |

Common flags: `-pkgpath gno.land/r/samcrew/escrow_v4 -broadcast -chainid gnoland-1 -remote https://rpc.gno.land:443`.

## Step 1: Create (C, gnokey)

```sh
gnokey maketx call -pkgpath $E -func CreateContract \
  -args "<F>" -args "escrow_v4 canary" -args "mainnet canary" -args "canary:1000" \
  -gas-wanted 39000000 -gas-fee 39000ugnot -max-deposit 2210000ugnot \
  -broadcast -chainid gnoland-1 -remote $R <C-key>
```

Expected after it lands:

- The tx result carries a `ContractCreated` event (`id` "0", client C, freelancer F, milestones "1") and a storage-deposit event for about 6,700 bytes (about 0.67 GNOT locked from C; the cap is 2.21 GNOT).
- `GetCreatedCount()` 1, `GetLiveCount()` 1, `GetActiveCount()` 1, `GetClientActiveCount(C)` 1.
- `GetContractJSON("0")`: `"exists":true`, `"status":"active"`, client C, freelancer F, one milestone `{"index":"0","title":"canary","amountUgnot":"1000","status":"pending",…}`, `"fundedAtHeight":null`, `"expireAt"` = creation height + 864,000, totals `amountUgnot` "1000", `escrowedUgnot` "0".
- `GetClientContractsJSON(C, "", 20)`: `{"items":[{"id":"0","status":"active","createdAtHeight":"<h>"}],"next":null}`.
- `TotalLiabilities()` 0. Realm balance unchanged (empty).
- UI (with the flag on, wallet C connected, network mainnet): the Services tab shows, no paused banner, and "Your escrow contracts" lists `#0` with `active · created at block <h>`.

## Step 2: Fund (C, gnokey)

```sh
gnokey maketx call -pkgpath $E -func FundMilestone -args "0" -args "0" -send 1000ugnot \
  -gas-wanted 32000000 -gas-fee 32000ugnot -max-deposit 200000ugnot \
  -broadcast -chainid gnoland-1 -remote $R <C-key>
```

The call must be a direct user call that sends exactly the milestone amount; anything else is refused.

Expected:

- `MilestoneFunded` event (`contractId` "0", `milestone` "0", `amount` "1000").
- Milestone `"status":"funded"`, `fundedAtHeight` set, `refundAt` = funded height + 864,000. Contract `expireAt` becomes `null`, totals `escrowedUgnot` "1000".
- `TotalLiabilities()` **1000**. Realm balance **1000ugnot**: the balance must never be below `TotalLiabilities()`.

## Step 3: Complete (F, gnokey)

```sh
gnokey maketx call -pkgpath $E -func CompleteMilestone -args "0" -args "0" \
  -gas-wanted 32000000 -gas-fee 32000ugnot -max-deposit 200000ugnot \
  -broadcast -chainid gnoland-1 -remote $R <F-key>
```

Expected: `MilestoneCompleted` event (freelancer F). Milestone `"status":"completed"`, `completedAtHeight` set, its `refundAt` back to `null`. `TotalLiabilities()` still 1000, realm balance still 1000ugnot.

## Step 4: Release (C, gnokey)

```sh
gnokey maketx call -pkgpath $E -func ReleaseFunds -args "0" -args "0" \
  -gas-wanted 37000000 -gas-fee 37000ugnot -max-deposit 200000ugnot \
  -broadcast -chainid gnoland-1 -remote $R <C-key>
```

Expected:

- `FundsReleased` event: `amount` **980**, `fee` **20**, `bps` **200**, `treasury` = `GetTreasury()` (the 2-of-3), `status` **completed**. The fee is floor(1,000 × 200 / 10,000) = 20 ugnot.
- F's balance +980 ugnot; the treasury's +20 ugnot (compare with the baseline; the event is the proof if the treasury moved for another reason).
- Milestone `"status":"released"`, contract `"status":"completed"`, totals `releasedUgnot` "1000", `escrowedUgnot` "0".
- `TotalLiabilities()` **0**, realm balance back to empty. `GetActiveCount()` 0, `GetClientActiveCount(C)` 0. `GetLiveCount()` still 1: the contract stays stored until archived.

## Step 5: Archive (C, Memba UI)

In Memba on mainnet, connected as C: Marketplace, Services, "Your escrow contracts", open `#0`. The panel offers **Archive and reclaim deposit (~0.68 GNOT)** (Memba's estimate for this contract). Sign it in the wallet and check that the wallet shows `ArchiveContract` on `gno.land/r/samcrew/escrow_v4` with a 0.2 GNOT deposit cap and no coins sent.

If the UI does not offer the button, stop and archive with gnokey instead (`-func ArchiveContract -args "0"`, `-gas-wanted 39000000 -gas-fee 39000ugnot -max-deposit 200000ugnot`), then investigate the UI.

Expected:

- `ContractArchived` event: `status` completed, `milestoneReleasedTotal` "1000", `milestoneRefundedTotal` "0", a `contentHash`.
- A storage-unlock event refunding the freed deposit **to C**, close to what Create locked (the small growth Fund, Complete and Release added was paid by their own signers).
- `GetContractJSON("0")` = `{"exists":false,"id":"0"}`. `GetClientContractsJSON(C, "", 20)` = `{"items":[],"next":null}`.
- `GetLiveCount()` 0, `GetArchivedCount()` 1, `GetCreatedCount()` 1 (ids are never reused), `GetActiveCount()` 0, `TotalLiabilities()` 0, realm balance empty.
- The panel says the contract was archived, and "My contracts" is empty again.

The canary passes when every expectation above held. Only then announce the lane.

## Stop conditions

Stop, do not continue to the next step, and do not announce the lane if any of these happens:

- a tx fails for a reason this runbook does not predict, or a wallet shows a different realm, function, amount or deposit cap than the one above;
- `TotalLiabilities()` differs from the sum of funded, completed and disputed milestones, or the realm balance is ever below `TotalLiabilities()`;
- the fee is not 20 ugnot, the bps is not 200, or the treasury is not `GetTreasury()`;
- `GetPauseStateJSON()` reports paused, or `GetAdmin()`, `GetPendingAdmin()`, `GetFeeRecipient()` or `GetPendingFeeRecipient()` differ from the baseline;
- a storage deposit is far above the table's cap estimate, or the archive refund goes to anyone but C;
- the UI shows a contract to the wrong wallet, the wrong network, or a paused banner while the realm is not paused.

## Rollback

From least to most disruptive:

1. **Hide the lane.** Set `VITE_ENABLE_SERVICES` off in Netlify and redeploy. The Services tab and every escrow screen disappear; no funds move, and contracts stay on chain, callable with gnokey.
2. **Pause the realm.** The admin (the publisher 2-of-3) signs a `Pause` MsgCall on `gno.land/r/samcrew/escrow_v4` (no arguments, nothing sent). CreateContract and FundMilestone are refused until `Unpause`; every other state change is refused for 183,273 blocks (about 7 days), after which exits reopen by themselves so funds are never stuck. Unpausing starts a 183,273-block cooldown before the next `Pause`, so pause only for a real incident. Memba's lane then shows the paused banner and the hire dialog refuses to sign.
3. **Remove the allowlist entry** by reverting the go-live PR. Memba stops offering any escrow call on mainnet; the realm itself is unaffected.

Getting the canary contract itself out of a stuck state (client C unless noted):

- created, not funded: `CancelContract("0")` settles it as cancelled with no coins moved, then `ArchiveContract("0")` returns the deposit;
- funded, not completed: `CancelContract("0")` refunds 950 ugnot to C and pays the 5 % cancellation fee (50 ugnot) to F;
- completed, not released: `ReleaseFunds` as in step 4, or `CancelContract("0")`, which pays the completed milestone to F minus the 2 % fee;
- disputed: the admin resolves it with `ResolveDispute`, or anyone may call `ClaimDisputeTimeout` after 806,400 unpaused blocks.

## What to monitor after go-live

Memba's metrics do not scrape the realm, so these are manual reads (daily for the first week, then weekly):

| Read | Healthy |
|---|---|
| `GetPauseStateJSON()` | `"paused":false` unless an incident is open |
| `TotalLiabilities()` vs `bank/balances/g12ltehxlya9pa6q3eneuz5d70sl89parkw0md40` | balance ≥ liabilities, always |
| `GetCreatedCount()`, `GetLiveCount()`, `GetActiveCount()`, `GetArchivedCount()` | created = live + archived; active ≤ live |
| `GetAdmin()`, `GetPendingAdmin()`, `GetFeeRecipient()`, `GetPendingFeeRecipient()` | the 2-of-3, empty, the 2-of-3, empty, unless a rotation is under way |
| `memba_market_config.GetFeeBPS("service")`, `GetTreasury()` | 200 and the 2-of-3, unless the DAO changed them on purpose |

A disputed milestone needs the admin: watch for `RaiseDispute` events on the realm and resolve within `AutoResolveBlks` (806,400 unpaused blocks, about 31 days), after which anyone can claim the timeout outcome.
