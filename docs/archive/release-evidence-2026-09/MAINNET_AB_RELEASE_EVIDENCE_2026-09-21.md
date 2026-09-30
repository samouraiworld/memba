# Mainnet A+B release evidence — 2026-09-21

## Scope and coordination

The deployment task owns mainnet realm publication, GPaO and runtime/security holds. This development lane owns frontend release continuity, capability presentation, DAO creation recovery and the first template-v2 text-proposal/vote journey. No real wallet signatures or chain writes were performed by this lane.

At most two implementation PRs are open at once. All changes use isolated feature worktrees; the shared Memba checkout is preserved. Merge requires fresh base, applicable green CI, independent CTO and SWE review of the final revision, and the repository's real approving GitHub review. A local expert review does not satisfy the GitHub branch rule.

## Published baseline

- Frontend commit: `843ca35086c6356cdca8238943d0d78f2dcfbb26`, v7.7.0, following the owner’s merge of #1237.
- Netlify site: `memba-multisig`; production deploy: `6ab1a1b113463300086e795e` (published 2026-09-21 21:30 UTC). `build-info.json` identifies the exact merged commit and entry `assets/index-Bgkv6vae.js`.
- Custom domain and immutable deploy Home HTML share SHA-256 `42b1bde5a5c7a42e9808fc896401be2913745248a800212fdf97d61ab0cce8c9`. The returning production browser adopted the new entry after its service-worker update and reload; mainnet creation and Home rendered normally. A fresh immutable-origin browser rendered Home, mainnet GovDAO proposal #6 with its disconnected-wallet eligibility notice, and the Pearl GovDAO dashboard. These read-only GovDAO checks do not establish actual template-v2 transaction success. No wallet was connected or used.
- Previous recovery release: #1236 at `ebb80e5da20e1be44626ab6d7cc1689931ce96eb`, deploy `6ab197f4b20869000836ee2e` (20:48 UTC), entry `assets/index-CezBapfx.js`; returning Home/mainnet creation and fresh mainnet creation/list and Pearl creation were verified.
- Previous continuity release: #1235 at `e6424909d3562f22edfc46d5af4304d45900d1cb`, deploy `6ab18e2814160e000886c272` (20:06 UTC), entry `assets/index-B5ANmuyt.js`; returning Home and fresh Home/Blog were verified.
- Previous verified release: #1234 at `5e9be8982743ed29d150ed065203089f95b189b8`, deploy `6ab184e058cc2f00089919d6` (19:27 UTC). Its corrected Home, mainnet token-unavailable page and retained Pearl token control were verified. Original baseline: `2b843d4f20ada595d13566a96d2637042de78f3c` / deploy `6aac2039f82cfa0007eb0de8`.
- An initially stale browser showed older 7.5.0 content; its cause was not established. This observation motivated controlled production-build/service-worker tests, not a speculative redeploy.
- This baseline is an observation at the time of verification. Re-read the published commit before and after any merge.

## Implementation and release evidence

| Slice | Revision / review | Automated evidence | Merge / release |
|---|---|---|---|
| A2 truthful Home and unavailable mainnet token factory | `ad9763f6a6bd80469ad178edbc236d62e3ea6f84`; independent CTO + SWE approval | Full unit: 560 files, 5,596 tests; lint/build; four mainnet/Pearl desktop/mobile browser cases; all GitHub checks green | [PR #1234](https://github.com/samouraiworld/memba/pull/1234); owner merged at `5e9be898`; production verified as above |
| A1 release continuity and wallet-safe recovery | `488842d79b4170091dc8fb941d6f006e57cd1f5d`; independent CTO + SWE approval after merging current main | Refreshed full unit: 561 files, 5,600 tests; lint/build/bundle; three actual production-build/service-worker upgrade tests pass on the updated head; confirmation-provider integration; hosted checks passed before owner merge | [PR #1235](https://github.com/samouraiworld/memba/pull/1235); owner merged at `e6424909`; production verified as above |
| B1+B2 scoped creation drafts and durable approval recovery | `ca007b3906c011c4cd510498d120cbfdc691f3f6`; independent CTO + SWE approval after merging current main | Original slice full unit: 561 files, 5,616 tests; lint/build/bundle; updated-head focused recovery and wallet integration: 74 tests pass; all hosted checks green before merge; Chromium, Firefox and iPhone WebKit mocked mainnet submission → reload during polling → inert-status recovery; one wallet call; 320/390/1440px layouts | [PR #1236](https://github.com/samouraiworld/memba/pull/1236); owner merged at `ebb80e5d`; production verified as above |
| B3 first text proposal and vote | `6f97b3e44dd5d2e43e360944e1242fce8f4e2a3c`; independent CTO + SWE approval after merging current main | Original slice full unit: 561 files, 5,609 tests; lint/build/bundle; after integrating released recovery: 107 focused tests pass; both recovery and governance journeys pass across Chromium, Firefox and iPhone WebKit (6 cases); test-only follow-up fixes an obsolete disconnected-edit expectation, with 56 DAO browser tests passing in Chromium/Firefox (4 fixture skips); mainnet synthetic wallet/RPC proposal → vote → read-back → reload passes Chromium, Firefox and iPhone WebKit; 320/390/1440px layouts pass; connected proposal-type editing remains covered | [PR #1237](https://github.com/samouraiworld/memba/pull/1237); all hosted checks green; owner merged at `843ca350`; production verified as above |

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

## Completion status

A1, A2, B1+B2 and B3 are merged and frontend-released. [PR #1238](https://github.com/samouraiworld/memba/pull/1238) carries the R1 documentation corrections and this evidence record. Remaining release gates are that PR’s final review/CI/merge and any separately authorized real-wallet rehearsals. Shared realm publication, authority adapters and mainnet ceremony work remain with the deployment task.
