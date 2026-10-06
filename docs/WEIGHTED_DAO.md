# Weighted founding DAO frontend candidate

> **Current status (2026-10-06):** Memba DAO is moving to a new governance contract. v12 (`gno.land/r/samcrew/memba_dao`) has no generic call and no migration, so anything it accepted now would stay frozen there: Memba builds no v12 call on any chain and shows v12 read-only, in Memba OS and on the classic page. The mainnet write release of 2026-09-25 is withdrawn. Earlier v1/v2 candidate and Pearl rehearsal sections are historical.

The owner authorized autonomous Memba mainnet preparation and approved the founding 2/1 weights, independent five-developer route, proposal-only admin/finance role changes, seven-day voting and initial founder admin/finance labels. Deployer #183–#186 implement and test the policy, authenticated host, structured reads and local wrapper generator. This document scopes their frontend integration; it grants no production ceremony authority.

## Route and behavior

Use `/NETWORK/weighted-dao/gno.land/r/samcrew/memba_dao` against a realm that implements `memba-weighted-host/v1`, `memba-weighted-host/v2` or `memba-weighted-host/v12` (read-only). Other single-name samcrew realms using the same founding contract can use this view. This separate route preserves generic DAO and GovDAO behavior and concurrent professional-governance design work. It does not replace the legacy realm or change a directory entry.

The page shows seven identities with 2/1 points and current roles, exact grant/removal targets and proposers, current tallies, both critical approval routes, voting deadlines, maturity clocks and terminal status. Historical tallies cleared by the host are shown as unavailable. Pagination retains uint64 IDs as strings. On v1/v2, members can propose/vote/execute regardless of operational labels, with current-state checks before preparation; no-op and last-admin removal are refused. Unsupported capabilities never produce active controls.

Reads check the selected RPC's chain ID and validate versioned data. They do not consult the legacy realm's Render text or global DAO caches. A failed response is an error, not an empty roster or zero votes. Wallet/chain/realm transitions discard old reads and invalidate prepared actions. The shared broadcast helper retains existing defaults for other callers; weighted actions opt out of retries and run an additional context check after the confirmation dialog. A wallet hash is reported as submitted, not proof that governance execution succeeded; chain state is refreshed independently.

`gnoland-1` writes are blocked for every weighted DAO, and v12 is read-only on every chain (see "v12 is read-only" below). The testnet wallet controls require matching authenticated/current-member and wallet/active-chain state. No new mainnet feature flag, funding, signing or deployment is performed by this change. The DAO published on Pearl (now retired) did not implement the new weighted contract, so this route's tests use deterministic RPC fixtures until an isolated generated-realm rehearsal is approved and available.

## In Memba OS

A weighted DAO's folder window (`/os/dao/<name>`, for example `/os/dao/memba_dao`) is native and reads the same versioned contract through `lib/dao/weighted` (`os/daos/useWeightedDao.ts`), never the equal-headcount loaders of the other DAO kinds:

- **Overview**: seats and points, how each category of decision passes (from the config and the policy thresholds), how many proposals are open, and each governed application in the handoff order: who controls it or is nominated, and its rules from the DAO's policy (which vote decides what, who may pause it, the fee cap, where a return goes).
- **Proposals**: the paged list; each proposal opens in its own window (`/os/dao/<name>/proposals/<n>`) with its action, tally, delays, the connected seat's ballot and the state frozen at proposal time. A proposal is read as its list reads it, from the newest page when it is there and otherwise from the page that starts at it, so it gets the same roster and policy checks as the list.
- **Members**: the seven seats with their points and roles.
- **Treasury**: the DAO has no treasury and cannot spend funds. It shows the DAO's own address and balance (read from an RPC checked to serve the selected chain), where the Market and the App Store pay their fees today (each realm's `GetTreasury()`, `lib/dao/weightedTreasury.ts`) next to the treasury the DAO's policy names, and those wallets' balances. On `gnoland-1` on 2026-09-30 both realms still paid the publisher, not the policy's treasury: while the DAO controls a realm, a financial vote can move its fees, and only to the policy's address. Escrow pays its service fee to the Market treasury, and its own fallback recipient only while that treasury is unset. The wallets' signer counts are shown as the team's declaration: a multisig's key set is not readable on chain before its first outgoing transaction.

Everything here is read-only: Memba OS builds no weighted DAO call. Guests, seat holders and other accounts see the same state, with no connect prompt and no propose, vote or execute control. On Memba DAO (v12 at `r/samcrew/memba_dao`) the Overview, the Proposals tab, the Treasury tab's fees and every open proposal's window say: "Memba DAO is moving to a new governance contract. This version is read-only in Memba; no proposal, vote or execution can be made here." Any other v12 realm says only: "This DAO version is read-only in Memba; no proposal, vote or execution can be made here." Older versions say the network hold instead on `gnoland-1`, and elsewhere that the classic DAO page acts on them.

Every native read is repeated each minute while a window shows it, so votes, matured delays and other members' actions appear by themselves. A read that fails after an earlier one succeeded leaves the earlier one on screen, and says so. No link leaves Memba OS. A classic `/NETWORK/weighted-dao/<realm>` link followed inside a window, or the old `/os/daos/weighted-dao/<realm>` address, opens the DAO's window. Display text and decision rules shared with the classic page live in `lib/dao/weightedView.ts`, and contract field labels in `lib/dao/weightedApplications.ts`.

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
| Launch ownership | Mainnet is read-only for every weighted DAO, and v12 (`r/samcrew/memba_dao`) on every chain; no all-feature readiness claim |

## Remaining launch work

Run the actual generated candidate with the frontend and real test-wallet signing, both independent coalitions and time delays, expiry, stale approvals and failure recovery. Browser stubs plus native host tests are complementary evidence, not that end-to-end ceremony. Migration, typed application and treasury adapters, nine remaining audit findings, exact funding/custody and production configuration remain separate blockers. Mainnet stays held for these candidate versions until those are addressed and the frozen release is reviewed.

## v2 member-key recovery candidate

Deployer #187 merged the critical same-person recovery wrapper. This frontend accepts v1 with recovery disabled and v2 with recovery enabled; unknown versions, mixed response versions and inconsistent capabilities are rejected. Both versions keep mainnet writes blocked.

The recovery form names the exact human and current address, checks the replacement's Gno checksum and unused membership, and shows the voting weight and roles that execution preserves. The confirmation contains all three frozen arguments. This operation replaces a DAO address only; native multisigs and target authority require separate migration.

Before preparing any action and again after confirmation, read the current contract/roster/roles. A changed identity, address, weight or role invalidates the prepared action. The shared wallet helper awaits this check and rechecks wallet safety afterward; no recovery submission is automatically retried. Vote/execute also revalidate the proposal lifecycle. The chain still performs final authorization: a read cannot eliminate a later on-chain race.

Consumed and invalidated v2 proposals can legitimately refer to former members. Preserve their exact historical addresses and unavailable tallies, while requiring current members and targets for active proposals. Never infer recovery actions from text or grant controls to an address merely because it occurs in history.

Validation includes actual native v2 JSON, v1 regression tests, capability/version mismatches, checksum/seat/collision refusal, former-member history, asynchronous confirmation invalidation and desktop/mobile browser accessibility checks. The 17-perspective scope review above applies to this candidate with recovery and historical actors added; real wallet/browser/realm signing remains a launch gate.

## v12 is read-only

v12 (`memba-weighted-host/v12`, the mainnet governing DAO) is read in full: config, seats, policies, every proposal with its frozen state, each seat's ballot, each adapter target's authority and where fees go. Memba builds no v12 call: v12 has no entry in the per-version write kinds (`weightedWriteKinds` in `lib/dao/weighted.ts` returns none for it on every chain), so `buildWeightedMessage` and `assertWeightedWrites` refuse every v12 action even if a control were missed, and neither the classic page nor Memba OS renders a proposal form, a vote, an execution or an acceptance for it. Both show the read-only sentence quoted under "In Memba OS" where those controls were. Weighted DAOs add nothing to the "votes waiting for you" indicators (sidebar badge, DAO list banner, home actions, Quick Vote). The `gnoland-1` hold (`weightedWritesHeld`) still covers every weighted DAO there.

**Acceptance state.** Each adapter card reads its target's authority through the same getters the DAO freezes (`GetAdmin`/`GetPendingAdmin`, `GetOwner`/`GetPendingOwner`, `GetModerator`/`GetPendingModerator`) and shows *Awaiting publisher nomination*, *Ready to accept* (the DAO's own package address is the pending authority), *Nominated, but the handoff would be refused* (a host precondition such as a residual feed moderator or channels membership fails) or *DAO controls*. The cards follow the mainnet handoff plan's order: 1 market config, 2 badges, 3 feed, 4 feedback, 5 DAO channels, 6 reviews, 7 arcade, 8 quests, 9 App Store and 10 escrow.
