# Memba OS Learn production QA

28 September 2026, updated 29 September. Learn is a native OS app already live on `memba.club/os/learn`. This follow-up follows merged About & Feedback #1368 at `31959097` and is now rebased on docs-only Profile follow-up #1419 at `2387a45c`. It stays separate from Terminal. The Profile foundation merged as #1380; Feed, Tokens, NFT Marketplace and App Store remain separate work.

## Cross-perspective audit

| Perspective | Evidence and result |
| --- | --- |
| Product and lesson content | The PeerDev deployment and transaction cards linked to command-only READMEs while promising instruction available in adjacent `slides.md` files. Both now point to the explanatory slides. The setup guide's stale clone-relative path is corrected in the card, and the blog-realm title matches its content. |
| Architecture and security | Learn is a lazily loaded native app, its video waits for a user action, and external HTTPS links use `noopener noreferrer`. Existing CSP permits only the intended `youtube-nocookie.com` frame. No wallet or signing path is present. |
| Live UX | The production deep link opens. The deployed player appears after consent but removes its focused button; the new persistent control keeps focus and allows unloading. |
| Accessibility | Base build at 320 px had no horizontal overflow and zero scoped axe findings in Chromium, Firefox and WebKit, but lost focus to `BODY` after loading the player. The external playlist link had a 20 px target. The follow-up keeps focus and gives the player, external link and Terminal actions 44 px minimum height. |
| Media and privacy | The live YouTube playlist is “gno.land Tutorials - Peer Dev” with 19 visible videos (two unavailable videos hidden). A hosted `memba.club` iframe loaded “Setup local environment [Updated]”; playback and captions advanced. The new control can unload it and stop playback. |
| Integration and release | Direct `/os/learn` resolves through the app registry and native view; unknown sections use the shell fallback. The QA tests now cover direct entry, reload, focus, reverse navigation, phone width and fallback. |
| Cross-browser | The candidate passed direct linking, player load/unload, keyboard activation, chapter scrolling and no-overflow checks in Chromium, Firefox and WebKit at 1280 and 320 px. The live production player was also checked. |
| Data provenance | The four source lessons are in the PeerDev repository. Local and staging command contexts are now explicit, and the setup card warns about the upstream README's older path. |

## Verification and limits

- The original candidate passed 13 focused Learn and registry unit tests. After the 29 September rebase, the focused native and registry run passed nine tests. The focus test verifies the same control remains focused while the iframe mounts and unmounts.
- Focused browser tests: four passed across Chromium and Firefox. They cover direct entry, reload, keyboard focus, player toggle, Terminal opening, 320 px overflow and unknown-section fallback.
- A separate read-only cross-browser pass exercised the candidate at 1280 and 320 px in Chromium, Firefox and WebKit. WebKit retained focus through keyboard loading and unloading; all four chapters remained scroll-reachable on the phone sheet.
- The original candidate passed frontend lint, classic and OS TypeScript/Vite builds, and the corrected bundle gate from #1369 (444 files). After rebase, ESLint and a production build passed locally; final current-head PR CI remains a release check.
- External GitHub lesson folders and the production YouTube playlist were verified live by the media QA perspective. The local PeerDev checkout at `ccb659a8` supplied the README and slide content audit. The production verification exercised the old build; the new UI requires a deploy-preview check after the PR builds.
- The Arcade/Explorer flag-off CSS false positive was resolved in merged PR #1369. This Learn PR follows merged About & Feedback #1368 in the ordered feature stack. The refreshed branch still needs current-head CI and production verification before merge.
- Independent CTO and SWE reviews of the exact final commit are required before merge; their verdicts belong in the PR record.
