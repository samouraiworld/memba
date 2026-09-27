# Memba OS feature audit programme

Started 27 September 2026. Each feature gets its own production baseline, cross-perspective live QA, focused fixes, regression tests, independent CTO and SWE review, and a separate PR. Features are handled sequentially, with merge order checked against active work before each PR. A production check after deployment confirms the shipped result. Sub-features are inventoried inside each feature's report.

| Feature | Status / coordination |
|---|---|
| OS shell: boot, lock, desktop, phone, launcher, windows, URL/session, connect, notifications | First audit in `fix/os-shell-production-qa` |
| Terminal and Learn | Production QA merged in PR #1343; earlier combined release |
| Settings | Native Settings work active in a separate worktree; audit after its merge |
| Feed and Live | Active Feed/Activities session; audit after its merge |
| Tokens | Active Tokens session; audit after its merge and mainnet availability check |
| Wallet and Send | Queued |
| DAOs: list, folder, proposal, voting, creation | Queued |
| Multisig: accounts, proposals, signing | Queued |
| Market | Queued |
| NFT | Queued |
| Arcade: lobby, games, runs, rewards | Queued |
| App Store | Queued |
| Validators | Queued |
| Quests | Queued |
| Explorer | Queued |
| Profile | Queued |
| News | Queued |
| Dev Report | Queued |
| About and feedback | Queued |

The queue after the shell is ordered by live risk and dependencies: Wallet/Send, DAOs, Multisig, Market, NFT, then the remaining public and account apps. Settings, Feed/Live and Tokens enter the queue once their active implementation lanes merge. The order may change when a production finding or dependency warrants it; each report records the actual scope and result.
