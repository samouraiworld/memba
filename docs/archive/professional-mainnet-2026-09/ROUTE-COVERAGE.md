# Complete frontend route coverage

83 representative paths cover the registered page families. Dynamic routes use fixture identifiers. Each path is checked at 390px and 1600px in Black and Light. This inventory is interface coverage, not a claim that every feature is deployed or every remote-data state is populated.

Protected workflows additionally cover a synthetic connected account and transaction review in Chromium, Firefox and iPhone WebKit. A separate feature build covers the gated commerce, app, NFT, feed and game interfaces. Populated Validators and feed fixtures supplement empty/unavailable route states.

| Path below `/pearl/` | Evidence class |
|---|---|
| `(home)` | Route rendering / available local content |
| `dashboard` | Disconnected route + separate synthetic account workflow |
| `dao` | Route rendering / available local content |
| `dao/create` | Route rendering / available local content |
| `dao/gno.land/r/gov/dao` | Synthetic governance / capability guard |
| `dao/gno.land/r/gov/dao/members` | Synthetic governance / capability guard |
| `dao/gno.land/r/gov/dao/proposal/4` | Synthetic governance / capability guard |
| `dao/gno.land/r/gov/dao/propose` | Synthetic governance / capability guard |
| `dao/gno.land/r/gov/dao/treasury` | Synthetic governance / capability guard |
| `dao/gno.land/r/gov/dao/treasury/propose` | Synthetic governance / capability guard |
| `dao/gno.land/r/gov/dao/channels` | Synthetic governance / capability guard |
| `dao/gno.land/r/gov/dao/plugin/board` | Synthetic governance / capability guard |
| `create` | Disconnected route + separate synthetic account workflow |
| `import` | Disconnected route + separate synthetic account workflow |
| `multisig` | Disconnected route + separate synthetic account workflow |
| `multisig/g1fixture` | Missing resource / error presentation |
| `multisig/g1fixture/propose` | Missing resource / error presentation |
| `tx/fixture` | Missing resource / error presentation |
| `tokens` | Route rendering / available local content |
| `tokens/EXAMPLE` | Route rendering / available local content |
| `create-token` | Disconnected route + separate synthetic account workflow |
| `profile` | Disconnected route + separate synthetic account workflow |
| `profile/g1fixture` | Missing resource / error presentation |
| `settings` | Disconnected route + separate synthetic account workflow |
| `organizations` | Disconnected route + separate synthetic account workflow |
| `directory` | Route rendering / available local content |
| `explorer/gno.land/r/gov/dao` | Route rendering / available local content |
| `apps` | Capability gate + separate feature fixture |
| `apps/submit` | Capability gate + separate feature fixture |
| `apps/review` | Capability gate + separate feature fixture |
| `apps/my-submissions` | Capability gate + separate feature fixture |
| `apps/fixture` | Missing resource / error presentation |
| `validators` | Empty or unavailable read + separate populated roster |
| `validators/hacker` | Empty or unavailable read + separate populated roster |
| `validators/g1fixture` | Missing resource / error presentation |
| `validators/valoper/g1fixture` | Missing resource / error presentation |
| `alerts` | Disconnected route + separate synthetic account workflow |
| `nft` | Capability gate + separate feature fixture |
| `nft/create` | Capability gate + separate feature fixture |
| `nft/create/advanced` | Capability gate + separate feature fixture |
| `nft/collection/fixture/demo` | Missing resource / error presentation |
| `nft/token/fixture/demo/1` | Missing resource / error presentation |
| `nft/creator` | Capability gate + separate feature fixture |
| `nft/creator/g1fixture` | Missing resource / error presentation |
| `nft/studio` | Capability gate + separate feature fixture |
| `nft/studio/fixture/demo` | Missing resource / error presentation |
| `nft/legacy` | Capability gate + separate feature fixture |
| `services` | Capability gate + separate feature fixture |
| `extensions` | Route rendering / available local content |
| `marketplace` | Capability gate + separate feature fixture |
| `marketplace/services` | Capability gate + separate feature fixture |
| `marketplace/agents` | Capability gate + separate feature fixture |
| `marketplace-v2-preview` | Capability gate + separate feature fixture |
| `gnolove` | Route rendering / available local content |
| `gnolove/report` | Route rendering / available local content |
| `gnolove/notable-prs` | Route rendering / available local content |
| `gnolove/analytics` | Route rendering / available local content |
| `gnolove/contributor/fixture` | Missing resource / error presentation |
| `gnolove/teams` | Route rendering / available local content |
| `gnolove/teams/fixture` | Missing resource / error presentation |
| `gnolove/reports` | Route rendering / available local content |
| `gnolove/milestone` | Route rendering / available local content |
| `quests` | Route rendering / available local content |
| `quests/fixture` | Missing resource / error presentation |
| `quest-admin` | Route rendering / available local content |
| `leaderboard` | Route rendering / available local content |
| `points` | Route rendering / available local content |
| `candidature` | Route rendering / available local content |
| `feed` | Capability gate + separate feature fixture |
| `feed/post/1` | Capability gate + separate feature fixture |
| `feed/user/g1fixture` | Missing resource / error presentation |
| `feed/mod` | Capability gate + separate feature fixture |
| `feed/transparency` | Capability gate + separate feature fixture |
| `feedback` | Capability gate + separate feature fixture |
| `changelogs` | Route rendering / available local content |
| `blog` | Route rendering / available local content |
| `blog/fixture` | Missing resource / error presentation |
| `github/callback` | Route rendering / available local content |
| `u/fixture` | Missing resource / error presentation |
| `missing-page` | Missing resource / error presentation |
| `game` | Capability gate + separate feature fixture |
| `game/space-invaders` | Capability gate + separate feature fixture |
| `game/barricade` | Capability gate + separate feature fixture |
