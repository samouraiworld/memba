# Mainnet A+B release evidence — 2026-09-21

## Scope and coordination

The deployment task owns mainnet realm publication, GPaO and runtime/security holds. This development lane owns frontend release continuity, capability presentation, DAO creation recovery and the first template-v2 text-proposal/vote journey. No real wallet signatures or chain writes were performed by this lane.

At most two implementation PRs are open at once. All changes use isolated feature worktrees; the shared Memba checkout is preserved. Merge requires fresh base, applicable green CI, independent CTO and SWE review of the final revision, and the repository's real approving GitHub review. A local expert review does not satisfy the GitHub branch rule.

## Published baseline

- Frontend commit: `2b843d4f20ada595d13566a96d2637042de78f3c`, v7.7.0.
- Netlify site: `memba-multisig`; production deploy: `6aac2039f82cfa0007eb0de8` (2026-09-17).
- Custom domain `https://memba.samourai.app` matched the immutable deploy artifact in this session. A fresh browser confirmed the current mainnet presentation.
- An initially stale browser showed older 7.5.0 content; its cause was not established. This observation motivated controlled production-build/service-worker tests, not a speculative redeploy.
- This baseline is an observation at the time of verification. Re-read the published commit before and after any merge.

## Candidate evidence

| Slice | Revision / review | Automated evidence | Merge / release |
|---|---|---|---|
| A2 truthful Home and unavailable mainnet token factory | `ad9763f6a6bd80469ad178edbc236d62e3ea6f84`; independent CTO + SWE approval | Full unit: 560 files, 5,596 tests; lint/build; four mainnet/Pearl desktop/mobile browser cases; all GitHub checks green | [PR #1234](https://github.com/samouraiworld/memba/pull/1234); required GitHub review pending; not merged/released |
| A1 release continuity and wallet-safe recovery | `36b17d09d8c917aecb61ad8f07deb36d458a1553`; independent CTO + SWE approval | Full unit: 561 files, 5,595 tests; lint/build; three actual production-build/service-worker upgrade tests; confirmation-provider integration; all GitHub checks green | [PR #1235](https://github.com/samouraiworld/memba/pull/1235); required GitHub review pending; not merged/released |
| B1+B2 scoped creation drafts and durable approval recovery | `dd4e4df58f31f7c43242d3ee2c130af22b4f1d5d`; independent CTO + SWE approval | Full unit: 561 files, 5,616 tests; lint/build/bundle; Chromium, Firefox and iPhone WebKit mocked mainnet submission → reload during polling → inert-status recovery; one wallet call; 320/390/1440px layouts | Branch `fix/dao-draft-context`; queued behind the two-PR limit; not merged/released |
| B3 first text proposal and vote | `b2bc79376bfcb1c5b03c113bcef566d35fff8b4e`; independent CTO + SWE approval | Full unit: 561 files, 5,609 tests; lint/build/bundle; mainnet synthetic wallet/RPC proposal → vote → read-back → reload passes Chromium, Firefox and iPhone WebKit; 320/390/1440px layouts pass | Branch `fix/dao-first-governance-journey`; not merged/released |

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
