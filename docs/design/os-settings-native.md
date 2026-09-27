# Native Memba OS Settings

Status: Implemented — local browser acceptance passed; PR and CI review pending

## Goal

Replace the classic Settings accordion inside the OS window with a native Settings window. Keep the classic Settings page unchanged for the classic site. The first direct OS route must remain /os/settings.

## Evidence and ownership

- Initial base: Memba origin/main 704e0d9b. Worktree: Memba-worktrees/os-native-settings, branch feat/os-native-settings. Refresh and rebase before push.
- Live beta guest QA reproduced that choosing Black in the classic accordion writes memba_theme but leaves memba_os_theme and data-os-theme light.
- The Terminal QA chat owns its separate worktree and PR #1343. The Launchpad chat owns deployer work. The roadmap chat owns the merge queue. This branch owns only native Settings and its focused tests/docs.

## User behavior

- The Settings sidebar has Desktop, Notifications, Safety, Network, Transactions, Account, and About. Home opens Desktop. No Directory accordion remains.
- Desktop changes OS appearance (System, Light, Dark), one of the five existing wallpapers, and desktop icon size. A change takes effect without reloading and survives a fresh tab. Classic-site appearance stays separate. System follows OS color scheme changes.
- Notifications honestly describes the current notification source and offers no fake delivery toggle.
- Safety provides a review sheet before resetting local UI state. Cancel changes nothing. Confirm removes only the enumerated classic cache and OS shell/preference keys; it preserves DAO and Terminal drafts, recipients, send locks, wallet/session secrets and on-chain data.
- Network shows the selected chain and network status read-only; the menu bar remains the network switcher.
- Transactions edits the existing memba_settings gas defaults through validated positive safe integers. Gas wanted also keeps the derived fivefold deploy limit safe. It changes no signing or transaction code and never submits a transaction.
- Account shows the connected address or a guest explanation and the existing connect action. About opens the existing About system window.

## Implementation limits

- Native view lives in frontend/src/os/apps/settings/native.tsx and uses AppShell and OS tokens. All new app styling is scoped to the OS.
- The OS root owns appearance state, so its wallpaper and theme respond to Settings in the current tab. Storage refusal still allows a visit-only preference.
- Desktop icon size changes OS desktop tiles only. Phone home tiles keep their existing size.
- Do not modify backend, contract, transaction signing/broadcast, production flags, Netlify configuration, or classic Settings JSX/CSS.

## Runnable acceptance

1. OS browser tests: direct route and seven sections; theme immediate/persistent/system behavior; wallpaper and icon size; validated gas save; reset confirm/cancel and draft preservation; About and guest account; desktop/phone layout.
2. Focused unit tests: preference validation, storage fallback, reset allowlist, and any extracted gas-input validation.
3. Existing Settings-dependent OS tests are updated to test the new native view, while classic Settings remains covered on its own route.
4. Full frontend units, lint, build, OS artifact gate, and Chromium OS suite pass on the final head. Capture light, dark, narrow window, and phone screenshots; inspect keyboard focus and accessible names.
5. Stage explicit paths and run the repository attribution checker before push. Merge needs current base, exact-head independent reviews, formal required approval, and green CI, coordinated with the merge queue.

## QA scope

The read-only beta sweep covers guest direct routes on desktop, both themes for high-value apps, and selected phone routes. It does not simulate a connected member or sign/broadcast. Findings are kept in a separate review artifact and distinguish observed defects from known product gates.
