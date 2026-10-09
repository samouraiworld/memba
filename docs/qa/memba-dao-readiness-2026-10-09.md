# Memba DAO readiness — 9 October 2026

The current council is published and can govern Reviews. Memba's original DAO URL still opens the retired weighted contract, which is deliberately read-only. Full application governance is not live: nine applications still belong to their current administrator and have no handover pending. No proposal has yet exercised the current council's voting/execution cycle on mainnet.

- Current council: <https://memba.club/os/dao/samcrew.memba_gov>
- Historical contract: <https://memba.club/os/dao/memba_dao>
- Public RPC evidence: [read results](memba-dao-readiness-2026-10-09.json). RPC `status` confirmed `gnoland-1` at height 680351 before these reads. Queries ran around 16:49–16:53 Europe/Paris; their returned Height is 0, so this is a live observation, not an atomic historical snapshot.

## Verified state

| Area | Observed state | What remains |
| --- | --- | --- |
| Governance core | `gno.land/r/samcrew/memba_gov` published; 5 seated members, 6 points | Validate an intended proposal → vote → execute cycle with members' wallets |
| Seats | zxxma (2), mikecito, david, lours, mikael (1 each) | Already sufficient to govern; the two invitations are not a launch prerequisite |
| Invitations | ghost and dadidou, each 1 point; expire 6 January 2027 at 13:33:03 Europe/Paris | Each invited key signs `Join()` itself; prefer doing this before proposals, as Join invalidates all open proposals |
| Proposals | 0 | No live vote/execution receipt exists yet to validate end to end |
| Application bridge | `gno.land/r/samcrew/memba_bridge_v1` published | Nine nominations and nine acceptances; Reviews is already accepted |
| Pauses | All seven pausable target applications return false | Recheck immediately before handover; bridge Accept refuses paused applications |
| Community | Channels still belong to the current administrator | Handover Channels, then vote on community admissions; a Feed `#join` post does not grant a council seat |
| Fee destinations | Market config treasury, App Store treasury and Escrow fee recipient all remain `g136j0m08pkm2lwwde9dmlx8uee26llent9s5cpf` | Decide separately whether existing destinations should change; ownership handover does not redirect fees |
| App Store listing fee | 1 GNOT | No fee change requested or made |

The bridge address is **`g1ejzh9w5z3wuylrrnkc97epjtrdylpmzdj2a0zp`**. It was derived from the package path using Memba's address implementation, and matches the live Reviews moderator. Reviews bridge `Tenure` is 1; every other app's tenure is 0.

## Concrete handover checklist

Current administrator of all nine remaining apps: **`g136j0m08pkm2lwwde9dmlx8uee26llent9s5cpf`**. All pending-owner/admin getters are empty at the time of the audit.

For each row, the current administrator signs the nomination with the bridge address above as the sole explicit argument. Once confirmed, call `Accept(app)` on **`gno.land/r/samcrew/memba_bridge_v1`**, using the app identifier in the first column. This accepts the nomination; it does **not** require a DAO proposal. The published bridge's `Accept` code was read directly from mainnet to confirm this distinction from the old weighted DAO.

| App identifier (under `gno.land/r/samcrew/`) | Nomination function on that app | Acceptance on bridge |
| --- | --- | --- |
| `memba_market_config` | `TransferAdmin(bridgeAddress)` | `Accept("memba_market_config")` |
| `gnobuilders_badges_v2` | `TransferOwnership(bridgeAddress)` | `Accept("gnobuilders_badges_v2")` |
| `memba_feed_v1` | `TransferOwnership(bridgeAddress)` | `Accept("memba_feed_v1")` |
| `memba_feedback_v2` | `TransferOwnership(bridgeAddress)` | `Accept("memba_feedback_v2")` |
| `memba_dao_channels_v2` | `ProposeOwner(bridgeAddress)` | `Accept("memba_dao_channels_v2")` |
| `memba_arcade_leaderboard_v1` | `TransferOwnership(bridgeAddress)` | `Accept("memba_arcade_leaderboard_v1")` |
| `memba_quest_attestation_v1` | `TransferOwnership(bridgeAddress)` | `Accept("memba_quest_attestation_v1")` |
| `memba_appstore_v3` | `TransferOwnership(bridgeAddress)` | `Accept("memba_appstore_v3")` |
| `escrow_v4` | `TransferOwnership(bridgeAddress)` | `Accept("escrow_v4")` |

These are a reviewable call inventory, **not signed transactions or a gas quote**. Before each signing, re-read chain ID, owner, pending owner, pause, caller account/sequence and network fees; simulate the exact call and review its fee/storage ceiling. After nomination, verify the pending address. After acceptance, verify current owner equals the bridge, pending owner is empty and tenure increased. Record each transaction hash. Do not nominate the retired `memba_dao` or `memba_gov` directly: the application adapter is the bridge.

After handovers, inventory operational grants (moderators, curators, attesters, badge admins and community roles). Governance ownership and daily operational roles are different; retain/reassign them only according to the team's intended permissions. Use the new council's governed actions for subsequent changes.

## Voting rules at the current 5-person / 6-point roster

- Routine: at least 3 points and 2 people, no delay.
- Financial: at least 4 points and 3 people, no delay.
- Critical: at least 4 points and 3 people, then 1 day; or at least 4 people and 4 points, then 3 days.
- Roster changes also impose their 7-day roster delay. Joining or changing the roster invalidates open proposals.
- Voting lasts 7 days. Execution has a 7-day window after voting and the applicable delay end. Thresholds change with the seated roster.

## Frontend findings addressed

1. **Old entry point strands visitors:** the historical URL remains historically correct and read-only, with a prominent button opening the current council. Old proposal IDs are never redirected into another contract.
2. **Invitation action missing from Members:** the voting screen told invitees to join from Members, but Join existed only on Overview. Members now shows the same guarded signing action.
3. **Community authority checked the retired DAO:** channel ownership is now compared against the published bridge. Old ownership no longer claims admission is available. The cache is keyed by the new authority, and failed reads report unknown.
4. **Overview led with technical rules:** it now explains collective decisions, shows the actual seats/invitations, links to members/proposals, and lists each application's handover status. Voting rules, emergency controls and contract details are expandable. Failed/partial app reads never count as zero ownership.

The interface remains in English, consistent with Memba OS. The updated window uses the readable title “Memba DAO” and more space; narrow windows use a single-column layout.

## Validation and release

- Focused DAO/read/signing/window suites: 357 tests passed. After the cache-key adjustment, the three affected suites passed again (48 tests).
- Production frontend build, TypeScript and full frontend ESLint passed.
- A pre-existing GovDAO unit-test mock intercepted the exported fee reader but not the real checker's internal reader, causing a network-dependent failure. The tally-test suite now isolates the fee checker; fee behavior remains covered by its own tests.
- Browser review covered desktop and 390/320 px mobile widths, including navigation and no horizontal overflow at 320 px. It uses the live chain in guest mode on a local frontend. No wallet was connected, no proposal/vote was sent, and no governance or treasury ownership changed.
- Merge after required CI passes, deploy the frontend, then verify both the historical entry point and current DAO route on production.
- A real signed governance cycle and the nine application handovers remain operator/member actions. This review does not certify them as completed.


## Wallet preparation follow-up (9 October 2026)

The user-supplied [activation transaction](https://gnoscan.io/transactions/details?txhash=DAE272FC7DDFBAE5BFDEDA9423414FD9FB7DC515A159912D268B040B59EAF268)
succeeded on `gnoland-1` at height 680776 (17:09:47 Europe/Paris). The public
RPC transaction response and GnoScan agree on a self-send of 1 ugnot, a fee of
686 ugnot (0.000686 GNOT), and gas used/wanted of 623038/685341. GnoScan reports
**0 GNOT storage deposit (0 bytes)**. The fee is below the conservative 0.0024
GNOT estimate shown in Memba; Adena estimated its own gas before signing.

This activates `g1at2h7kdhz2m9lv6azn54mwu4wl95k94wu90uwj`, whereas a fresh
`memba_gov.RosterJSON()` read still invites **ghost** at
`g12yg9nh4ncma44emgm8msxe8aavzywt0p95tanv`. The activated address cannot accept
that invitation. Confirm which wallet Ghost intends to use before proposing
any membership change. No invitation or chain state was modified during this
review.

The updated UI explains wallet preparation separately from DAO membership,
shows zero storage deposit for activation, and makes its technical details
expandable. DAO signing reviews label the storage amount as a **limit**, not
an actual charge or measured estimate. Existing gas/deposit limits and signing
guards are unchanged. Using the first DAO Join as the wallet's first transaction
would require a separately designed authentication flow; this patch does not
relax the current authentication requirement.


## Fee transparency

The Overview now reads the following verified mainnet fields every minute,
with manual refresh and per-source unavailable states. Wrong-chain RPCs are
rejected; amounts use exact integer ugnot arithmetic.

| Source | Read | Meaning |
|---|---|---|
| Market config | `GetFeeBPS("nft"/"service"/"token")`, `GetTreasury()` | Shared current fee policy and its destination, not a second revenue pool |
| Services escrow | `GetGovernanceFeeTerms().EffectiveBPS/EffectiveTreasury` | Actual effective rate/destination, including its fallback rules |
| App Store | `GetRegistrationFee()`, `GetTreasury()` | Current price and destination; seeded listings and historical price changes prevent inferring revenue from listing count |
| Connect 4 | `fee`, `feesCollected`, `owner.Owner()` | Current flat fee, collected fees awaiting withdrawal, and withdrawal authority |

At the read on 9 October 2026, Market rates were 2% NFT, 2% services and 0.5%
token OTC; escrow's effective rate was 2%; App Store registration cost 1 GNOT;
Connect 4 cost 0.1 GNOT per decisive game and held **0 GNOT in collected fees**.
All observed recipients/withdrawal authority were the publisher wallet
`g136j0m08pkm2lwwde9dmlx8uee26llent9s5cpf`.

Connect 4's deployed `WithdrawFees` resets `feesCollected` to zero. Its bank
balance includes players' stakes, so it must never be substituted for this
counter. Connect 4 is not among the current bridge's ten apps. Its fees are
not DAO-controlled or lifetime revenue.

Market and App Store forward fees to receiving wallets. The UI explicitly
marks historical consolidated revenue as unavailable: calculating it requires
a complete, deduplicated settlement/registration history, including former
recipients and prices. Shared receiving wallets appear once, with their whole
current balance labelled separately. Network gas fees and storage deposits
are excluded. This release does not add an indexer, change fee rates, move
funds, or claim the DAO can spend a receiving wallet's balance.
