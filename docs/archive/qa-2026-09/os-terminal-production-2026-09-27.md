# Memba OS Terminal and Learn: production QA

27 September 2026 · Baseline: `memba.club/os/terminal` after PR #1340 · Follow-up branch: `fix/os-terminal-production-qa`

## Scope and method

Ten independent expert perspectives exercised the deployed guest experience in isolated browser contexts. The work was read-only: no wallet signing, deployment, or chain mutation. Production checks covered Chromium, Firefox, and WebKit; desktop, 390 px, and 320 px layouts; live `gnoland-1` reads; two-tab storage behavior; offline and slow RPC; keyboard and axe checks; large drafts; resource loading; and the Learn handoff. WebKit was available to the cross-browser reviewer; some other reviewers had only Chromium and Firefox.

| Perspective | Production journey and result |
|---|---|
| Chain security | Live `render`, `file`, `funcs`, `pkgs`, and `balance` reads succeeded for deployed paths; unknown commands and unsafe filename input were rejected. Missing paths exposed RPC internals. |
| Accessibility | Keyboard navigation and labels worked; dark CodeMirror tokens failed text contrast, and validation was not associated with the editor. |
| Responsive visual | 320 px Learn and Terminal, theme, and desktop resize checks found clipped windows and a crowded Learn header. |
| Draft integrity | Reload, import/export, Unicode and 32 KiB boundaries passed; an older tab could erase new source, and Reset could leave a package mismatch. |
| Command UX | Busy state, focus recovery, validation, and output truncation passed; the example path failed, long output did not scroll on its first result, and Arrow Up had no recall. |
| Cross-browser | Chromium, Firefox, and WebKit passed core desktop and phone journeys; the missing example and RPC stack traces reproduced in all three. |
| Learn content | Four lesson links and playlist responded; the player made no YouTube requests before activation. Load wording and 320 px header needed polish. |
| Resilience | Slow RPC disabled duplicate submission; reconnect after an offline query was blocked by the 60-second unreachable cache. Transport text was raw. |
| Performance and privacy | A 28,117-character draft persisted without network transmission; phone CodeMirror expanded to roughly 18,736 px. Idle and consent checks passed. |
| First-use product journey | Read-only/local-draft warnings were clear; the phone prompt started behind the dock, and Build lacked a direct deployment lesson link. |

## Findings and follow-up

| Severity | Production finding | Follow-up in this branch |
|---|---|
| P1 | Two open tabs could silently overwrite one another's source. | Storage events synchronize tabs; a stale write is stopped and offers explicit load/replace choices. |
| P1 | Dark editor tokens had very low contrast. | Theme-specific Gno syntax colors and editor validation attributes. |
| P1 | The suggested `r/gnoland/home` realm is absent; missing paths showed Go stack traces. | A verified `r/gov/dao` example and concise read/render errors. |
| P1 | A strict read could fail over to an RPC before its chain identity check completed. | Terminal now verifies each endpoint immediately before its ABCI request, including fallbacks; guarded reads cannot share an unguarded in-flight request. |
| P2 | Mobile prompt began behind the dock; large phone drafts expanded to page height. | A bounded phone sheet, visible prompt, and internally scrollable editor. |
| P2 | An open desktop window could be clipped after viewport shrink. | The window manager fits existing frames to the measured desk. |
| P2 | A first long command result stayed at scroll position zero. | Scroll follows the committed result in a layout effect. |
| P2 | Reconnecting immediately after an offline attempt still failed for up to 60 seconds. | Explicit Terminal commands reprobe unreachable RPCs; chain mismatch remains excluded. |
| P2 | Reset could put `package hello` under a different realm name. | Reset restores path and source together. |
| P3 | No command recall or explanation of the 20-result limit. | Arrow Up/Down history and a visible latest-results note. |
| P3 | Empty `pkgs` text and transport errors lacked useful context. | Command-specific empty text and concise failure messages. |
| P3 | Learn's button implied immediate playback but only loaded the player; 320 px header was cramped. | “Load playlist” copy and a wrapping header. |
| P3 | Build did not link directly to deployment instructions. | “How to deploy” links to the existing PeerDev lesson. |

## Verification plan for the follow-up PR

- TypeScript/Vite build, lint, targeted unit tests for command errors, RPC retry, strict fallback ordering, and window fitting.
- OS Playwright journeys in Chromium and Firefox for guest commands, draft persistence and size limits, two-tab updates and stale writes, Reset, Learn consent, history, phone layout, and token contrast.
- Production release should be checked again after deployment for real RPC results, browser layout, and YouTube consent. This report describes the production baseline and local follow-up verification; it does not claim the new branch is already deployed.

## Boundaries

Terminal remains a read-only chain inspector and local draft editor. Generic evaluation, local compilation, `addpkg`, and wallet transactions are outside this release. The QA session deliberately did not sign or broadcast anything.
