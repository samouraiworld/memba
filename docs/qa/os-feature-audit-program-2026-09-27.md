# Memba OS feature audit programme

Started 27 September 2026; status updated 28 September. Each feature gets its own production baseline, cross-perspective live QA, focused fixes, regression tests, independent CTO and SWE review, and a separate PR. Features are handled sequentially, with merge order checked against active work before each PR. A production check after deployment confirms the shipped result. Sub-features are inventoried inside each feature's report.

| Feature | Status / coordination |
|---|---|
| OS shell: boot, lock, desktop, phone, launcher, windows, URL/session, connect, notifications | Production QA merged in PR #1345; Live/entry #1347 and Terminal draft sync #1378 followed |
| Terminal and Learn | Production QA merged in PR #1343; earlier combined release |
| Settings | Native Settings #1344 and production QA #1350 merged |
| Feed and Live | Native Feed #1338, Live #1337 and Live/entry #1347 merged |
| Tokens | Reader #1346 remains open; downstream Launchpad UI and indexer work is stacked or draft and separately release-gated |
| Wallet and Send | Production QA #1349 merged |
| DAOs: list, folder, proposal, voting, creation | Production QA #1351 merged |
| Multisig: accounts, proposals, signing | Production QA #1352 merged |
| Market and NFT | NFT reader #1353 and marketplace descendants remain draft and gated on source deployment and verification |
| Arcade: lobby, Block Party, Space Invaders, BARRICADE, runs, score verification and attestation | Production QA #1354 merged; on-chain certification remains release-gated |
| App Store | Native catalogue #1355 and its follow-ups remain open and need integration with current main |
| Validators: consensus, candidates, network nodes, Hacker telemetry, profiles | Production QA #1356 merged |
| Quests: Hub, detail, claims, leaderboard, XP, candidature and attestation | Production QA #1358 merged; production deployment and smoke still need verification |
| Explorer and Directory: tabs, source viewer, search, recent submissions, drawers and URL state | Production QA #1360 is next, rebased after Quests and awaiting current-head checks |
| Profile | Native editor proposal #1380 is draft |
| News | Production QA #1361 is stacked after Explorer |
| Dev Report | Production QA #1366 is stacked after News |
| About and feedback | Production QA #1368 is stacked after Dev Report; backend quest retirement must deploy before frontend rollout |
| Learn | Production QA #1370 is stacked after About/Feedback |

The current OS audit path is Explorer #1360, News #1361, Dev Report #1366, About/Feedback #1368 and Learn #1370. Independent Token, NFT, App Store and Profile work enters only when its own deployment, review and main-branch checks are satisfied; each report records the actual scope and result.
