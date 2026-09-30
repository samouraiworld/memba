/**
 * A tone set as text on its own tint (pills, badges, notes, and classic pages'
 * warnings through the bridge) must pass WCAG AA in the light theme, where both
 * are opaque tokens in os.css.
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "os.css"), "utf8")
const light = css.match(/^\.memba-os \{([^}]*)\}/m)?.[1] ?? ""
const token = (name: string) => light.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})\\b`))?.[1]

function luminance(hex: string): number {
    const [r, g, b] = [1, 3, 5]
        .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
}

describe("os.css light theme", () => {
    it.each(["ok", "warn"])("%s text on its own tint is at least 4.5:1", (tone) => {
        const ink = token(`os-${tone}`)
        const tint = token(`os-${tone}-bg`)
        expect(ink, `--os-${tone}`).toBeDefined()
        expect(tint, `--os-${tone}-bg`).toBeDefined()
        expect(contrast(ink!, tint!)).toBeGreaterThanOrEqual(4.5)
    })
})
