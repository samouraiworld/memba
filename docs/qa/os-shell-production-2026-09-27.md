# Memba OS shell: production QA

27 September 2026 · Production baseline: `memba.club` build `26687cf0` (after Terminal QA PR #1343) · Follow-up branch: `fix/os-shell-production-qa`

## Scope and method

Ten independent perspectives exercised the deployed OS shell in isolated browser contexts. Production checks were read-only and did not request wallet signatures. They covered Chromium, Firefox and WebKit; desktop, phone, short landscape and narrow layouts; keyboard and assistive technology; session continuity; browser history; offline and slow resources; visual design; security and privacy; and repeated window open/close cycles. Source review then traced failures to the shell and its window, URL, and signer state.

| Perspective | Production result |
|---|---|
| Cross-browser | Desktop and phone flows worked in Chromium, Firefox and WebKit. Phone Home exposed Welcome again and needed a second tap. |
| Accessibility | Lock and connect overlays leaked keyboard focus to the desktop. Menus lacked arrow navigation, and windows could only be moved or resized with a pointer. |
| Mobile | Short landscape desktop windows clipped Terminal controls; ordinary portrait flows passed. |
| Security and privacy | Signing review and notices could survive an identity change. Saved window paths were shared across accounts. |
| Resilience | Restored high z-index windows could cover the wallet connect dialog. Offline and lazy-loading fallbacks were usable. |
| Product journey | Search, menu, windows and guest gates were generally clear. Some shell menu copy promised appearance controls the classic Settings page did not offer. |
| State and navigation | Manual lock cleared on reload; a background page redirect could replace the front URL; background page queries could disappear after reload. |
| QA engineering | Guest gates, launcher opening, history, minimisation and token validation passed. Late reconnect could lose a saved member layout; more than twelve windows could be truncated. |
| Visual design | Desktop, 320 px phone, 375 px phone and 200% zoom showed no horizontal overflow. Short landscape Welcome has weak scroll affordance. Production Settings theme choice changes the classic theme but not the OS theme. |
| Performance | Twenty windows and 55 repeated Settings cycles showed stable listeners, nodes and interaction time. Low-end emulation showed the guest prompt in about 3.5 s. Three indexer calls around each 30 s idle interval are expected Live ticker polling. |

## Findings and changes

| Severity | Production finding | Follow-up |
|---|---|---|
| P1 | An old signing request or notices could cross a member disconnect or account switch. | Signer state is keyed by chain and exact member address. Signing requests are serialized; the exact owner is checked after the final asynchronous wallet check. Retry refusal preserves an unknown outcome and recovery receipt when an earlier wallet attempt may have landed. |
| P1 | A lock, connect or transaction review overlay could leave shell controls reachable by keyboard or assistive technology. | Modal focus traps and focus restoration; inactive shell surfaces are inert and hidden from the accessibility tree. Manual lock survives reload and remains active if wallet connection is cancelled. |
| P2 | Saved windows and page queries crossed account boundaries or could be overwritten by a stale tab opening. | Per-chain, per-account storage keys; identity transitions restore the right layout or clear the previous one. Initial page load no longer writes a stale layout. |
| P2 | A wallet identity change on a deep link, or a manual lock, could overwrite another owner’s saved desktop with the old link or an empty layout. | Transition and lock states no longer write to the destination layout. Plain desktop transitions restore the destination owner’s saved windows; linked guest-to-member navigation remains visible without changing the member’s saved desk. A successful wallet sign-in from the lock screen re-enables layout persistence. |
| P2 | A late wallet reconnect could retain a transient guest desk instead of the saved member desk. | Guest-to-member transition recovers an existing member layout, including an intentionally empty one. |
| P2 | Restored z-index values could place windows above dialogs. | Window z-indexes are compacted on restore and before excessive focus growth. |
| P2 | Background page redirects could steal the front URL, and background queries could disappear on reload. | Redirects retarget their own window; background app state is recovered from the scoped saved session. |
| P2 | Phone Home could reveal Welcome, and short landscape clipped window controls. | Home minimises all sheets; short landscape uses the phone sheet layout with safe-area padding. |
| P2 | Menus and window geometry were difficult to use by keyboard. | Arrow/Home/End menu navigation, Escape focus restoration, keyboard move and resize on a focusable title. |
| P2 | More than twelve distinct windows silently truncated during URL or session round-trip. | The shared URL and saved layout now use a consistent budget of 32 background windows plus a front window; both keep the most recent visible windows at that bound. |
| P3 | An invalid OS path changed to `/os` while its Not found window remained. | Keep the invalid path in the address bar until the window closes, so the typo can be corrected or reloaded. |
| P3 | Minimise all and Search Escape left focus on the page. | Menu and launcher return focus to the invoking control when their content disappears. |
| P2 | After native Settings merged, its local reset omitted the new account-scoped window layouts. | Reset now clears scoped layouts across accounts and networks while retaining drafts, recipients and send locks. |

## Verification

- Local targeted unit suite: 107 signing and lock tests passed, with the remaining window/URL/DAO tests also passing. Cases include owner isolation, lock persistence, window stacking, URL round-trip, a deferred signature after an account switch, overlapping signing requests, and refusal after a possible prior wallet attempt.
- Local Playwright shell suite: 24 passed across Chromium and Firefox. Checks include modal focus, lock reload and cancelled connection, saved desktop URL restoration, locked deep links, phone Home and Back, short landscape, menu arrows, keyboard geometry, and invalid links.
- TypeScript build and lint passed. The full repository CI suite and deploy confirmation are PR gates; the branch has not been described as deployed.
- After rebasing onto native Settings PR #1344, 84 of 86 combined Chromium and Firefox browser checks passed; the two failures exposed the scoped reset gap above. Its focused browser rerun passed in both browsers, along with the reset unit test and TypeScript build.
- Final shell browser suite: 28/28 passed across Chromium and Firefox, including linked guest-to-member and member-to-guest layout preservation.
- The final lock-to-wallet sign-in persistence case passed in Chromium and Firefox after the guard correction.
- The full local unit run reached 7,102 tests. Three shell-related fixtures were updated and passed on focused rerun. The local Gno toolchain probe still fails on an unavailable `chain/runtime/unsafe` import; that test and its toolchain code are outside this branch. CI will establish the result in the pinned environment.

## Coordination and limits

Native Settings PR #1344 merged while this shell PR was in review. This branch rebased on that change and resolved its reset integration gap. Feed/Live and Tokens work in other sessions is outside this PR. The 33-window persistence budget, short-landscape Welcome scroll affordance, and expected Live ticker polling are documented tradeoffs. No on-chain transaction was made during production QA.
