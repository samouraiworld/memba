# C3 source proposal — bounded visual review pending

Baseline: C2 visual SHA `9f34a00b029635c35f17f7ecd81b0733a6e6e335`. Branch stacks on C2 recovery `3768d0fb24d310211fd4767827f3b41a4c29d15b`.

This is one source proposal for review, **not an art or production performance approval**. No C3 build/browser capture has run. C2’s heavy slot was released at17:46:38 CEST on9October. A separate slot must be assigned for the single bounded recipe below.

## Changes and ownership

Continuous central and diagonal street walls replace isolated towers. Adjacent party walls, varied heights/widths, shop glazing/canopies and a continuous far city block establish street depth. Foreground asphalt joins the intersection; paving seams, worn paint, drain slots and road repairs add scale. Geometry farther than29m uses fewer window/railing/corner pieces.

CRS use rounded torso/hips/shoulders and articulated cylindrical upper/lower limbs, helmet/visor, a small original CRS chest identifier and the unchanged shield envelope. Robots keep rigid warm-grey plates, dark machinery and the unchanged amber sensor. Explicit decorative limb tags replace positional animation heuristics; head/torso/sensor stay fixed. More directional light and less uniform fill are proposed, retaining one hemisphere plus one directional light, the same fog distances and no shadow-map/postprocessing pass. The crosshair gains a hard dark outline at the same size/position.

Only game-local rendering, its CSS outline, provenance, tests and recipe change. **Simulation, collision boxes, rules/version, replay fixtures, camera eye/FOV/clipping/DPR, aim clamps/sensitivity and input handlers are unchanged.** No shared shell/client/backend/config or production activation. Future camera/control changes require a separate inventory and review.

Original procedural geometry/textures only, repository MIT license. See ASSETS.json. No downloaded/generated image, commercial asset or additional material finish/shader family. Two additional geometry/cloth batches reuse the existing finish; their small textures are independently owned/disposed like C2.

## Source evidence (not rendered costs)

| Source metric | C2 | C3 |
|---|---:|---:|
| Static instances |1773|2192|
| Static triangles |24020|29648|
| CRS triangles |428|1732|
| Robot triangles |560|560|
| Worst16 + street/viewmodel triangles, before impacts |33284|57664|
| Geometry/finish batches before effects |19|21|

Source guards: static<2600, worst16<60000 triangles, batches≤32, per-actor bucket≤32. The first source draft exceeded the budget and was reduced before this proposal. C3 remains more expensive geometrically than C2, whose SwiftShader frame times already failed the target. **No FPS improvement is claimed.** Source batch counts are not measured GPU draw calls.

Geometric checks sample all three paths at21 travel positions and both target heights; conservative oriented boxes of the decorative street do not intersect sight lines before those targets. Aim checks cover41 positions×3axes×2enemy kinds through the actual existing session direction and collision trace: weak points remain reachable within yaw±65°/pitch±35°. Maximum required yaw31.305°, pitch6.458°, <196px from centre at .16°/px. This proves mathematical coverage, not touch usability. Portrait still cannot show all side targets simultaneously; panning is required. No projection change is proposed until the tactile review decides whether that tradeoff is acceptable.

Six targeted source tests pass, with targeted strict types and zero-warning lint. Three CJS test-environment deprecation only. No complete application build, browser/GPU, actual device touch, artistic approval or live publication claim.

## Assigned recipe (one bounded pass, no open iteration)

1. Typecheck/build and inherited Three/EVM/Safe gates. Keep preview opt-in.
2. Run `FPS_C1_OUTPUT=/private/tmp/memba-c3-proof node src/games/barricade/fps/preview.browser.mjs` once in the assigned slot. The script closes Chromium and its local server in finally. No wallet/backend/network actions.
3. Compare C2 and C3 at camera eye(0,1.65,1.8), FOV60°, yaw/pitch0, seed fps-c1-preview, tick900/six natural enemies, 1440×900 and the same compact stage dimensions. Same browser/renderer/machine conditions; record camera/viewport metadata. Existing durable C2 captures are the before set. Re-measure a fresh C2 baseline in the same assigned slot if frame-time attribution is needed; prior measurements alone are not a controlled before/after.
4. Capture day/dusk, near natural silhouettes, shield/sensor/occlusion, reload,320/390portrait and667landscape. Judge continuous street/depth, CRS vs robot identity at actual play distances, threat/crosshair contrast.
5. New harness recipe sends **real CDP touch events**, never direct session.aim calls, to aim/fire at the nearest natural target on every axis at320portrait and667landscape. Record aimed/hit captures and HP reduction. Simulation remains the same; only its existing test clock advances. This extension is source-reviewed, not yet browser-executed.
6. Measure real draw calls/triangles,120-frame median/p95 at6 and synthetic-render-only16, plus five-restart resource counts. Report actual GPU/software identity; do not infer a physical/mobile GPU result from SwiftShader. Compare frame times as well as batching. Re-test WebGL loss and preserve C2’s headed pointer-lock limitation unless actually exercised.
7. Stop processes and explicitly release the slot, even on failed art/performance/touch criteria. Report findings to the pilot; no unbounded follow-up rendering or PASS from source checks.
