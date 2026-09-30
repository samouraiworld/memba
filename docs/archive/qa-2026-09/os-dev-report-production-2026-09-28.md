# Memba OS Dev Report production QA

28 September 2026. This audit follows News PR #1361 in the ordered OS feature stack. Dev Report retains the existing `/gnolove` routes inside the OS window and classic site. Feed/Live, Tokens, NFT Marketplace, App Store and Profile have active sessions and are outside this PR.

## Scope and live baseline

Guest, read-only checks covered Overview, Teams, PR Report, Notable PRs, Analytics, AI Reports and Milestone, plus contributor and team details, unknown routes, filters, exports and deep links. Desktop, 390 px and 320 px layouts were checked in classic and OS. The public Gnolove API responded for its reports, teams, topics, statistics, boards, AI reports and milestone; no wallet connection or write was used.

The live September PR Report's status tabs listed 584 all, 322 merged, 116 in progress, 125 waiting and 21 blocked, but its narrative summarized a different unfiltered set. A completed 183/183 milestone still displayed historical present-tense work copy. Team roster metadata was last synced in June while Overview metrics were recent. Notable board #66 had an `On hold` item shown in List but omitted from Board, and invalid `?board=` links looked like an empty #66. Weekly AI reports repeated project names and collided on DOM anchors. Analytics matched team member logins case-sensitively even though the live API uses both `kouteki` and `Kouteki`.

## Ten review perspectives

| Perspective | Finding and response |
|---|---|
| Feature inventory | Covered seven navigation tabs, two detail types, classic and OS URLs, filters, sharing, exports, analytics, API states and source freshness. |
| Live guest journey | Verified all seven routes at desktop and narrow widths, direct links, URL filters and both Notable views. Distinguished transient loading from a settled empty state. |
| Product and content | Invalid boards now disclose that the board is unavailable; Board includes live statuses missing from metadata. Completed milestone text is explicitly historical, and built-in team rosters are labelled. |
| Visual and accessibility | Classic seven-tab and OS detail layouts have no document overflow at 1280, 390 or 320 px. Twenty-four scoped WCAG 2/2.1 A/AA axe scans found no violations. Overview time tabs passed keyboard arrow navigation. |
| Data integrity | PR Report status counts, narrative and Markdown use the same period, team, repository and status scope. Case-insensitive login matching keeps `Kouteki` in Core Team analytics, PR filters, labels and badges; CSV, Markdown and PDF include the report status as well as raw GitHub state. |
| Security and privacy | AI text and PR titles are escaped as plain text in both Markdown export paths. Report PR links are restricted to GitHub PR URLs in the page, Markdown and CSV. Contributor API outages are distinct from genuine 404s. |
| Architecture and performance | Full and yearly PR reports, plus any read over 128 KB, stay in memory; a quota retry evicts the oldest saved read. Inactive OS windows stop Team Hub health and metric polling. |
| Release operations | AI Reports and Milestone distinguish errors from empty results with retry and page headings; Overview's relative sync age advances while visible. Page metadata follows the active OS window and canonical URLs omit query/hash state. |
| Cross-browser and device | Chromium, Firefox and WebKit covered 114 classic/OS route and control checks at 1280 and 320 px, plus a 36-case targeted rerun. Synthetic populated data produced 18 valid CSV, Markdown and PDF downloads across the three browsers and two surfaces. No confirmed product defect remained. |
| Independent engineering review | CTO and SWE independently reviewed the final candidate and approved after export, cache and URL fixes. Their verdicts, final head and CI are recorded on the PR. |

## Verification and release limits

- All 386 focused Dev Report tests pass, as do TypeScript, ESLint, `git diff --check`, and final classic and OS production builds. PR CI and the ordered merge gate are release checks.
- The production exercise was guest and read only. Error, empty, stale and malformed API conditions were exercised with local tests. The local Gnolove backend was unavailable for populated AI and contributor screens; live API data and synthetic report data covered those behaviors without claiming a fully populated local journey. The published OS will reflect these fixes only after the ordered stack deploys.
- Shell #1345, Live/entry #1347, Wallet #1349, Settings #1350, DAOs #1351, Multisig #1352, Arcade #1354, Validators #1356, Quests #1358, Explorer #1360 and News #1361 have merged in order. Dev Report #1366 is next, subject to News production deployment, current-head CI, exact-head review and post-merge guest smoke.
