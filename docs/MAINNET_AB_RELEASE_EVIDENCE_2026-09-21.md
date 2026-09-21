# Mainnet A+B release evidence — 2026-09-21

## Scope and coordination

The deployment task owns mainnet realm publication, GPaO and runtime/security holds. This development lane owns frontend release continuity, capability presentation, DAO creation recovery and the first template-v2 text-proposal/vote journey. No real wallet signatures or chain writes were performed by this lane.

At most two implementation PRs are open at once. All changes use isolated feature worktrees; the shared Memba checkout is preserved. Merge requires fresh base, applicable green CI, independent CTO and SWE review of the final revision, and the repository's real approving GitHub review. A local expert review does not satisfy the GitHub branch rule.

## Published baseline

- Frontend commit: `5e9be8982743ed29d150ed065203089f95b189b8`, v7.7.0, following the owner’s merge of #1234.
- Netlify site: `memba-multisig`; production deploy: `6ab184e058cc2f00089919d6` (published 2026-09-21 19:27 UTC). Previous baseline: `2b843d4f20ada595d13566a96d2637042de78f3c` / deploy `6aac2039f82cfa0007eb0de8`.
- Custom domain `https://memba.samourai.app` matched the immutable deploy HTML SHA-256 `cd0f3a09caa49204132d3e48d6ae8804c38a7800e51e778401d2ac08a3a8f870` and entry `/assets/index-DsZ8QD3i.js`. A fresh immutable-origin browser confirmed the corrected Home labels. The returning production origin initially displayed its cached older Home, then adopted the new entry after the service-worker update and a later reload. Mainnet tokens showed “Not available on this network”; Pearl retained its token creation control. No wallet was connected or used.
- An initially stale browser showed older 7.5.0 content; its cause was not established. This observation motivated controlled production-build/service-worker tests, not a speculative redeploy.
- This baseline is an observation at the time of verification. Re-read the published commit before and after any merge.

## Candidate evidence

| Slice | Revision / review | Automated evidence | Merge / release |
|---|---|---|---|
| A2 truthful Home and unavailable mainnet token factory | `ad9763f6a6bd80469ad178edbc236d62e3ea6f84`; independent CTO + SWE approval | Full unit: 560 files, 5,596 tests; lint/build; four mainnet/Pearl desktop/mobile browser cases; all GitHub checks green | [PR #1234](https://github.com/samouraiworld/memba/pull/1234); owner merged at `5e9be898`; production verified as above |
| A1 release continuity and wallet-safe recovery | `488842d79b4170091dc8fb941d6f006e57cd1f5d`; independent CTO + SWE approval after merging current main | Refreshed full unit: 561 files, 5,600 tests; lint/build/bundle; three actual production-build/service-worker upgrade tests pass on the updated head; confirmation-provider integration; hosted CI running | [PR #1235](https://github.com/samouraiworld/memba/pull/1235); required GitHub review pending; not merged/released |
| B1+B2 scoped creation drafts and durable approval recovery | `e6e8087b849f6f95f381e35cbea1c60e48ac9fd2`; independent CTO + SWE approval after merging current main | Original slice full unit: 561 files, 5,616 tests; lint/build/bundle; updated-head focused recovery: 72 tests pass; hosted full suite running; Chromium, Firefox and iPhone WebKit mocked mainnet submission → reload during polling → inert-status recovery; one wallet call; 320/390/1440px layouts | [PR #1236](https://github.com/samouraiworld/memba/pull/1236); hosted checks running; not merged/released |
| B3 first text proposal and vote | `215f236a60131bb616439644db25571188335016`; independent CTO + SWE approval after merging current main | Original slice full unit: 561 files, 5,609 tests; lint/build/bundle; updated-head affected suite: 38 tests pass; mainnet synthetic wallet/RPC proposal → vote → read-back → reload passes Chromium, Firefox and iPhone WebKit; 320/390/1440px layouts pass | Branch `fix/dao-first-governance-journey`; not merged/released |

All full-suite counts exclude one skipped file/test. The unchanged production dependency lockfile passes `audit:ci` (no unallowlisted high/critical advisory). Browser writes above are deterministic fixture behavior, not network transaction evidence.

B1 and B2 are combined because draft ownership, durable submission intent and late wallet completion must change atomically. Pending DAO base records retain their prior six-field format; versioned context metadata lives in a sidecar. Bookmark persistence is verified before removing a receipt. Storage failures preserve recoverable context, and known volatile hashes are labelled as tab-only.

## Reproducible validation

Use Node 22 and each slice's isolated checkout. Run `npm ci` in `frontend` before the first validation. The accepted CI matrix also checks Node 20.

- `npm test -- --maxWorkers=2`
- `npm run lint` and `npm run build`
- `npm run check:bundle` and `npm run audit:ci`
- A1: `npm run test:e2e:release` (two real production builds; old service worker, offline shell, missing chunks, denied storage). The required chromium CI job runs it.
- B1+B2: `npx playwright test --config playwright.governance.config.ts --project chromium --project firefox --project iphone --grep "DAO approval receipt"`.
- B3: the same browser/config selection with `--grep "first mainnet text"`.

The governance specs are included by the existing `Professional preview` workflow's `test:e2e:pro-governance` command. Browser fixtures intercept RPC/wallet boundaries; no signing keys are used.

## Release runbook

1. Obtain the real approving GitHub review for the PR. Fetch the latest base, resolve conflicts on the feature branch, and refresh affected tests and exact-revision expert reviews after changes.
2. Confirm all required checks and preview behavior. Coordinate the merge with the deployment owner: merging main can immediately deploy Netlify.
3. Merge one slice. Verify Netlify's published commit and immutable artifact, then verify the custom domain from a fresh browser and a returning browser. Exercise Home and the slice's read-only routes on mainnet and Pearl.
4. Record merge SHA, deploy ID and actual browser observations here before merging the next slice. If a regression appears, fix or revert that slice and verify the deployed rollback first.
5. Open the next queued PR only when a slot is available. B1+B2 and B3 both add governance browser tests; preserve both additions when rebasing. Every slice also adds an Unreleased changelog entry.

A UI rollback must preserve drafts and submission receipts and must never trigger a repeat transaction. Realm publication, migration, custody flags and protocol/runtime upgrades remain outside this frontend release.

## Wallet and realm verification

| Evidence class | Status |
|---|---|
| Automated synthetic wallet/RPC journeys | Passed as recorded above |
| Real non-production wallet rehearsal for these changes | Not performed; coordinate signer, network and amounts with deployment owner |
| Actual mainnet wallet transactions for these changes | Not performed; no mainnet transaction-readiness claim |
| Shared-community/marketplace realm activation | Owned by deployment lane; unchanged by these PRs |

Code review, fixture success and frontend deployment are separate evidence. No bounded suite establishes that the entire application is defect-free.
