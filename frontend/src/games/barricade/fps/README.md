# Barricade FPS — C1 playable preview

This is an opt-in, unranked gameplay/art prototype. Classic v2 remains the default, with unchanged simulation and certification. No shared routes, shell, flags, backend, dependencies or generated assets change. The three FPS JS/CSS families are excluded from the PWA precache; the existing three bundle gate checks that exclusion. No offline support is claimed.

## Open locally

With the existing Barricade gate enabled in the local preview environment, open the existing game route with `?barricadePreview=fps` (for example `/mainnet/game/barricade?barricadePreview=fps`, or the corresponding `/os/arcade/barricade?barricadePreview=fps` window). The game-local wrapper reads the query; the explicit Return to Classic action removes only that parameter. No flag activation is included in this change. The FPS UI and Three scene are separate lazy imports.

## Play

- Drag on the view to aim, or use arrow keys. Hold the Fire button / Space; R reloads. A second touch can hold Fire while the first aims.
- The optional Capture mouse button requests pointer lock **only on that click**. Move to aim and hold the primary mouse button to fire. Escape/P, blur, hidden tab, or inactive OS window pauses; resuming is explicit. Capture rejection leaves drag controls usable.
- You stay behind the barricade. Three converging streets bring CRS with timed shields and robots with a bright weak point. A blue diamond confirms a blocked shield shot; a pale cross confirms damage. Health does not change collider size.
- Three waves, 27 opponents, twelve-round magazine, automatic refill between waves. One +40 repair can be used between waves if the wall is damaged. Repair windows last twelve simulation seconds and can be skipped.
- End screen verifies the complete state against a local replay and exports the versioned journal. The default preview seed is fixed for comparable art/input reviews. Two lighting choices and reduced effects are available.

## Boundaries / next slice

This is procedural blockout art, not finished realistic art. It has no audio, animated locomotion, detailed arm reload/repair animation, dynamic shadows, adaptive quality, persistent run recovery or authoritative scenery collisions. The street is arranged to leave all three attack paths visible; meshes outside the enemy collision volumes are decorative. WebGL/context failure offers an explicit return to Classic, never a conversion of the FPS run. The serial WebGL harness covers portrait/short landscape layout, browser multi-touch and context-loss fallback. Physical touch hardware, successful pointer lock, the full OS shell, real GPU budgets and the full deployed entry path still requires validation before promotion.

Rules use millimetres, integer direction components and rational slab comparisons. Input trig is outside the simulation; the camera uses the same quantized direction as the shot. Frame interpolation never determines a hit. The C1 ruleset `barricade-fps-c1`, version 3, is separate from Classic. Prototype replays may be partial debugging exports; any future publishing verifier must require a terminal result and a unique run identity. No current server accepts these logs, and no FPS score is submitted here.

The agreed next stage remains **free play followed by voluntary end-of-run mainnet anchoring**, after replay verification, with Barricade's own leaderboard and incompatible versions kept separate. It must not require Daily or day-close/J+2. C1 deliberately does not activate that pipeline, request wallet access or sign transactions.

## Focused checks

From `frontend`, use the repository's installed Node/toolchain:

```sh
node node_modules/vitest/vitest.mjs run src/games/barricade/sim/fps/engine.test.ts src/games/barricade/fps/session.test.ts src/games/barricade/fps/FpsPreview.test.tsx src/games/barricade/BarricadeWindow.test.tsx src/games/barricade/BarricadePreviewEntry.test.tsx --maxWorkers=1 --no-file-parallelism
node node_modules/eslint/bin/eslint.js src/games/barricade/sim/fps src/games/barricade/fps src/games/barricade/render/three/fps src/games/barricade/Barricade.tsx --max-warnings=0
```

Production build, bundle gate and browser checks must use the reserved Arcade validation slot. Tests cover collision boundaries/occlusion/ties, all axes, shields, cadence/reload/repair, exact replay of a winning run, 100 unattended seeds, live-loop frame grouping, pause/reset of held input, explicit capture, no submission and existing Classic window behavior. They do not substitute for visual/browser evidence.

## Serial WebGL evidence

Inside the reserved Arcade validation slot, run from `frontend`:

```sh
node src/games/barricade/fps/preview.browser.mjs
```

Requires the installed Playwright Chromium. `FPS_C1_OUTPUT` overrides the default `/private/tmp/memba-c1-proof` directory. The script mounts the actual component/scene in a local window activity harness and writes screenshots, a winning replay and `results.json`; it closes its server/browser in `finally`. Test-only build transforms expose the session and a controlled simulation clock. A separate real RAF pass checks shooting/pause. This fixture does not prove integration with the full OS shell. Headless pointer-lock rejection is recorded separately from successful capture. SwiftShader timings are software-renderer observations, not desktop/mobile GPU certification. No score, wallet or external network request is involved.

## Anchoring contract boundary

`localStateDigest()` is a 16-hex double-FNV diagnostic for local replay parity, **not a cryptographic proof or an API/realm stateHash**. It must never be sent to the v2 anchoring endpoint, which accepts the explicitly versioned 8/64-hex formats. The future FPS adapter must produce a canonical SHA-256 64-hex stateHash and LP/domain-separated replay/payload commitments, with shared TS/Go vectors. Follow `A-ONCHAIN-CONTRACT.md`: stable persisted lowercase UUID v4 per run, `game=barricade` with distinct FPS rules/version, canonical replay codec, terminal result, immutable snapshot and retry identity. Do not turn the C1 ruleset into a fourth game slug or reuse Classic's receipts. C1's fixed preview seed and in-memory log are not a durable publication identity.
