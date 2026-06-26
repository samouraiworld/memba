import { readFileSync } from "node:fs"
import { describe, it, expect } from "vitest"

/**
 * Light-theme regression guard for the validator profile pages + the version toast.
 *
 * Root cause of the reported bug: `validator-detail.css` (imported by BOTH the
 * /validators/:address and /validators/valoper/:operatorAddress pages) used
 * hardcoded `rgba(255,255,255,…)` white text, which is invisible on the light
 * theme's near-white surfaces. The fix is to route every text/surface color
 * through the semantic theme tokens (which carry light-theme overrides).
 *
 * These tests fail if anyone re-introduces a hardcoded white in the profile CSS
 * or a dark-only background in the WhatsNewToast.
 */
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8")
const WHITE = /rgba\(\s*255\s*,\s*255\s*,\s*255/

describe("light-theme regression — validator profile + version toast", () => {
    it("validator-detail.css uses theme tokens, not hardcoded white text", () => {
        expect(read("./validator-detail.css")).not.toMatch(WHITE)
    })

    it("valoper-detail.css stays free of hardcoded white text", () => {
        expect(read("./valoper-detail.css")).not.toMatch(WHITE)
    })

    it("WhatsNewToast uses a theme surface, not a dark-only background", () => {
        const tsx = read("../components/ui/WhatsNewToast.tsx")
        // The old dark-only surface that broke light theme.
        expect(tsx).not.toMatch(/rgba\(\s*18\s*,\s*18\s*,\s*22/)
        // White-tint item backgrounds disappear on a light surface.
        expect(tsx).not.toMatch(WHITE)
    })
})
