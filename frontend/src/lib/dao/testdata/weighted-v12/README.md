# Weighted host v12 native fixtures

`native.json` is verbatim structured-read output (`GetConfigJSON`,
`GetMembersJSON`, `GetProposalsJSON`, `GetProposalJSON`, `GetBallotJSON`,
`GetPendingVotesJSON`, and `Render("")` under `render`) of the mainnet
governing DAO candidate `gno.land/r/samcrew/memba_dao`, read contract
`memba-weighted-host/v12`. Nothing here was hand-edited; re-capture instead.

## Provenance

| Item | Value |
|---|---|
| Gno VM | `gnolang/gno` `e75fef82c02876a4df92ad6e325c5479b9532168` (the gnoland-1 runtime pin), `gno` built with `CGO_ENABLED=0` |
| `gno` binary SHA-256 | `94ae0155570ae4f7e452c3975298620285dd1eefb0d0d88ab6ecfe32c582877c` |
| Realm | `gno.land/r/samcrew/memba_dao`, generated from the approved gnoland-1 roster and adapter configuration |
| Host package | `gno.land/p/samcrew/memba_weighted_host`, `reads.gno` SHA-256 `0d8921f2337bf5b9a04f2a413d69cb97becdfb5289650044e09ac344db3a578c`, `host.gno` `b8687fa6985681099b5d3efca4f82e7160d0c1b47cacacc065e4b2844e856027`, `escrow_actions.gno` `4d02739adf6cfbc558c02c0ad3e3a777640ca5248f6c96289a0ff30688c98868`, `escrow_host.gno` `36437278418d56a5e6ede4ad528630b9cd399082f082d4ba26e2b959069b890f`, `escrow_reads.gno` `ac8040297eef5399049d33428893c62c93871701f7e4b025f3f10b03218eb684` |
| Policy package | `gno.land/p/samcrew/memba_weighted_policy`, `policy.gno` SHA-256 `dfeca4ef26bff1f97335d9808e2152a6cb8f64aecea2ce4f3f2ad6da5390e683` |

The twelve generated realm files matched the recorded gnoland-1 candidate
digests before the run (`realmSha256` in `native.json`). This build adds the
ballot reads (`memba_dao.gno`) and re-points the escrow adapter at
`gno.land/r/samcrew/escrow_v4` (`escrow_adapter.gno`):

```
b6d10eae19f707c9b9884bfbd685ed8ef79ff2a1410d752be11d85a9b7ae3b5c  appstore_adapter.gno
a84c69382821031e5cb43d32d1d1ce6012ce71028ee103de415b0fba797c530d  arcade_adapter.gno
087f3bb72305049d15b61c43effb2348c8cb858244e9d51f72e8013899fc980f  badges_adapter.gno
2d192580ddf5cea1ff1e90babc92b235e0e094ac73ad154f25e45d87a713d1a6  channels_adapter.gno
8899b9e708bb7f12a67dd837eab010223aa4e1cde2421fe39558cc40e87eb3ec  escrow_adapter.gno
8f9213fbd3a0dca2c4e22a16888b312a8617eb8b73821395073ac480f9d180b3  feed_adapter.gno
595702fd91e30ed5ee1dfb5d0c87e15ac2d499f5cb45ba38de78cb0a016c1522  feedback_adapter.gno
234f1774eebb2de700b8f0d71d070b4b923d166dc84a2884825013529313de18  gnomod.toml
17e2b294b901663f99f832e5c20f9baee8d0f3f759a9a84a9fa507be032664a6  market_adapter.gno
66d3957cfbcafa4347d81e62a71aa4b524e3bd9e667cf138e7e75fc481327c33  memba_dao.gno
2e31e4afed29796f2bb424ff6a5ec2ce26a07458bbf0364074e8f557a744b40e  quest_adapter.gno
172a91718b86b0fbf6e58536bfde6af04ffb33b74eb37bade47c5c5283a369c4  reviews_adapter.gno
```

`packageSha256` records every host and policy source file used. `host/`
holds verbatim copies of the host's ten `*_actions.gno` encoders and of
`policy.gno`. The unit tests check each against its recorded digest, derive
the list of encodable operations from the encoders (70) and require a
native proposal for every one, and pin the routine/financial thresholds that
the config JSON does not publish.

## Scenario

A disposable `gno test` realm drove the generated DAO. The ten target realms
were loaded with a test-only initializer that makes the configured publisher
their current owner; nothing was signed, broadcast or read from a node. VM
time starts at 2026-09-24T00:00:00Z.

1. Records `config`, `members_initial` and an empty proposal page.
2. The publisher nominates the DAO on all ten targets. #1 (finance role
   grant) executes on the weighted route; #2 and #3 (role, recovery) are then
   invalidated by #4.
3. #4–#13 accept every adapter handoff in turn (all `EXECUTED`).
4. Emergency pauses on arcade, escrow, channels and App Store (these also
   invalidate outstanding proposals, without creating a proposal).
5. #14 (quest signer) gets one vote and expires after seven days.
6. #15–#26: one live proposal per family — `VOTING`, `TIMELOCKED` (weighted
   route #16, developer route #23, both routes #26) and `READY` (financial
   #17, routine #18).
7. Records pages `GetProposalsJSON(0, 20)`, `(7, 20)` and `(26, 3)`, every
   single proposal, and #16/#23 one day later (`recovery_later`,
   `badges_later`).

Records 1–7 are unchanged by what follows.

8. Phase 2 (`op:<type>:<operation>` records, each read right after it was
   proposed): unpauses, then a return and an abort-return executed for every
   adapter; appointments (attester, admin, moderator, curator, channel and
   feedback members); a comment, a hidden review, two flags on a seeded
   pending listing, a seeded delisted listing, and an `escrow_v4` contract
   `"0"` funded and disputed (its milestone is numbered `"0"`, by index); emergency pauses of badges, feed and feedback; then
   one proposal for each remaining operation, all against the same state,
   including the escrow fee-recipient rotation (`op:escrow:set-fee-recipient`).
   Together with records 1–7 this covers every operation the host can encode,
   role grant and removal, and member recovery. `catalog_total` is the final
   proposal count. Before the badges pause, a quest proposal is opened so
   `proposal_invalidated_by_pause` records a `pause` invalidation.
9. Phase 3 (`ballot_*`, `pending_*`): ballots that are yes, changed (a later
   height), abstain, not voted, from a non-member, on an invalidated, an
   executed and an expired proposal; pending pages for a voter, with cursor,
   limit clamps (0 and 500), a non-member, and a scan-capped page (205 open
   proposals the voter already voted on: no items, a cursor) and its
   continuation. A member-key recovery then executes: the old key keeps its
   ballot on the recovery proposal and is not eligible on the next one; the
   replacement key is the reverse (`ballot_old_key_*`, `ballot_new_key_*`,
   `pending_old_key`, `pending_new_key`). `proposal_superseded` is invalidated
   by that recovery (target `null`); `proposal_expired_sticky` is #14 read
   again at the end: still `EXPIRED`, tallies cleared, `invalidation: null`.

Each `advance` in the scenario also moves one block, so ballot and
invalidation heights differ.
