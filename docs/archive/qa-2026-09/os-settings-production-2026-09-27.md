# Memba OS Settings production QA

27 September 2026. Settings is the next feature in the one-PR-per-feature audit programme. This branch is stacked after Wallet/Send PR #1349, which is stacked after shell PR #1345. Feed/Live and Tokens have separate active lanes.

## Production baseline and scope

Ten read-only perspectives inspected all seven Settings sections: Desktop (theme, wallpaper, icon size), Notifications, Safety and reset, Network, Transactions, Account, and About. The live guest route `https://memba.club/os/settings` was checked at desktop, 320 px phone, and landscape sizes. The reset dialog was opened and cancelled in production. No production preference was changed, no reset was confirmed there, and no wallet was connected or transaction signed. Member and destructive paths were exercised against local browser fixtures.

## Ten QA perspectives

| Perspective | Main finding or evidence |
|---|---|
| Product journey and UX | Gas defaults could exceed transaction limits; guest Profile and Network copy promised actions unavailable in the observed state. |
| Accessibility | Shell shortcuts broke reset-modal focus isolation; gas errors were not tied to the invalid field; mutually exclusive appearance controls used toggle semantics. |
| Privacy and security | Reset missed chain-scoped username caches. Desktop pin storage was scoped to wallet but not chain. |
| Cross-browser and devices | All seven production guest sections fit a 320 px phone and landscape viewport. Baseline automation lacked short-height dialog and WebKit cases. |
| Visual design | Desktop presentation and contrast were sound. The reset dialog needed a viewport height limit and internal scrolling. |
| QA engineering | Client-side deep links, cross-tab gas changes, reset after later window edits, malformed stored gas and member Account were under-tested. |
| Content and trust | Safety implied every Memba review showed account and gas; Notifications implied more alert producers than the bell currently has; phone had no network switch control. |
| Gno chain integration | Stored gas defaults bypassed the explicit 500 million gas cap; deploys multiply by five. The shown RPC host was the configured primary, not necessarily the active fallback. |
| Performance and state lifecycle | Reset removed storage keys but live windows and desktop icons could re-save old state; Settings section could remain stale after an in-app deep link. |
| Architecture | Classic and OS gas forms had different validation; a denied sessionStorage toast could persist a network change without reloading; Classic theme survived an OS appearance reset. |

## Changes in this branch

- Bound default gas wanted to 100 million so fivefold deploy defaults stay within the 500 million broadcaster limit; bound flat default fees to 10 GNOT. Validate stored values and both Classic and OS Settings inputs, with field-specific errors and unit context.
- Reset chain-scoped cached names and both Classic and OS theme preferences. Notify every open OS tab so live windows and desktop icons cannot recreate pre-reset storage on the next edit. The Settings window remains visible with a result message.
- Use a native modal dialog for reset, suppress shell shortcuts while a modal is active, and restore focus to its trigger. Cap its height so actions remain reachable in a short viewport.
- Follow section deep links in an already-open Settings window and show the standard fallback for unsupported sections. Detect cross-tab gas changes before overwriting them; Classic Settings asks which value to keep when the same field changed elsewhere.
- Offer network switching in Settings when more than one network is selectable, including on phones. Treat the optional switch toast as best effort, roll back failed required preference writes, and clarify that the displayed RPC is the configured primary.
- Narrow notification and signing-review copy to behavior that exists today; show Profile from a connected account only.

## Verification

Local targeted checks: 55 unit tests across gas configuration, Settings, network switching and desktop persistence passed; the production build and targeted ESLint passed. All 36 native Settings browser cases passed across Chromium, Firefox and WebKit. The two-tab reset case includes a stale About window and guest Feed pin. Final PR CI is recorded with the PR after it finishes. The live production limitation remains a connected Adena account and an actual on-chain transaction, which were not available for this audit.
