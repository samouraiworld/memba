# Source coverage inventory

Snapshot: `e20d261b`, 14 September 2026. This is a mechanical coverage index supporting the heuristic audit, not a record of completed runtime tests. All 78 non-test page modules were scanned for UI structure. Deeper source and visual review is described in AUDIT.md. Components and plugins can add subflows beyond these page modules.

## Route declarations

Network-prefixed routes are declared beneath `/:network`. Source: [App.tsx](../../../frontend/src/App.tsx). The root, aliases and wildcard states are included.

| Source line | Route |
|---|---|
| 216 | `/` |
| 219 | `/:network` |
| 221 | `(index)` |
| 224 | `dashboard` |
| 227 | `multisig` |
| 228 | `create` |
| 229 | `import` |
| 230 | `multisig/:address` |
| 231 | `multisig/:address/propose` |
| 232 | `tx/:id` |
| 235 | `create-token` |
| 236 | `tokens` |
| 237 | `tokens/:symbol` |
| 240 | `dao` |
| 241 | `dao/create` |
| 242 | `dao/*` |
| 245 | `profile` |
| 246 | `profile/:address` |
| 249 | `settings` |
| 252 | `directory` |
| 254 | `explorer/*` |
| 259 | `apps/submit` |
| 260 | `apps/review` |
| 261 | `apps/my-submissions` |
| 262 | `apps/*` |
| 265 | `validators` |
| 267 | `validators/hacker` |
| 269 | `validators/valoper/:operatorAddress` |
| 270 | `validators/:address` |
| 274 | `nft` |
| 276 | `nft/create` |
| 278 | `nft/create/advanced` |
| 281 | `nft/collection/:creator/:slug` |
| 282 | `nft/token/:creator/:slug/:tokenId` |
| 284 | `nft/creator/:address` |
| 285 | `nft/creator` |
| 287 | `nft/studio` |
| 288 | `nft/studio/:creator/:slug` |
| 290 | `nft/:realmPath` |
| 293 | `services` |
| 296 | `extensions` |
| 299 | `marketplace/*` |
| 302 | `marketplace-v2-preview` |
| 305 | `alerts` |
| 308 | `organizations` |
| 311 | `gnolove` |
| 312 | `(index)` |
| 313 | `report` |
| 314 | `notable-prs` |
| 315 | `analytics` |
| 316 | `contributor/:login` |
| 317 | `teams` |
| 318 | `teams/:teamName` |
| 319 | `reports` |
| 320 | `milestone` |
| 324 | `quests` |
| 325 | `quests/:questId` |
| 326 | `quest-admin` |
| 327 | `leaderboard` |
| 328 | `points` |
| 331 | `game` |
| 334 | `game/space-invaders` |
| 337 | `game/barricade` |
| 340 | `candidature` |
| 343 | `feedback` |
| 345 | `feed` |
| 346 | `feed/post/:id` |
| 347 | `feed/user/:address` |
| 348 | `feed/mod` |
| 349 | `feed/transparency` |
| 352 | `changelogs` |
| 353 | `blog` |
| 354 | `blog/:slug` |
| 357 | `github/callback` |
| 360 | `u/:username` |
| 363 | `*` |

## DAO subroutes

[DAORouter.tsx](../../../frontend/src/components/dao/DAORouter.tsx) resolves a realm path, then: overview; proposal detail; members; proposal creation; treasury; treasury spending proposal; channels; plugin; invalid/unknown route. Legacy tilde-form realm links are redirected.

## Page modules

| Module | Source lines |
|---|---:|
| [pages/AlertsPage.tsx](../../../frontend/src/pages/AlertsPage.tsx) | 448 |
| [pages/AppCurator.tsx](../../../frontend/src/pages/AppCurator.tsx) | 246 |
| [pages/AppStore.tsx](../../../frontend/src/pages/AppStore.tsx) | 552 |
| [pages/AppSubmit.tsx](../../../frontend/src/pages/AppSubmit.tsx) | 340 |
| [pages/BarricadeGame.tsx](../../../frontend/src/pages/BarricadeGame.tsx) | 5 |
| [pages/BlockPartyGame.tsx](../../../frontend/src/pages/BlockPartyGame.tsx) | 427 |
| [pages/Blog.tsx](../../../frontend/src/pages/Blog.tsx) | 145 |
| [pages/CandidaturePage.tsx](../../../frontend/src/pages/CandidaturePage.tsx) | 366 |
| [pages/Changelogs.tsx](../../../frontend/src/pages/Changelogs.tsx) | 182 |
| [pages/ChannelsPage.tsx](../../../frontend/src/pages/ChannelsPage.tsx) | 385 |
| [pages/CollectionPublic.tsx](../../../frontend/src/pages/CollectionPublic.tsx) | 490 |
| [pages/CreateCollectionLaunchpad.tsx](../../../frontend/src/pages/CreateCollectionLaunchpad.tsx) | 300 |
| [pages/CreateDAO.tsx](../../../frontend/src/pages/CreateDAO.tsx) | 446 |
| [pages/CreateMultisig.tsx](../../../frontend/src/pages/CreateMultisig.tsx) | 317 |
| [pages/CreateToken.tsx](../../../frontend/src/pages/CreateToken.tsx) | 542 |
| [pages/CreatorProfile.tsx](../../../frontend/src/pages/CreatorProfile.tsx) | 98 |
| [pages/DAOHome.tsx](../../../frontend/src/pages/DAOHome.tsx) | 289 |
| [pages/DAOList.tsx](../../../frontend/src/pages/DAOList.tsx) | 434 |
| [pages/DAOMembers.tsx](../../../frontend/src/pages/DAOMembers.tsx) | 281 |
| [pages/Directory.tsx](../../../frontend/src/pages/Directory.tsx) | 285 |
| [pages/Explorer.tsx](../../../frontend/src/pages/Explorer.tsx) | 27 |
| [pages/Extensions.tsx](../../../frontend/src/pages/Extensions.tsx) | 206 |
| [pages/FeedMod.tsx](../../../frontend/src/pages/FeedMod.tsx) | 91 |
| [pages/FeedPage.tsx](../../../frontend/src/pages/FeedPage.tsx) | 296 |
| [pages/FeedProfile.tsx](../../../frontend/src/pages/FeedProfile.tsx) | 114 |
| [pages/FeedThread.tsx](../../../frontend/src/pages/FeedThread.tsx) | 197 |
| [pages/FeedTransparency.tsx](../../../frontend/src/pages/FeedTransparency.tsx) | 64 |
| [pages/FeedbackPage.tsx](../../../frontend/src/pages/FeedbackPage.tsx) | 236 |
| [pages/GithubCallback.tsx](../../../frontend/src/pages/GithubCallback.tsx) | 204 |
| [pages/Home.tsx](../../../frontend/src/pages/Home.tsx) | 87 |
| [pages/ImportMultisig.tsx](../../../frontend/src/pages/ImportMultisig.tsx) | 344 |
| [pages/Leaderboard.tsx](../../../frontend/src/pages/Leaderboard.tsx) | 160 |
| [pages/LegacyCollectionView.tsx](../../../frontend/src/pages/LegacyCollectionView.tsx) | 142 |
| [pages/MarketplaceV2Preview.tsx](../../../frontend/src/pages/MarketplaceV2Preview.tsx) | 81 |
| [pages/MultisigHub.tsx](../../../frontend/src/pages/MultisigHub.tsx) | 200 |
| [pages/MultisigView.tsx](../../../frontend/src/pages/MultisigView.tsx) | 330 |
| [pages/NotFound.tsx](../../../frontend/src/pages/NotFound.tsx) | 53 |
| [pages/OrganizationsPage.tsx](../../../frontend/src/pages/OrganizationsPage.tsx) | 83 |
| [pages/PluginPage.tsx](../../../frontend/src/pages/PluginPage.tsx) | 54 |
| [pages/PointsPage.tsx](../../../frontend/src/pages/PointsPage.tsx) | 50 |
| [pages/ProfilePage.tsx](../../../frontend/src/pages/ProfilePage.tsx) | 482 |
| [pages/ProposalView.tsx](../../../frontend/src/pages/ProposalView.tsx) | 561 |
| [pages/ProposeDAO.tsx](../../../frontend/src/pages/ProposeDAO.tsx) | 404 |
| [pages/ProposeTransaction.tsx](../../../frontend/src/pages/ProposeTransaction.tsx) | 384 |
| [pages/PublisherConsole.tsx](../../../frontend/src/pages/PublisherConsole.tsx) | 264 |
| [pages/QuestAdmin.tsx](../../../frontend/src/pages/QuestAdmin.tsx) | 145 |
| [pages/QuestDetail.tsx](../../../frontend/src/pages/QuestDetail.tsx) | 332 |
| [pages/QuestHub.tsx](../../../frontend/src/pages/QuestHub.tsx) | 327 |
| [pages/Settings.tsx](../../../frontend/src/pages/Settings.tsx) | 282 |
| [pages/SpaceInvadersGame.tsx](../../../frontend/src/pages/SpaceInvadersGame.tsx) | 5 |
| [pages/TokenDashboard.tsx](../../../frontend/src/pages/TokenDashboard.tsx) | 188 |
| [pages/TokenDetail.tsx](../../../frontend/src/pages/TokenDetail.tsx) | 201 |
| [pages/TokenLane.tsx](../../../frontend/src/pages/TokenLane.tsx) | 156 |
| [pages/TokenView.tsx](../../../frontend/src/pages/TokenView.tsx) | 310 |
| [pages/TransactionView.tsx](../../../frontend/src/pages/TransactionView.tsx) | 649 |
| [pages/Treasury.tsx](../../../frontend/src/pages/Treasury.tsx) | 328 |
| [pages/TreasuryProposal.tsx](../../../frontend/src/pages/TreasuryProposal.tsx) | 231 |
| [pages/UnifiedMarketplace.tsx](../../../frontend/src/pages/UnifiedMarketplace.tsx) | 262 |
| [pages/UserRedirect.tsx](../../../frontend/src/pages/UserRedirect.tsx) | 119 |
| [pages/ValidatorProfile.tsx](../../../frontend/src/pages/ValidatorProfile.tsx) | 685 |
| [pages/Validators.tsx](../../../frontend/src/pages/Validators.tsx) | 844 |
| [pages/ValidatorsHacker.tsx](../../../frontend/src/pages/ValidatorsHacker.tsx) | 409 |
| [pages/gnolove/GnoloveAIReports.tsx](../../../frontend/src/pages/gnolove/GnoloveAIReports.tsx) | 108 |
| [pages/gnolove/GnoloveAnalytics.tsx](../../../frontend/src/pages/gnolove/GnoloveAnalytics.tsx) | 591 |
| [pages/gnolove/GnoloveContributorProfile.tsx](../../../frontend/src/pages/gnolove/GnoloveContributorProfile.tsx) | 588 |
| [pages/gnolove/GnoloveHome.tsx](../../../frontend/src/pages/gnolove/GnoloveHome.tsx) | 597 |
| [pages/gnolove/GnoloveMilestone.tsx](../../../frontend/src/pages/gnolove/GnoloveMilestone.tsx) | 86 |
| [pages/gnolove/GnoloveNotablePRs.tsx](../../../frontend/src/pages/gnolove/GnoloveNotablePRs.tsx) | 461 |
| [pages/gnolove/GnoloveReport.tsx](../../../frontend/src/pages/gnolove/GnoloveReport.tsx) | 583 |
| [pages/gnolove/GnoloveTeamProfile.tsx](../../../frontend/src/pages/gnolove/GnoloveTeamProfile.tsx) | 5 |
| [pages/gnolove/GnoloveTeams.tsx](../../../frontend/src/pages/gnolove/GnoloveTeams.tsx) | 106 |
| [pages/studio/StudioHome.tsx](../../../frontend/src/pages/studio/StudioHome.tsx) | 86 |
| [pages/studio/StudioManage.tsx](../../../frontend/src/pages/studio/StudioManage.tsx) | 118 |
| [pages/studio/sections/AllowlistSection.tsx](../../../frontend/src/pages/studio/sections/AllowlistSection.tsx) | 115 |
| [pages/studio/sections/MintSection.tsx](../../../frontend/src/pages/studio/sections/MintSection.tsx) | 355 |
| [pages/studio/sections/PhasesSection.tsx](../../../frontend/src/pages/studio/sections/PhasesSection.tsx) | 104 |
| [pages/studio/sections/SettingsSection.tsx](../../../frontend/src/pages/studio/sections/SettingsSection.tsx) | 168 |
| [pages/studio/sections/WithdrawSection.tsx](../../../frontend/src/pages/studio/sections/WithdrawSection.tsx) | 62 |

## Shared foundations examined

- [Layout and application state](../../../frontend/src/components/layout/Layout.tsx), desktop/mobile shell and navigation.
- [Navigation manifest](../../../frontend/src/lib/navManifest.ts), flags and mobile label overrides.
- [Design-system policy](../../DESIGN_SYSTEM.md), [global tokens and styles](../../../frontend/src/index.css), [semantic aliases and scales](../../../frontend/src/tokens.css), [mobile ergonomics](../../../frontend/src/mobile-tokens.css).
- [Shared transaction confirmation](../../../frontend/src/components/ui/TxConfirmation.tsx), [accessible dialog](../../../frontend/src/components/AccessibleDialog.tsx), onboarding and deployment/status primitives.
- [Home variants](../../../frontend/src/pages/Home.tsx), [member hero](../../../frontend/src/components/home/MemberHero.tsx), home styles.
- [Plugin registry](../../../frontend/src/plugins/registry.ts): Proposal Explorer, Channels/board, GnoSwap, leaderboard and payroll.
- [Route metadata](../../../frontend/src/lib/routeMeta.ts), [HTML metadata](../../../frontend/index.html), [feed crawler handler](../../../frontend/netlify/edge-functions/feed-og.ts), [deployment routing](../../../netlify.toml), and the default OG image.

## Evidence discipline

Feature flags, route presence and plugin registration establish that a surface exists in source; they do not establish that it is enabled or contract-compatible on a particular network. The latest cleanup at this snapshot removes orphaned dashboard/agent pages; those removed pages are not treated as live product surfaces. Marketplace agent-related components are a separate retained surface.
