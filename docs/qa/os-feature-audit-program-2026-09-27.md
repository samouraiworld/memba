# Memba OS feature audit programme

Started 27 September 2026; statuses updated 30 September. Each feature gets its own production baseline, cross-perspective live QA, focused fixes, regression tests, independent CTO and SWE review, and a separate PR. Features are handled sequentially, with merge order checked against active work before each PR. A production check after deployment confirms the shipped result. Sub-features are inventoried inside each feature's report.

| Feature | Status / coordination |
|---|---|
| OS shell: boot, lock, desktop, phone, launcher, windows, URL/session, connect, notifications | Production QA merged in PR #1345; Live/entry #1347 and Terminal draft sync #1378 followed |
| Terminal and Learn | Production QA merged in PR #1343; earlier combined release |
| Settings | Native Settings #1344 and production QA #1350 merged |
| Feed and Live | Native Feed #1338, Live #1337 and Live/entry #1347 merged |
| Tokens | Reader #1346, creation-event validation #1367 and block and network validation #1371 merged, none of them wired to the window yet. The Tokens window is a holding state until the Launchpad contracts are published; client and indexer follow-ups are drafts |
| Wallet and Send | Production QA #1349 merged |
| DAOs: list, folder, proposal, voting, creation | Production QA #1351 merged |
| Multisig: accounts, proposals, signing | Production QA #1352 merged |
| Market and NFT | Native NFT home #1323 merged. NFT reader #1353 was closed and replaced by the draft stack #1429–#1433; the source realms are not deployed |
| Arcade: lobby, Block Party, Space Invaders, BARRICADE, runs, score verification and attestation | Production QA #1354 merged; on-chain certification remains release-gated |
| App Store | Native catalogue #1355, classic discovery #1384 and review reads #1382 merged; review writing #1385 is open. The on-chain registry and app reviews stay flag-gated in production |
| Validators: consensus, candidates, network nodes, Hacker telemetry, profiles | Production QA #1356 merged |
| Quests: Hub, detail, claims, leaderboard, XP, candidature and attestation | Production QA #1358 merged and deployed |
| Explorer and Directory: tabs, source viewer, search, recent submissions, drawers and URL state | Production QA #1360 merged and deployed |
| Profile | Native Profile and editor foundation #1380 and read-only Home/activity tabs #1427 merged; publishing is off by default. Wallet rehearsal, direct canvas work, accessibility and production re-audit remain release gates; see [Profile plan](../OS_PROFILE_EDITOR_PLAN.md) |
| News: Blog, Changelogs, article publishing and optional on-chain reads | Production QA #1361 merged and deployed |
| Dev Report: Overview, Teams, PR Report, Notable PRs, Analytics, AI Reports, Milestone and details | Production QA #1366 merged and deployed |
| About and feedback | Production QA #1368 merged, after the backend quest retirement #1407 |
| Learn | Production QA #1370 merged |

Every production QA pass above was run as a guest; a connected-member pass across all features is still to do. Meet (#1336) and Market have no QA report yet. Token, NFT and App Store work keeps its own deployment, review and main-branch checks. The remaining Profile release checks are tracked in the Profile plan. Each report records its actual scope and result.
