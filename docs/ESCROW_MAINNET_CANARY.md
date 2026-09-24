# escrow_v4 on gno.land mainnet: canary runbook

This is the owner-run procedure for the first real escrow contract on gno.land mainnet (`gnoland-1`), after the PR that allowlists `gno.land/r/samcrew/escrow_v4` is merged and before the Services lane is announced. Nothing in it is automated, and nothing in it is signed by CI or by Memba's backend.

The canary is one small contract between the owner's two personal single-key wallets, one acting as client and one as freelancer: one milestone of the realm's minimum amount (0.001 GNOT), taken through Create, Fund, Complete, Release and Archive in the Memba UI, with an on-chain read after every step. Each step also gives the `gnokey` command to use instead if the UI misbehaves.

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

## What Memba does

- The Services lane shows only when `VITE_ENABLE_SERVICES=true` (Netlify build env, owner-controlled) **and** `escrow_v4` is in `REALM_ALLOWLIST.mainnet`. Keep `VITE_ENABLE_MARKETPLACE_V2` off: the v2 Services lane renders the design seed catalogue, not real listings.
- The lane reads `GetPauseStateJSON()` and shows a banner when new contracts are refused (or when the read fails). **Hire by address** (lane header) opens a form: freelancer address (checksum-checked), title, description, milestones in GNOT. It checks everything the realm checks and states what creating the contract commits (per-milestone escrow, the storage deposit and its refund on archive, the fee at release, the 5-contract cap). The hire dialog then re-reads the pause state and the client's open contracts, and signs.
- After CreateContract lands, Memba reads the new contract back and opens its page, `/mainnet/marketplace/services/contract/<id>`, with a **Share this link with your freelancer** box. escrow_v4 indexes contracts by client only, so this link is how the freelancer reaches the contract. On mainnet the lane also lists "Contracts where you are the freelancer", found through the tx-indexer's `ContractCreated` events and read back from the realm; it is best effort, the link is not.
- A contract's page shows what `GetContractJSON` returns (both addresses in full, milestones with status, amounts and deadlines, totals) and only the calls the connected wallet can make in that state, as the realm's guards allow them: client Fund / Release / Dispute / Cancel / Archive, freelancer Mark delivered / Dispute, anyone Refund / Settle expired dispute / Expire once the realm's pause-adjusted deadline has passed. While paused, funding is refused and every other call waits for the end of the blocking window.
- Every call goes through Memba's confirmation dialog (function, arguments, deposit cap, coins sent) and then the wallet. Nothing is re-sent automatically. If the outcome is unknown, the page offers no call until the contract has been reloaded.

## Before you start

1. **The owner's two personal single-key wallets**, neither of them the 2-of-3, both in Adena (or in two browser profiles):
   - **C**, the client: needs about 3 GNOT (a 1,000 ugnot milestone, a storage deposit capped at 2.21 GNOT, gas).
   - **F**, the freelancer: needs about 0.1 GNOT for one call's gas.
   Keeping both away from the treasury address makes the 20 ugnot fee visible on its own. In Adena, check that the network is gno.land mainnet (`gnoland-1`) on a `*.gno.land` RPC: Memba refuses to sign otherwise.
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

### Budgets (for the gnokey fallback)

Memba computes these itself; the confirmation dialog shows the deposit cap and the coins sent, and they must match this table. The gas limits and deposit caps below are what Memba's builders compute for these exact arguments (`frontend/src/lib/marketplace/escrowBudget.ts`; if they ever disagree, that file wins). The gas fee is 1 ugnot per 1,000 gas. The chain locks only the storage a call really adds; `-max-deposit` is a ceiling. Check the flag names against `gnokey maketx call -h` for the binary you use.

| Call | Signer | `-gas-wanted` | `-gas-fee` | `-max-deposit` | `-send` |
|---|---|---:|---:|---:|---:|
| CreateContract | C | 39000000 | 39000ugnot | 2210000ugnot | |
| FundMilestone | C | 32000000 | 32000ugnot | 200000ugnot | 1000ugnot |
| CompleteMilestone | F | 32000000 | 32000ugnot | 200000ugnot | |
| ReleaseFunds | C | 37000000 | 37000ugnot | 200000ugnot | |
| ArchiveContract | C | 39000000 | 39000ugnot | 200000ugnot | |

Common flags: `-pkgpath gno.land/r/samcrew/escrow_v4 -broadcast -chainid gnoland-1 -remote https://rpc.gno.land:443`.

## Step 1: Create (wallet C)

**In Memba**, connected as C, network mainnet: Marketplace, Services. Check that no paused banner shows, then **Hire by address**:

- Freelancer address: F (paste it; a typo fails the checksum check).
- Title `Escrow v4 canary`, description `mainnet canary`.
- One milestone: title `canary`, amount `0.001`.

The form should show "Total to fund, one milestone at a time: 0.001 GNOT" and a storage deposit of up to 2.21 GNOT. **Review and sign**, check the dialog (Milestones `canary — 0.001 GNOT`, storage deposit cap 2.21 GNOT), **Sign Escrow Tx**, then in the confirmation dialog check `CreateContract` on `gno.land/r/samcrew/escrow_v4`, the arguments `<F>`, `Escrow v4 canary`, `mainnet canary`, `canary:1000`, no coins sent, and **Confirm & Broadcast**. Sign in the wallet.

Memba should land on `/mainnet/marketplace/services/contract/0` with "Contract 0 is created" and **Share this link with your freelancer**. Copy the link. If it instead says the contract could not be read back yet, open it from "My contracts" in the lane; never create it a second time before checking.

Fallback (gnokey):

```sh
gnokey maketx call -pkgpath $E -func CreateContract \
  -args "<F>" -args "Escrow v4 canary" -args "mainnet canary" -args "canary:1000" \
  -gas-wanted 39000000 -gas-fee 39000ugnot -max-deposit 2210000ugnot \
  -broadcast -chainid gnoland-1 -remote $R <C-key>
```

(Keep every text free of underscores, brackets, parentheses, `#`, `*`, backticks, `!`, `<`, `>`, `|`, backslashes, `~`, tabs and line breaks: the realm strips them, so the stored text would differ from the signed text. Memba's form refuses them for that reason.)

Expected after it lands:

- The tx result carries a `ContractCreated` event (`id` "0", client C, freelancer F, milestones "1") and a storage-deposit event for about 6,700 bytes (about 0.67 GNOT locked from C; the cap is 2.21 GNOT).
- `GetCreatedCount()` 1, `GetLiveCount()` 1, `GetActiveCount()` 1, `GetClientActiveCount(C)` 1.
- `GetContractJSON("0")`: `"exists":true`, `"status":"active"`, client C, freelancer F, one milestone `{"index":"0","title":"canary","amountUgnot":"1000","status":"pending",…}`, `"fundedAtHeight":null`, `"expireAt"` = creation height + 864,000, totals `amountUgnot` "1000", `escrowedUgnot` "0".
- `GetClientContractsJSON(C, "", 20)`: `{"items":[{"id":"0","status":"active","createdAtHeight":"<h>"}],"next":null}`.
- `TotalLiabilities()` 0. Realm balance unchanged (empty).
- UI: the contract page shows Client C (you) and Freelancer F in full, milestone 1 `canary — 0.001 GNOT`, "Not funded", Total 0.001 GNOT, In escrow 0 GNOT, and for C only **Fund milestone (0.001 GNOT)**, **Cancel contract** and a disabled **Expire unfunded contract** naming the `expireAt` block. "My contracts" in the lane lists `#0` with `active · created at block <h>`.

## Step 2: Fund (wallet C)

**In Memba**, on the contract page as C: **Fund milestone (0.001 GNOT)**. The confirmation dialog must show `FundMilestone`, arguments `0`, `0`, Send `1000ugnot` and a 0.2 GNOT deposit cap. Confirm and sign.

Fallback (gnokey):

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
- UI: "Milestone 1 of contract 0 is funded.", the milestone reads "Funded, in escrow" with "refundable by anyone from block …", In escrow 0.001 GNOT. C now sees **Raise dispute** and **Cancel contract**, and a disabled **Refund to client** naming the `refundAt` block.

## Step 3: Complete (wallet F)

**In Memba**, switch Adena to F (or open the shared link in F's browser profile) and open the link from step 1. The page must say Freelancer (you) and offer **Mark delivered** and **Raise dispute**, and nothing of the client's (no Fund, Release or Cancel). **Mark delivered**; the dialog must show `CompleteMilestone`, arguments `0`, `0`, no coins sent. Confirm and sign.

Also check discovery: in the Services lane, connected as F, "Contracts where you are the freelancer" should list `#0` (it comes from the tx-indexer, so allow a few blocks). If it does not, note it; the link is the supported path.

Fallback (gnokey):

```sh
gnokey maketx call -pkgpath $E -func CompleteMilestone -args "0" -args "0" \
  -gas-wanted 32000000 -gas-fee 32000ugnot -max-deposit 200000ugnot \
  -broadcast -chainid gnoland-1 -remote $R <F-key>
```

Expected: `MilestoneCompleted` event (freelancer F). Milestone `"status":"completed"`, `completedAtHeight` set, its `refundAt` back to `null`. `TotalLiabilities()` still 1000, realm balance still 1000ugnot. UI: the milestone reads "Delivered, awaiting release".

## Step 4: Release (wallet C)

**In Memba**, back as C on the contract page: **Release payment**. The dialog must show `ReleaseFunds`, arguments `0`, `0`, no coins sent. Confirm and sign.

Fallback (gnokey):

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
- UI: "Released to the freelancer", Released 0.001 GNOT, and C is offered **Archive and reclaim deposit (~0.68 GNOT)** only.

## Step 5: Archive (wallet C)

**In Memba**, as C on the contract page: **Archive and reclaim deposit (~0.68 GNOT)** (Memba's estimate for this contract). The dialog must show `ArchiveContract` on `gno.land/r/samcrew/escrow_v4`, argument `0`, a 0.2 GNOT deposit cap and no coins sent. Confirm and sign.

Fallback (gnokey): `-func ArchiveContract -args "0"`, `-gas-wanted 39000000 -gas-fee 39000ugnot -max-deposit 200000ugnot`. If the UI does not offer the button, archive this way, then investigate the UI.

Expected:

- `ContractArchived` event: `status` completed, `milestoneReleasedTotal` "1000", `milestoneRefundedTotal` "0", a `contentHash`.
- A storage-unlock event refunding the freed deposit **to C**, close to what Create locked (the small growth Fund, Complete and Release added was paid by their own signers).
- `GetContractJSON("0")` = `{"exists":false,"id":"0"}`. `GetClientContractsJSON(C, "", 20)` = `{"items":[],"next":null}`.
- `GetLiveCount()` 0, `GetArchivedCount()` 1, `GetCreatedCount()` 1 (ids are never reused), `GetActiveCount()` 0, `TotalLiabilities()` 0, realm balance empty.
- UI: "Contract 0 archived. The chain refunds its storage deposit to you." then "Contract 0 does not exist or has been archived."; "My contracts" in the lane is empty again.

The canary passes when every expectation above held. Only then announce the lane.

## If a step's outcome is unknown

If the wallet or the network reports an error after signing (a timeout, a lost reply), Memba says the transaction may still have reached the chain and disables every call on the page. Do not sign again: run the step's reads (or press **Reload contract**) and continue from what the chain shows. A repeated call would be refused by the realm and only cost its fee, except CreateContract, which would create a second contract and lock a second deposit.

## Stop conditions

Stop, do not continue to the next step, and do not announce the lane if any of these happens:

- a tx fails for a reason this runbook does not predict, or a wallet shows a different realm, function, amount or deposit cap than the one above;
- `TotalLiabilities()` differs from the sum of funded, completed and disputed milestones, or the realm balance is ever below `TotalLiabilities()`;
- the fee is not 20 ugnot, the bps is not 200, or the treasury is not `GetTreasury()`;
- `GetPauseStateJSON()` reports paused, or `GetAdmin()`, `GetPendingAdmin()`, `GetFeeRecipient()` or `GetPendingFeeRecipient()` differ from the baseline;
- a storage deposit is far above the table's cap estimate, or the archive refund goes to anyone but C;
- the UI shows a contract to the wrong wallet, the wrong network, or a paused banner while the realm is not paused;
- the UI offers a call to a wallet the realm would refuse it to (for example Release to F, or Mark delivered to C), or the confirmation dialog shows arguments, coins or a deposit cap other than the step says.

## Rollback

From least to most disruptive:

1. **Hide the lane.** Set `VITE_ENABLE_SERVICES` off in Netlify and redeploy. The Services tab, the contract pages and every escrow screen disappear (a shared contract link then redirects to a live lane); no funds move, and contracts stay on chain, callable with gnokey.
2. **Pause the realm.** The admin (the publisher 2-of-3) signs a `Pause` MsgCall on `gno.land/r/samcrew/escrow_v4` (no arguments, nothing sent). CreateContract and FundMilestone are refused until `Unpause`; every other state change is refused for 183,273 blocks (about 7 days), after which exits reopen by themselves so funds are never stuck. Unpausing starts a 183,273-block cooldown before the next `Pause`, so pause only for a real incident. Memba's lane then shows the paused banner, Hire by address is disabled, contract pages refuse funding and hold every other call until the blocking window ends.
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
