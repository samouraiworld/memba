# Memba OS feature audit programme

Started 27 September 2026. Each feature gets its own production baseline, cross-perspective live QA, focused fixes, regression tests, independent CTO and SWE review, and a separate PR. Features are handled sequentially, with merge order checked against active work before each PR. A production check after deployment confirms the shipped result. Sub-features are inventoried inside each feature's report.

| Feature | Status / coordination |
|---|---|
| OS shell: boot, lock, desktop, phone, launcher, windows, URL/session, connect, notifications | First audit in `fix/os-shell-production-qa` |
| Terminal and Learn | Production QA merged in PR #1343; earlier combined release |
| Settings | Native Settings merged in PR #1344; ten-perspective production QA and fixes in `fix/os-settings-production-qa`, stacked after Wallet/Send PR #1349 and shell PR #1345 |
| Feed and Live | Active Feed/Activities session; audit after its merge |
| Tokens | Active Tokens session; audit after its merge and mainnet availability check |
| Wallet and Send | Ten-perspective audit and focused fixes in `fix/os-wallet-production-qa`, stacked after shell PR #1345 |
| DAOs: list, folder, proposal, voting, creation | Ten-perspective production QA and focused fixes in `fix/os-daos-production-qa`, stacked after Settings PR #1350 |
| Multisig: accounts, proposals, signing | Ten-perspective production QA and focused fixes in `fix/os-multisig-production-qa`, stacked after DAO PR #1351 |
| Market | Queued |
| NFT | Queued |
| Arcade: lobby, Block Party, Space Invaders, BARRICADE, runs, score verification and attestation | Ten-perspective production and local QA in `fix/os-arcade-production-qa`, stacked after Multisig PR #1352; on-chain certification remains release-gated |
| App Store | Queued |
| Validators: consensus, candidates, network nodes, Hacker telemetry, profiles | Ten-perspective production and local QA in `fix/os-validators-production-qa`, stacked after Arcade PR #1354 |
| Quests: Hub, detail, claims, leaderboard, XP, candidature and attestation | Ten-perspective production and local QA in `fix/os-quests-production-qa`, stacked after Validators PR #1356 |
| Explorer | Queued |
| Profile | Queued |
| News | Queued |
| Dev Report | Queued |
| About and feedback | Queued |

The queue after the shell is ordered by live risk and dependencies: Wallet/Send, DAOs, Multisig, Market, NFT, then the remaining public and account apps. Settings, Feed/Live and Tokens enter the queue once their active implementation lanes merge. The order may change when a production finding or dependency warrants it; each report records the actual scope and result.
