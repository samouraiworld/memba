# Barricade FPS — C1 playable preview

This is an opt-in, unranked gameplay/art prototype. Classic v2 remains the default, with unchanged simulation and certification. No shared routes, shell, flags, backend, dependencies or generated assets change.

## Open locally

With the existing Barricade gate enabled in the local preview environment, open the existing game route with `?barricadePreview=fps` (for example `/mainnet/game/barricade?barricadePreview=fps`, or the corresponding `/os/arcade/barricade?barricadePreview=fps` window). The game-local wrapper reads the query; the explicit Return to Classic action removes only that parameter. No flag activation is included in this change. The FPS UI and Three scene are separate lazy imports.

## Play

- Drag on the view to aim, or use arrow keys. Hold the Fire button / Space; R reloads. A second touch can hold Fire while the first aims.
- The optional Capture mouse button requests pointer lock **only on that click**. Move to aim and hold the primary mouse button to fire. Escape/P, blur, hidden tab, or inactive OS window pauses; resuming is explicit. Capture rejection leaves drag controls usable.
- You stay behind the barricade. Three converging streets bring CRS with timed shields and robots with a bright weak point. A blue diamond confirms a blocked shield shot; a pale cross confirms damage. Health does not change collider size.
- Three waves, 27 opponents, twelve-round magazine, automatic refill between waves. One +40 repair can be used between waves if the wall is damaged. Repair windows last twelve simulation seconds and can be skipped.
- End screen verifies the complete state against a local replay and exports the versioned journal. The default preview seed is fixed for comparable art/input reviews. Two lighting choices and reduced effects are available.

## Boundaries / next slice

This is procedural blockout art, not finished realistic art. It has no audio, animated locomotion, detailed arm reload/repair animation, dynamic shadows, adaptive quality, persistent run recovery or authoritative scenery collisions. The street is arranged to leave all three attack paths visible; meshes outside the enemy collision volumes are decorative. WebGL/context failure offers an explicit return to Classic, never a conversion of the FPS run. Portrait and short landscape layout, touch hardware, pointer lock, real GPU rendering and bundle isolation require browser validation before promotion.

Rules use millimetres, integer direction components and rational slab comparisons. Input trig is outside the simulation; the camera uses the same quantized direction as the shot. Frame interpolation never determines a hit. The C1 ruleset `barricade-fps-c1`, version 3, is separate from Classic. Prototype replays may be partial debugging exports; any future publishing verifier must require a terminal result and a unique run identity. No current server accepts these logs, and no FPS score is submitted here.

The agreed next stage remains **free play followed by voluntary end-of-run mainnet anchoring**, after replay verification, with Barricade's own leaderboard and incompatible versions kept separate. It must not require Daily or day-close/J+2. C1 deliberately does not activate that pipeline, request wallet access or sign transactions.

## Focused checks

From `frontend`, use the repository's installed Node/toolchain:

```sh
node node_modules/vitest/vitest.mjs run src/games/barricade/sim/fps/engine.test.ts src/games/barricade/fps/session.test.ts src/games/barricade/fps/FpsPreview.test.tsx src/games/barricade/BarricadeWindow.test.tsx src/games/barricade/BarricadePreviewEntry.test.tsx --maxWorkers=1 --no-file-parallelism
node node_modules/eslint/bin/eslint.js src/games/barricade/sim/fps src/games/barricade/fps src/games/barricade/render/three/fps src/games/barricade/Barricade.tsx --max-warnings=0
```

Production build, bundle gate and browser checks must use the reserved Arcade validation slot. Tests cover collision boundaries/occlusion/ties, all axes, shields, cadence/reload/repair, exact replay of a winning run, 100 unattended seeds, live-loop frame grouping, pause/reset of held input, explicit capture, no submission and existing Classic window behavior. They do not substitute for visual/browser evidence.
