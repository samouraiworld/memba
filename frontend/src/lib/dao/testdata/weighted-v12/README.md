# Weighted host v12 native fixtures

`native.json` is verbatim structured-read output (`GetConfigJSON`,
`GetMembersJSON`, `GetProposalsJSON`, `GetProposalJSON`) of the mainnet
governing DAO candidate `gno.land/r/samcrew/memba_dao`, read contract
`memba-weighted-host/v12`. Nothing here was hand-edited; re-capture instead.

## Provenance

| Item | Value |
|---|---|
| Gno VM | `gnolang/gno` `e75fef82c02876a4df92ad6e325c5479b9532168` (the gnoland-1 runtime pin), `gno` built with `CGO_ENABLED=0` |
| `gno` binary SHA-256 | `fcf6996b569331af92622aa85d53a0e12218e9586d60897879788c5854264b85` |
| Realm | `gno.land/r/samcrew/memba_dao`, generated from the approved gnoland-1 roster and adapter configuration |
| Host package | `gno.land/p/samcrew/memba_weighted_host`, `reads.gno` SHA-256 `d002e5d53573cdff2c4a6c34a7e20fdfdecfa64b804ac464767e0616bd6e9011` |
| Policy package | `gno.land/p/samcrew/memba_weighted_policy`, `policy.gno` SHA-256 `dfeca4ef26bff1f97335d9808e2152a6cb8f64aecea2ce4f3f2ad6da5390e683` |

The twelve generated realm files matched the recorded gnoland-1 candidate
digests before the run (`realmSha256` in `native.json`):

```
b6d10eae19f707c9b9884bfbd685ed8ef79ff2a1410d752be11d85a9b7ae3b5c  appstore_adapter.gno
a84c69382821031e5cb43d32d1d1ce6012ce71028ee103de415b0fba797c530d  arcade_adapter.gno
087f3bb72305049d15b61c43effb2348c8cb858244e9d51f72e8013899fc980f  badges_adapter.gno
2d192580ddf5cea1ff1e90babc92b235e0e094ac73ad154f25e45d87a713d1a6  channels_adapter.gno
7e3492cd09b906d2bcbdba0173e6727915491729fc4eb189be2ef2e06d2688e7  escrow_adapter.gno
8f9213fbd3a0dca2c4e22a16888b312a8617eb8b73821395073ac480f9d180b3  feed_adapter.gno
595702fd91e30ed5ee1dfb5d0c87e15ac2d499f5cb45ba38de78cb0a016c1522  feedback_adapter.gno
234f1774eebb2de700b8f0d71d070b4b923d166dc84a2884825013529313de18  gnomod.toml
17e2b294b901663f99f832e5c20f9baee8d0f3f759a9a84a9fa507be032664a6  market_adapter.gno
06b0d79e6c07dc4da9346b7dc57b117bb35ea4c5ddbf9259869f427f619bcdc7  memba_dao.gno
2e31e4afed29796f2bb424ff6a5ec2ce26a07458bbf0364074e8f557a744b40e  quest_adapter.gno
172a91718b86b0fbf6e58536bfde6af04ffb33b74eb37bade47c5c5283a369c4  reviews_adapter.gno
```

`packageSha256` records every host and policy source file used.
`memba_weighted_policy.gno.txt` is a verbatim copy of the policy source; the
unit tests check its digest and pin the routine/financial thresholds that
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

Every action type appears: `set-role`, `recover-member`, `market-config`,
`reviews`, `quest`, `arcade`, `appstore`, `escrow`, `badges`, `feed`,
`channels`, `feedback`.
