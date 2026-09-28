# Memba OS About and Feedback production QA

28 September 2026. This audit follows Dev Report PR #1366 in the ordered OS feature stack. It covers the OS About window, Feedback in both OS and classic routes, the GitHub issue submission path, the public on-chain feedback preview, and the feedback quest. Feed/Live, Tokens, NFT Marketplace, App Store and Profile have active sessions and are outside this PR.

## Live baseline

Guest, read-only production checks covered `/os/about`, `/os/feedback` and `/mainnet/feedback` at desktop and 320 px. About displayed the current v7.7.0 build, chain and public-beta guidance; its Blog, Send Feedback and Apply to Join actions opened the intended windows, and its external destinations resolved. The build-info commit matched the page's loaded entry script.

Feedback's production “Open Issues” section showed pull requests because GitHub's Issues API includes PRs. The repository currently has zero open issues. The submit link named a nonexistent `feedback.md` template even though only bug and feature templates exist. Clicking that link awarded the local 20 XP `submit-feedback` quest before a report was submitted; direct backend claims were also accepted. The always-visible betanet “coming soon” card contradicted the deployed mainnet feedback realm, whose `general` channel currently renders a valid empty board. On a failed realm read, the shared board helper mapped null to an empty list, so outages could claim there were no posts. Background OS Feedback windows fetched data and counted page visits without user activation.

## Ten review perspectives

| Perspective | Finding and response |
|---|---|
| Architecture | Feedback uses the issue search endpoint with `is:issue`, open-state and feedback labels, plus a defensive PR filter. The GitHub chooser matches the existing templates. |
| Live UX and responsive design | The CTA, issue rows and metadata now wrap at narrow widths; actions have visible focus treatment. About's internal and external destinations were verified on production. |
| Product and content | Copy identifies the filtered issue list, discloses the required GitHub account, and treats the on-chain feed as a read-only preview. The bug template now asks for the current mainnet or a specified other network. |
| Security and privacy | Untrusted issue titles render as text; issue links stay on the fixed GitHub host, label tints accept only six-digit hex, and external links use `noopener noreferrer`. Build metadata remains bound to the loaded entry. |
| Cross-browser and accessibility | Chromium, Firefox and WebKit exercised 24 OS checks plus classic routes at 1280 and 320 px, populated, empty and error states, keyboard traversal and window navigation. Label and link contrast findings were fixed; targeted final axe scans returned zero violations. Async errors announce with `role=alert`, and Retry targets meet 44 px. |
| API and data integrity | The live GitHub multi-label search returns zero matching issues and uses OR semantics. The live mainnet realm's exact empty response is recognized; null, 404 and malformed zero-thread responses show a retryable error. Raw or escaped closing brackets in board titles remain visible. GitHub failures retain a direct link and offer Retry. |
| Release and regression | The rebased branch starts at merged Dev Report commit `c8495980`; focused frontend and Go quest/leaderboard tests pass. Full local Go service tests need loopback listeners forbidden by this sandbox. |
| Backend quest integrity | `submit-feedback` remains in the XP registry for server-recorded historical totals, while new CompleteQuest, SyncQuests and SubmitQuestClaim paths reject it. The frontend removes it from live and coming-soon catalogs, shows a retired card only for completed history, and reconciles rejected local-only XP after server sync, refreshing already-open quest views. QuestHub no longer displays an endless “syncing…” state. |
| CTO review | Independent final-head review is a release gate; the verdict is recorded on the PR. |
| SWE review | Independent final-head review is a release gate; the verdict is recorded on the PR. |

## Verification and release limits

- Ten focused frontend test files passed 199 tests covering issue filtering, GitHub empty/error/retry, window activation and title, board valid empty/failure/retry, malformed output, raw and escaped board titles, About actions, prospective quest catalogs, historical server completions, rejected local-only XP, mounted widget refresh and the quest sync indicator. TypeScript, ESLint, classic and OS production builds, and `git diff --check` passed.
- Focused backend service tests cover quest retirement, historical leaderboard XP, badge minting, quest parity and XP accumulation. The full service suite cannot run locally in this sandbox because unrelated `httptest` cases require denied loopback binds; PR CI remains the full-suite gate.
- GitHub issue submission requires sign-in, so the production session verified the signed-out redirect and chooser return path without creating an issue. The on-chain board has no posts; populated and failure states were exercised with safe browser fixtures. The cross-browser candidate used a local Vite server and deterministic API interceptions. Accessibility fixes received targeted retests after the 24-case matrix.
- The flag-off bundle gate was corrected in merged PR #1369. The classic and OS builds pass on this rebased branch; current-head CI remains the release gate.
- Shell #1345 through Dev Report #1366 have merged, and production serves Dev Report merge commit `c8495980`. This PR follows #1366; Learn #1370 remains stacked behind it. At rollout, deploy backend quest retirement before the frontend to close old direct-RPC claims first.
