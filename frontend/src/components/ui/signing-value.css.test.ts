/**
 * Signing values must display in the order they are signed: right-to-left
 * letters or digits next to them must not reorder an argument, an address or
 * a memo on screen. The rule lives in signing-value.css.
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "signing-value.css"), "utf8")

describe("signing-value.css", () => {
    it("isolates each signing value and forces its signed left-to-right order", () => {
        const rule = css.match(/\.signing-text\s*\{([^}]*)\}/)?.[1] ?? ""
        expect(rule).toMatch(/direction:\s*ltr/)
        expect(rule).toMatch(/unicode-bidi:\s*isolate-override/)
    })
})
