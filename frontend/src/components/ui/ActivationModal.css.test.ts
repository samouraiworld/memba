/**
 * Regression guard for the forced first-time activation modal (UX-2 / Track 0 T0.6).
 *
 * ActivationModal is shown, undismissable, to EVERY faucet-funded newcomer
 * (`public_key: null`). It referenced a CSS custom-property family
 * (`--surface-*`, `--text-primary`, `--accent-rgb`, `--danger-rgb`, `--danger`)
 * that is declared NOWHERE in the token system — so per the CSS spec those
 * declarations were invalid-at-computed-value-time and the card rendered
 * effectively transparent. This asserts every custom property the modal uses is
 * actually declared in the design-system token files, so an orphaned var can't
 * ship again (and the modal can't silently go transparent for newcomers).
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it, expect } from "vitest"

const dir = path.dirname(fileURLToPath(import.meta.url))
const modalCss = readFileSync(path.join(dir, "ActivationModal.css"), "utf8")
const tokenCss =
    readFileSync(path.join(dir, "../../tokens.css"), "utf8") +
    "\n" +
    readFileSync(path.join(dir, "../../index.css"), "utf8")

/** Custom properties referenced via var(--name) in the modal's stylesheet. */
const usedVars = [...modalCss.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)].map((m) => m[1])
/** Custom properties declared (--name:) anywhere in the token files. */
const declaredVars = new Set([...tokenCss.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]))

describe("ActivationModal.css — design-system token integrity (UX-2)", () => {
    it("uses at least one custom property (sanity)", () => {
        expect(usedVars.length).toBeGreaterThan(0)
    })

    it("references only custom properties that are actually declared (no orphaned vars → no transparent card)", () => {
        const orphaned = [...new Set(usedVars)].filter((v) => !declaredVars.has(v))
        expect(orphaned).toEqual([])
    })
})
