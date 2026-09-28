# Memba OS News production QA

28 September 2026. This audit follows Explorer PR #1360 in the ordered OS feature stack. News includes the OS Blog and Changelogs windows, their classic routes, committed article publishing, RSS and sitemap output, and the optional on-chain Blog reader. Feed/Live, Tokens, NFT Marketplace, App Store, and Profile have active sessions and are outside this PR.

## Scope and live baseline

Guest, read-only journeys were checked on `https://memba.club/os/news` and the classic Blog and Changelogs routes at desktop, 390 px and 320 px widths. Twelve committed articles and their list/detail routes were inventoried. No production wallet was connected and no write was sent. The on-chain Blog flag is off in production, and the configured `memba_blog_v1` realm is absent on official `gnoland-1`; its behavior was verified with local fixtures instead of claiming a live on-chain rollout.

The live site served generic page metadata in the initial HTML for article routes, and OS robots and sitemap output pointed at the classic site. The July articles still described retired test13 plans in the present tense and contained dead calls to action. Blog and Changelogs lacked direct mutual navigation; Changelogs clipped horizontally at 320 px, had no announced selected filter, and delivered its 359 KB source Markdown to render an 11 KB digest. Keyboard focus could be lost on list/detail navigation and an article's metadata could remain on the OS desktop after the News window closed.

## Ten review perspectives

| Perspective | Finding and response |
|---|---|
| Feature inventory | Covered both OS windows, classic routes, twelve committed articles, direct URLs, metadata, RSS, sitemap, robots, and the flag-gated realm source. |
| Live guest journey | Checked list, article, Back, cross-window navigation, filters, unknown slugs and RSS. Added direct Blog/Changelogs links, a full changelog link, and a loading state for on-chain-only slugs. |
| Product and content | Six July articles had outdated testnet guidance and seven dead calls to action. They now distinguish their original publication from 28 September updates and point to current mainnet routes. |
| Accessibility | Changelogs needed an H1, filter state and readable contrast; Blog/detail transitions needed focus. Added semantic headings, `aria-pressed`, theme-aware styles and heading focus on navigation. |
| Visual and responsive design | Changelogs overflowed a 320 px OS window. The new layout wraps content and controls, uses larger entry text, and remains readable at 320 and 390 px in both themes. Long archive scanning remains a follow-up for version/date navigation. |
| Security and privacy | On-chain reads now verify each RPC attempt's chain, validate slug and date, and fail closed on incomplete pages or bodies. On-chain Markdown cannot load remote images; static, reviewed articles retain images. Build-time article metadata escapes HTML attributes and JSON script delimiters. |
| Architecture and performance | Changelogs imported the entire 359 KB source into its lazy chunk. A build-time virtual module emits only the parsed digest: the chunk dropped from 371,722 B / 136,400 B gzip to 19,698 B / 7,793 B gzip. On-chain body reads are limited to four concurrent requests. |
| Publishing and SEO | Classic and OS article URLs now have static HTML shells with article title, summary, canonical, OG/Twitter metadata and BlogPosting JSON-LD. OS builds get an OS-host sitemap and robots file; article HTML stays out of the PWA precache. |
| Cross-browser and device | A read-only matrix covered Chromium, Firefox and WebKit at 1280, 390 and 320 px for classic and OS, with navigation, filter, focus, overflow and RSS checks. Sixteen selected theme/filter axe scans had no violations. |
| Independent engineering review | CTO and SWE review the final diff and current stack head before merge; their verdicts and CI belong on the PR. The release review confirms static article files take precedence over the SPA rewrite and asks for crawler requests on both deploy modes. |

## Verification and release limits

- Focused News, metadata, parser, on-chain and edge tests pass. Classic and OS production builds pass; the OS build emits twelve OS article shells and a fifteen-URL OS sitemap. The classic build emits twelve classic article shells and a twenty-seven-URL sitemap. Frontend ESLint passes. Full frontend tests are rerun on the final stacked base before release.
- Production testing was guest and read only. Missing-realm, RPC failure, incomplete pagination, malicious Markdown and narrow-screen states were exercised locally. The optional on-chain Blog stays off until its realm is deployed and its content policy is reviewed.
- The standard Netlify preview uses classic flags. A crawler-agent request against both classic and OS deploy previews must verify returned title, description, canonical, OG image/URL, sitemap and robots after deployment. The shared RSS intentionally keeps classic-host links. A post-merge production smoke remains necessary.
- Shell #1345, Live/entry #1347, Wallet #1349, Settings #1350, DAOs #1351, Multisig #1352, Arcade #1354, Validators #1356, Quests #1358 and Explorer #1360 have merged in order. Explorer's frontend is deployed; News #1361 is next and still needs current-head CI, crawler HTTP metadata checks and production smoke after merge.
