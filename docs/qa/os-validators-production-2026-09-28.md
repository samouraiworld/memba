# Memba OS Validators production QA

28 September 2026. This feature audit follows Arcade PR #1354 in the ordered OS audit stack. Feed/Live, Tokens, NFT Marketplace, App Store and Profile have separate active sessions and are outside this PR.

## Scope and production baseline

The audit covers the OS Validators roster, registered operators and candidates, Network nodes, Hacker telemetry, validator profiles, mobile and narrow desktop windows, and classic route equivalents. Guest journeys were checked on `https://memba.club/os/validators`, the Candidates and Network segments, a registered profile, and `/os/validators/hacker`; classic validator and legacy profile routes were also checked. No wallet was connected and no profile edit or transaction was submitted in production. Local fixtures cover error, narrow-window, clipboard, and OS lifecycle states.

Production showed four active consensus validators, while the Candidates segment reported zero active registered operators and 36 candidates. Those counts describe different populations. The Network node role is inferred from peer monikers and is not consensus membership. Hacker reported 25 unknown or closed peer RPCs while the node was synced, and its connection panel offered unknown or wildcard listen values for copying. Returning from a candidate or a filtered roster row lost the user's view state; an empty search showed only a table header. These claims and journeys drove the fixes below.

## Ten review perspectives

| Perspective | Finding and response |
|---|---|
| Live guest journey | Candidate and filtered roster navigation lost context; profile return links and URL-backed roster state preserve the originating view. Empty results now explain the state and offer a clear action. |
| Chain and data integrity | Fallback RPCs could mix chain or height across roster, signatures and operator registry. A verified endpoint and block-height snapshot now pins those reads; pagination, signer caches, detail fanout and cancellation are bounded. The final review caught a short duplicate roster page with no declared total and a missing newest signature block that made a shorter window look current; both now fail closed until a complete sample is available. A profile resolves its requested operator without depending on every unrelated candidate detail; incomplete signing-address scans fail closed. |
| Architecture and performance | Background Validators, Hacker and profile windows kept polling, and candidate details could fan out without a limit. Polling follows OS window activity; operator details use a bounded worker pool and direct RPC abort listeners are released. |
| Accessibility | Copy affordances were not reliable keyboard controls, the Network search lacked a persistent label, and full node IDs were inaccessible. Native buttons, result announcements, a labeled search and a node-ID disclosure address those paths. |
| Visual and responsive design | Network tabs and profile addresses overflowed a 360 px OS window. Container-aware layouts fit the segment strip, address rows and profile heatmap in narrow windows. |
| UX and content | Doctor treated missing telemetry as healthy and warned that ordinary peers had closed RPCs. Status and performance labels now distinguish RPC sync, monitoring and incident availability, signing rate and unassessed checks. Public P2P addresses are copyable only when dialable; the peer roster labels inferred roles without claiming a consensus count. |
| Cross-browser and device | Production guest checks at desktop, 390 px and 320 px exercised tabs, profile navigation and Hacker scrolling. Local Chromium and Firefox OS tests cover 360 px windows and 320 px phone layout. |
| Route integration | OS and classic routes, signing-address canonicalization and legacy valoper redirects worked; search, sort, filter, page and Candidates origin now survive profile navigation. |
| Operational reliability | Hacker polls continued in parked OS windows, initial optional failure could wedge the cockpit, and old RPC or monitoring data stayed green. Independent bootstrap sources, activity gating, stale-data handling, recovery and heatmap overlap protection were added. The final review found the Standard roster still presented retained health and a synced badge as current after refresh failure; both OS and classic views now identify the last retrieved snapshot and offer Retry. |
| Public-data and abuse review | Public views amplified private peer IPs and offered local RPC links; profile copy promised quest secrecy despite a public read API, and a GitHub icon could point elsewhere. Private peer addresses are masked in both peer tables and excluded from raw-IP search, nonpublic RPC links are plain text, quest copy is accurate, and GitHub links require its host. |

## Verification and limits

- Production testing was guest and read only. Profile ownership and wallet editing require a controlled member account and were not exercised live.
- Thirty focused React, data-layer and component test files passed (325 tests), including incident freshness, incomplete roster rejection, signature-window recovery, address masking and retained-roster warnings; full frontend ESLint, TypeScript, the production build, and the flag-off OS bundle gate passed after replay onto merged Arcade. The new OS Playwright regressions passed in Chromium and Firefox for 360 px windows, 320 px phones, empty search, and profile return context (10/10). The existing professional Validators suite passed 38 cases across Chromium, Firefox, iPhone and Pixel layouts. The first OS run revealed an outdated network-peer fixture after chain filtering; the shared fixture was corrected and the browser suites passed.
- Mainnet peer topology comes from public RPC `/net_info`; masking private addresses in Memba does not remove them from that source. The peer roster explicitly labels node roles as inferred from names, separate from the consensus set.
- The production audit cannot verify the shipped changes until deployment. A post-deployment guest smoke is required after the ordered PR stack lands.

Merge order is Shell PR #1345, Live/entry PR #1347, Terminal draft-sync PR #1378, Wallet PR #1349, Settings PR #1350, DAO PR #1351, Multisig PR #1352, classic bundle-gate PR #1369, Token event validator PR #1367, Arcade PR #1354, then this Validators PR. The preceding PRs have merged, and this branch is replayed on Arcade's exact merge commit. Validators must pass current-head CI and required review before merge.
