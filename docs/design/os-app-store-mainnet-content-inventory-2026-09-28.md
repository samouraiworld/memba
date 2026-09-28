# App Store mainnet listing inventory — 28 September 2026

Read-only `vm/qeval` calls to `gno.land/r/samcrew/memba_appstore_v3.GetListingJSON` on `https://rpc.gno.land:443`, checked on 28 September 2026. These are the six current `live` records on `gnoland-1`, not draft edits or publisher approvals. Each was seeded at chain height 266529, has zero flags and zero resubmissions, and names publisher `g136j0m08pkm2lwwde9dmlx8uee26llent9s5cpf`. All six have an empty `iconCID` and an empty `screenshotCIDs` array.

| ID | Package path | Name | Tagline | Category | App URL |
|---|---|---|---|---|---|
| 1 | `gno.land/r/samcrew/block_party` | Block Party | Daily chain-seeded 2048 puzzle | Games | `/game` |
| 2 | `gno.land/r/samcrew/space_invaders` | Space Invaders | Classic arcade shooter | Games | `/game/space-invaders` |
| 3 | `gno.land/r/samcrew/barricade` | BARRICADE | Hold the Paris barricade against the machines | Games | `/game/barricade` |
| 4 | `gno.land/r/gnoswap/router` | GnoSwap | Swap tokens and provide liquidity on gno.land | Exchange | `https://gnoswap.io/` |
| 5 | `gno.land/r/gnoland/boards2/v0` | Boards | On-chain community forum | Community | `https://gno.land/r/gnoland/boards2/v0` |
| 6 | `gno.land/r/gnops/valopers` | Valopers | gno.land validator operator registry | Validators | `https://gno.land/r/gnops/valopers` |

## Current descriptions

1. **Block Party:** “A daily 2048 merge game seeded from a Gno block — everyone plays the same board. Play with no wallet; connect to save your streak and climb the leaderboard.”
2. **Space Invaders:** “Defend the baseline across escalating waves in a browser-native Space Invaders. Play instantly with no wallet — keyboard on desktop, full touch controls on mobile. Deterministic engine, local high score.”
3. **BARRICADE:** “A browser-native defence game in a French civic setting: hold the cobblestone barricade as waves of machines advance down three lanes. Play instantly with no wallet — a wide battlefield on desktop, a portrait front line on phones.”
4. **GnoSwap:** “GnoSwap is a concentrated-liquidity exchange built on gno.land: swap GRC20 tokens, provide liquidity and stake positions. An independent project, listed by Memba as a curated ecosystem app; its realms are live on mainnet.”
5. **Boards:** “Boards is gno.land's on-chain forum: community discussions stored and rendered directly by a realm. Listed by Memba as a curated ecosystem app.”
6. **Valopers:** “The on-chain registry where gno.land validator operators publish their profile and server details. Listed by Memba as a curated ecosystem app.”

## Content decisions before writes

- **Copy and URLs:** Keep the current values as the baseline. Confirm each claim and external destination with its operator before changing any field. The first three are Memba routes; the last three are external destinations.
- **Media:** No current listing has an icon or screenshot CID. Select and approve a real raster icon and genuine in-product screenshots per app, check ownership and image rendering through the production proxy, pin them, then record exact CIDs. Do not turn game art or mockups into purported screenshots. For independent projects, obtain their approval or leave media blank with a deliberate fallback.
- **Authority:** Prove the seeded publisher address still controls the listing and has curator permission at execution time. Check owner, curator set, pause state and gas immediately before simulation.
- **Lifecycle:** Deployed `EditListing` cannot edit a `live` record. A current live listing requires `DelistApp` → curator `RestoreApp` → publisher `EditListing` → curator `ApproveApp`. `EditListing` increments `resubmitCount` and the cap is five. Verify same-transaction multi-call execution and postconditions against the deployed realm before using this route. If atomic execution is unavailable, the listing disappears from public discovery between transactions; that is a separate release decision.
- **Reviews:** Reviews are keyed by the immutable package path, so content edits must keep `pkgPath` unchanged. No mainnet app-review realm was recorded in the deployment manifest at this audit; no average or review count should be presented as live until deployment and verification.

The transaction brief for each listing must show all eight inputs in order (`pkgPath`, `name`, `tagline`, `descr`, `category`, `iconCID`, `screenshotsCSV`, `appURL`), the exact prior and desired values, signer roles, message sequence, simulated gas and expected post-state. A blank field in this inventory is an actual current blank, not an approved new value.
