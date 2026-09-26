# Weighted founding DAO frontend candidate

> **Current status (2026-09-26):** The exact v12 founding DAO write release described below is implemented on mainnet. Earlier v1/v2 candidate and Pearl rehearsal sections are historical. After verifying `rpc.gno.land/status` reported `node_info.network = gnoland-1`, a read-only `vm/qrender` of `gno.land/r/samcrew/memba_dao:` returned the seven-member Memba DAO. The mainnet comment in `realm-versions.json` and general `config.ts` realm-allowlist comments still describe the pre-release absence; they need a separate registry reconciliation. The exact v12 write release is in `frontend/src/lib/dao/weighted.ts`, not the general realm allowlist.

The owner authorized autonomous Memba mainnet preparation and approved the founding 2/1 weights, independent five-developer route, proposal-only admin/finance role changes, seven-day voting and initial founder admin/finance labels. Deployer #183–#186 implement and test the policy, authenticated host, structured reads and local wrapper generator. This document scopes their frontend integration; it grants no production ceremony authority.

## Route and behavior

Use `/NETWORK/weighted-dao/gno.land/r/samcrew/memba_dao` against a realm that implements `memba-weighted-host/v1` or `memba-weighted-host/v2`. Other single-name samcrew realms using the same founding contract can use this view. This separate route preserves generic DAO and GovDAO behavior and concurrent professional-governance design work. It does not replace the legacy realm or change a directory entry.

The page shows seven identities with 2/1 points and current roles, exact grant/removal targets and proposers, current tallies, both critical approval routes, voting deadlines, maturity clocks and terminal status. Historical tallies cleared by the host are shown as unavailable. Pagination retains uint64 IDs as strings. Members can propose/vote/execute regardless of operational labels, with current-state checks before preparation; no-op and last-admin removal are refused. Unsupported capabilities never produce active controls.

Reads check the selected RPC's chain ID and validate versioned data. They do not consult the legacy realm's Render text or global DAO caches. A failed response is an error, not an empty roster or zero votes. Wallet/chain/realm transitions discard old reads and invalidate prepared actions. The shared broadcast helper retains existing defaults for other callers; weighted actions opt out of retries and run an additional context check after the confirmation dialog. A wallet hash is reported as submitted, not proof that governance execution succeeded; chain state is refreshed independently.

`gnoland-1` writes are blocked for every weighted DAO except the released mainnet governing DAO (see "Mainnet write hold and its one release" below). The testnet wallet controls require matching authenticated/current-member and wallet/active-chain state. No new mainnet feature flag, funding, signing or deployment is performed by this change. The existing published Pearl DAO does not implement the new weighted contract, so this route's tests use deterministic RPC fixtures until an isolated generated-realm rehearsal is approved and available.

## Validation and scope review

The candidate requires the repository's full frontend build/lint/unit/browser checks and backend race/build checks before push. Focused coverage includes native contract wire escaping, unknown capabilities, inconsistent tallies/status, duplicate identities/JSON fields, uint64 overflow, altered realm/chain, wrong proposal IDs, stale wallet reads and confirmation, no retry after an uncertain outcome, mainnet write refusal, responsive layout and accessibility. Browser screenshots use synthetic fixture data, never live team balances or a signing wallet.

| Perspective | Check and scope |
|---|---|
| Security | Structured input validation; no raw HTML or secret material |
| Architecture | Dedicated adapter and route; generic DAO contract preserved |
| Gno integration | Wrapper entrypoint names, ordered string arguments and empty sent coins |
| Adversarial input | Unknown schemas, fields, capabilities, malformed pages and injected IDs refused |
| Failure handling | Visible read failures; no fabricated zero history or automatic resubmission |
| Supply-chain boundary | Existing locked dependencies; synthetic public fixtures |
| React lifecycle | Wallet/realm/chain remount; stale reads and prepared actions invalidated |
| Blockchain state | Fresh pre-action reads; contract remains final authorization authority |
| Contract authorization | Member execution independent of admin labels; last-admin/no-op checks |
| UX | Exact action, deadlines, disabled unsupported actions and separate submission status |
| UI | Existing design variables, responsive roster and wrapping addresses |
| QA | Focused component/contract/browser checks plus required full gates |
| Documentation | Route, limits, validation and next rehearsal recorded |
| Treasury user | No deposit, spending or treasury authority implied by finance label |
| DAO user | Separate points/people/developers; preserved unavailable historical totals |
| Wallet user | Matching account/chain required, post-confirmation recheck, no automatic retry |
| Launch ownership | Mainnet is read-only except the released governing DAO (v12 at `r/samcrew/memba_dao`); no all-feature readiness claim |

## Remaining launch work

Run the actual generated candidate with the frontend and real test-wallet signing, both independent coalitions and time delays, expiry, stale approvals and failure recovery. Browser stubs plus native host tests are complementary evidence, not that end-to-end ceremony. Migration, typed application and treasury adapters, nine remaining audit findings, exact funding/custody and production configuration remain separate blockers. Mainnet stays held for these candidate versions until those are addressed and the frozen release is reviewed; only the published v12 governing DAO is released.

## v2 member-key recovery candidate

Deployer #187 merged the critical same-person recovery wrapper. This frontend accepts v1 with recovery disabled and v2 with recovery enabled; unknown versions, mixed response versions and inconsistent capabilities are rejected. Both versions keep mainnet writes blocked.

The recovery form names the exact human and current address, checks the replacement's Gno checksum and unused membership, and shows the voting weight and roles that execution preserves. The confirmation contains all three frozen arguments. This operation replaces a DAO address only; native multisigs and target authority require separate migration.

Before preparing any action and again after confirmation, read the current contract/roster/roles. A changed identity, address, weight or role invalidates the prepared action. The shared wallet helper awaits this check and rechecks wallet safety afterward; no recovery submission is automatically retried. Vote/execute also revalidate the proposal lifecycle. The chain still performs final authorization: a read cannot eliminate a later on-chain race.

Consumed and invalidated v2 proposals can legitimately refer to former members. Preserve their exact historical addresses and unavailable tallies, while requiring current members and targets for active proposals. Never infer recovery actions from text or grant controls to an address merely because it occurs in history.

Validation includes actual native v2 JSON, v1 regression tests, capability/version mismatches, checksum/seat/collision refusal, former-member history, asynchronous confirmation invalidation and desktop/mobile browser accessibility checks. The 17-perspective scope review above applies to this candidate with recovery and historical actors added; real wallet/browser/realm signing remains a launch gate.

## v12 adapter acceptance, ballots and execution

The v12 workspace (`memba-weighted-host/v12`, the mainnet governing DAO) builds three kinds of call, each one of the realm's exported functions: `Propose<Adapter>Accept()` (no arguments), `Vote(id, "yes" | "no" | "abstain")` and `Execute(id)`. Role and key-recovery proposals for v12 are a later slice.

**Mainnet write hold and its one release.** On `gnoland-1` no weighted DAO message is built (`planWeightedTx` refuses before building) and every control renders disabled with the hold message, except for the exact entries of `WEIGHTED_WRITE_RELEASES` (`lib/dao/weighted.ts`). The only release is the mainnet governing DAO: `memba-weighted-host/v12` at `gno.land/r/samcrew/memba_dao` (published h315078, owner go 2026-09-25). The release matches chain, version and realm path exactly, so a v1/v2 host, another v12 realm or a look-alike path on `gnoland-1` stays read-only; each new release is its own owner-gated change. The page computes its hold (`weightedWritesHeld`) separately from the write kinds it is offered (`weightedWriteKinds`, which calls the same predicate), so a regression in the write kinds still leaves an unreleased DAO disabled; the planner, `assertWeightedWrites` and the wallet check all refuse through the same predicate, whose exact-match semantics the tests pin.

**Budgets.** Each call carries a measured gas limit and a `max_deposit` storage cap in the signed message (`weightedBudget.ts`): 1.5 × the highest measured gas and positive deposit of that entry point (Execute: of the operation it runs), from runs of the generated realm on an in-process node at the gnoland-1 runtime pin with mainnet VM parameters (`testdata/weighted-v12/budget.json`). Acceptances cap at 2.06–2.26 GNOT (escrow 4.34 GNOT), a ballot at 0.04 GNOT and the execution of an acceptance at 0.18–0.5 GNOT. The confirmation dialog shows the exact cap, the cap is re-checked right before signing, and anything above the 10 GNOT ceiling is refused (no override path is needed for v12).

**Acceptance workflow.** Each adapter card reads its target's authority through the same getters the DAO freezes (`GetAdmin`/`GetPendingAdmin`, `GetOwner`/`GetPendingOwner`, `GetModerator`/`GetPendingModerator`) and shows *Awaiting publisher nomination*, *Ready to accept* (the DAO's own package address is the pending authority), *Nominated, but the handoff would be refused* (a host precondition such as a residual feed moderator or channels membership fails) or *DAO controls*. `Propose acceptance` appears only when ready, is re-checked before signing, and stays disabled while another acceptance is open: executing any application action invalidates every other open proposal, so acceptances run one at a time. After an acceptance executes, the target is read again and the page says whether it now names the DAO.

**Handoff order.** The cards follow the mainnet handoff plan's recommended order and show what each acceptance changes: 1 market config (proves the pipeline), 2 badges (retires the publisher's admin grant), 3 feed (moderators then need a critical vote), 4 feedback and 5 DAO channels (the outgoing owner's admin role and membership retire), 6 reviews (hide and unhide become DAO votes), 7 arcade and 8 quests (after the attester and signer are set), 9 App Store (the DAO becomes curator) and 10 escrow, last, as the only real-money path. The first target the DAO does not control yet is marked "Next recommended"; the order is guidance, while the one-open-acceptance rule is enforced. The path of each acceptance is shown: propose, then 6 points from at least 4 people and 24 hours (or 5 developers and 72 hours), then execute.

**Budget cross-check (handoff plan §4.6 and §4.7, measurements of 2026-09-24).** Every DAO-call row there (each `Propose*`, each `Execute (…)`, the emergency pauses) has exactly the same gas_wanted and max_deposit as `weightedBudget.ts`. Differences: the plan sizes each ballot variant separately (21.5M to 24.8M gas, 10k to 40k ugnot), while Memba sends one budget for every ballot, the largest (24.8M, 40,000 ugnot); the plan's §4.3 summary quotes 22,780,999 gas for `ProposeEscrowAccept` where the escrow_v4 re-measure in §4.6 has 22,769,736 (both give 34.2M); the ten publisher transfers are not DAO calls and have no row here; executions with no measurement use the 81.9M / 1.46 GNOT fallback, which the plan does not list.

**Ballots and execution.** Votes are offered only after the member's ballot is read: an ineligible voter gets none, the current choice is disabled (the realm treats a repeat as a no-op), and a change stays possible in VOTING, TIMELOCKED or READY until the deadline. Execute opens an inline confirmation naming the open proposals it will invalidate.

**Wallet and chain checks.** The shared signing guard (`walletNetworkGuard`, run by `doContractBroadcast` before and after the page's pre-sign rechecks) asks the wallet for its account and network and refuses an empty or unknown chain, another chain than the page's, a locked or disconnected wallet, an untrusted RPC or another account. The v12 page adds only the governance hold list: after its rechecks it runs the guard once more through `assertLiveWalletChain`, which refuses a held chain for the page or the wallet unless the DAO is released there, and refuses a wallet on any other chain than the page's even if the shared guard let it through. Target authority, proposal and proposal-page re-reads each go through the RPC chain check. The one-open-acceptance rule pages through the whole proposal history (up to 25 pages of 20) and refuses rather than answer from a partial read.

**Mainnet measurements (owner decision D-1, 2026-09-25).** The release ships with the budgets above, measured on an in-process node at the gnoland-1 runtime pin with mainnet VM parameters. They could not be re-measured on mainnet first: `ProposeMarketAccept` needs a pending nomination, and the nominations wait for this release (plus the nomination cancel rows and the proposal watcher).
- Before the owner signs the first acceptance proposal, simulate it read-only on mainnet. If the gas used is above 80 % of the budget, raise the budget in a follow-up before signing.
- Re-simulate `Vote` on the first open proposal the same way.
- `recover-member` and `set-role:remove` executions still have no measurement and keep the fallback (81.9M gas, 1.46 GNOT cap). Memba builds neither proposal for v12 yet; only an Execute of one made elsewhere would use the fallback.
- `Vote` gas grows with the proposal count: it went from 15.2M at proposal 1 to 16.2M at proposal 71 locally. The 24.8M limit covers several hundred proposals, not an unbounded history; re-check it as the history grows.
