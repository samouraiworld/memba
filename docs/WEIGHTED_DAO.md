# Weighted founding DAO frontend candidate

The owner authorized autonomous Memba mainnet preparation and approved the founding 2/1 weights, independent five-developer route, proposal-only admin/finance role changes, seven-day voting and initial founder admin/finance labels. Deployer #183–#186 implement and test the policy, authenticated host, structured reads and local wrapper generator. This document scopes their frontend integration; it grants no production ceremony authority.

## Route and behavior

Use `/NETWORK/weighted-dao/gno.land/r/samcrew/memba_dao` against a realm that implements `memba-weighted-host/v1` or `memba-weighted-host/v2`. Other single-name samcrew realms using the same founding contract can use this view. This separate route preserves generic DAO and GovDAO behavior and concurrent professional-governance design work. It does not replace the legacy realm or change a directory entry.

The page shows seven identities with 2/1 points and current roles, exact grant/removal targets and proposers, current tallies, both critical approval routes, voting deadlines, maturity clocks and terminal status. Historical tallies cleared by the host are shown as unavailable. Pagination retains uint64 IDs as strings. Members can propose/vote/execute regardless of operational labels, with current-state checks before preparation; no-op and last-admin removal are refused. Unsupported capabilities never produce active controls.

Reads check the selected RPC's chain ID and validate versioned data. They do not consult the legacy realm's Render text or global DAO caches. A failed response is an error, not an empty roster or zero votes. Wallet/chain/realm transitions discard old reads and invalidate prepared actions. The shared broadcast helper retains existing defaults for other callers; weighted actions opt out of retries and run an additional context check after the confirmation dialog. A wallet hash is reported as submitted, not proof that governance execution succeeded; chain state is refreshed independently.

`gnoland-1` writes are blocked unconditionally. The testnet wallet controls require matching authenticated/current-member and wallet/active-chain state. No new mainnet feature flag, funding, signing or deployment is performed by this change. The existing published Pearl DAO does not implement the new weighted contract, so this route's tests use deterministic RPC fixtures until an isolated generated-realm rehearsal is approved and available.

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
| Launch ownership | Mainnet remains read-only; no all-feature readiness claim |

## Remaining launch work

Run the actual generated candidate with the frontend and real test-wallet signing, both independent coalitions and time delays, expiry, stale approvals and failure recovery. Browser stubs plus native host tests are complementary evidence, not that end-to-end ceremony. Migration, typed application and treasury adapters, nine remaining audit findings, exact funding/custody and production configuration remain separate blockers. Mainnet must stay held until those are addressed and the frozen release is reviewed.

## v2 member-key recovery candidate

Deployer #187 merged the critical same-person recovery wrapper. This frontend accepts v1 with recovery disabled and v2 with recovery enabled; unknown versions, mixed response versions and inconsistent capabilities are rejected. Both versions keep mainnet writes blocked.

The recovery form names the exact human and current address, checks the replacement's Gno checksum and unused membership, and shows the voting weight and roles that execution preserves. The confirmation contains all three frozen arguments. This operation replaces a DAO address only; native multisigs and target authority require separate migration.

Before preparing any action and again after confirmation, read the current contract/roster/roles. A changed identity, address, weight or role invalidates the prepared action. The shared wallet helper awaits this check and rechecks wallet safety afterward; no recovery submission is automatically retried. Vote/execute also revalidate the proposal lifecycle. The chain still performs final authorization: a read cannot eliminate a later on-chain race.

Consumed and invalidated v2 proposals can legitimately refer to former members. Preserve their exact historical addresses and unavailable tallies, while requiring current members and targets for active proposals. Never infer recovery actions from text or grant controls to an address merely because it occurs in history.

Validation includes actual native v2 JSON, v1 regression tests, capability/version mismatches, checksum/seat/collision refusal, former-member history, asynchronous confirmation invalidation and desktop/mobile browser accessibility checks. The 17-perspective scope review above applies to this candidate with recovery and historical actors added; real wallet/browser/realm signing remains a launch gate.
