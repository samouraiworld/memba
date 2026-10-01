/** The shop's "To the wall" button keeps its fill under the pointer: its dark label must stay readable. */
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "barricade.css"), "utf8")

describe("barricade.css", () => {
    it("keeps the continue button's accent fill on hover, over the generic choice hover", () => {
        const hover = css.match(/\.bar-shop \.bar-choice--continue:hover\s*\{([^}]*)\}/)?.[1] ?? ""
        expect(hover).toMatch(/background:\s*var\(--color-k-accent/)
        // More specific than `.bar-choice:hover`, so it wins wherever either rule sits.
        expect(css).toMatch(/\.bar-choice:hover\s*\{/)
    })
})
