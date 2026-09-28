# Memba OS Arcade production QA

28 September 2026. This feature audit follows Multisig PR #1352 in the ordered OS audit stack. Feed/Live, Tokens, NFT Marketplace, App Store and Profile have separate active sessions and are outside this PR.

## Scope and production baseline

The audit covers the OS Arcade lobby, Your runs, Daily board, Block Party Daily and Practice, Space Invaders Daily and Free play, BARRICADE Daily and Practice, local scores, server replay verification, and the dormant on-chain attestation path. A guest opened `https://memba.club/os/arcade`, `/os/arcade/runs`, `/os/arcade/daily-board`, and all three game windows on production. Practice/Free play input, pause, undo, and between-wave choices were checked without a wallet. The live browser had no member wallet; no production Daily score, signature, or transaction was submitted. Member, error, narrow-window and lifecycle journeys were checked with local fixtures.

The production lobby said score certification was unavailable, while Block Party's own Daily screen offered a server-verified leaderboard. The combined Arcade board and on-chain attestation were correctly unavailable. This PR makes the distinction explicit. Space Invaders' local replay check is a separate status, and BARRICADE scores remain local while certification is off.

## Ten review perspectives

| Perspective | Finding and response |
|---|---|
| Product journey | The lobby conflated game-specific and combined score states; copy now identifies Block Party's own Daily board and the dormant Arcade attestation. Connected streak cache keys also follow the selected chain. |
| Game UX and content | BARRICADE's start controls were below a tall canvas in narrow windows; controls move before the canvas there. Game and queued-attestation copy no longer promises a result that the release gate cannot deliver. |
| Accessibility | Game overlays, between-wave choices, clipboard failure and keyboard focus needed explicit recovery. Focus and status feedback were added; local axe and keyboard review continues through the final test pass. |
| Score and chain integrity | Space Invaders accepted an active-state or padded post-terminal replay, and Block Party accepted an empty or unfinished Daily log. Both server paths now require the run to end exactly at its terminal input before recording a score or streak. |
| Auth and abuse resistance | Block Party's first connect-and-post click used stale wallet state. The flow resumes only after the connected account is current. Public historical challenge derivation is bounded before chain work. |
| OS lifecycle | Global Block Party keys could spend moves in a background game; Space Invaders and BARRICADE continued simulating behind another OS window or the connect modal. Input is scoped to the active game and simulations pause when it loses focus or the desk is blocked. |
| Visual and responsive design | All three games used viewport breakpoints inside resizable OS windows. Container-width layouts keep playfields usable from 320 px through desktop, with visible BARRICADE start controls and forced-colors affordances. |
| Cross-browser and device | Desktop and phone game journeys were exercised in Chromium and Firefox, with touch in Chromium. A separate WebKit iPhone 13 smoke opened all three games, started Space Invaders and changed BARRICADE lanes with touch at 390 px without page errors or horizontal overflow. Firefox's Playwright mobile-touch context stalls before navigation; this harness limitation is recorded below. |
| Architecture and availability | Minimise unmounted game state, Practice best could absorb a Daily score, and optional BARRICADE 3D could fail offline. Game windows remain mounted but hidden and inert, score writes follow their actual mode, and 3D errors fall back to 2D. Parked games also stop idle frame work and the 3D scene renders on demand outside active play. |
| Attestation operations | A generic non-improving realm response falsely marked a different run attested; retry counts reset on restart; equal-score row selection was unstable. The batcher checks the exact on-chain log, persists failures including receipt-write errors, chooses ties deterministically, holds lower runs behind a parked best, and lets other boards progress after a readback failure. |

## Verification and release limits

- The live production pass was a guest check. The OS attestation and native score certification release flags remain off. This PR does not activate or claim live on-chain signing.
- Local Arcade, Block Party and database Go package suites passed, including regressions for terminal replay binding, a parked best run, bounded receipt-write retries, and readback failure isolation. Ten focused frontend test files passed (80 tests), and the post-review streak and replay checks passed (23 tests); the production build, TypeScript, and full ESLint passed after the reviewer follow-up. The Arcade OS Playwright suite passed 17 Chromium/Firefox cases with one Firefox mobile-touch case skipped before navigation because its test context cannot initialize in this harness; an additional Chromium connect-modal pause case passed. A full local Vitest run reached an unrelated Gno toolchain test that fails under the installed `GNOROOT` (`chain/runtime/unsafe` is missing); PR CI will verify the complete suite in its pinned environment.
- Desktop and phone OS windows were tested at default and narrow widths. The local Playwright Firefox mobile-touch fixture stalls at viewport setup before the app loads; Firefox phone-layout tests and Chromium touch tests cover the available paths. Some touch tests dispatch pointer events rather than driving device hardware.
- On-chain readback uses the realm's `GetEntryJSON(game, day, addr)` query in the local ceremony source. The changed batcher was verified against a simulated RPC response; it has not been broadcast against the live realm. Activation still requires an allowlisted attester, funded key, realm and chain checks, and a controlled end-to-end rehearsal described in `backend/docs/ARCADE_CERTIFY_RUNBOOK.md`.

Merge order is Shell PR #1345, Live/entry PR #1347, Wallet PR #1349, Settings PR #1350, DAO PR #1351, Multisig PR #1352, then this Arcade PR. Live/entry PR #1347 touches the shell and some feature tests, so the stacked QA branches need an integration refresh after it lands. Shell PR #1345 is blocked by required review; no stacked PR is eligible to merge until that gate and each PR's own checks are satisfied.
