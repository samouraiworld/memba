/**
 * Regression guard for the shared money-path modal shell (UX-1 / Track 0 T0.5).
 *
 * `.trade-modal` is reused by 6 fund-moving modals (TradeModal, Make/Accept
 * FloorOffer, TokenTrade, HireService, DeployAgent). Its overlay centers the
 * modal, so without a height cap + body scroll the Confirm/List/Buy CTA renders
 * below the fold on a phone (375px) and the modal itself won't scroll — the
 * action is unreachable. This mirrors the proven MOB-2 fix in tx-confirmation.css.
 * If either declaration is dropped, the mobile transactability bug returns.
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it, expect } from "vitest"

const cssPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "TradeModal.css")
const css = readFileSync(cssPath, "utf8")

// Isolate the `.trade-modal` shell rule (not `.trade-modal-overlay` / `.trade-modal__*`).
const shell = css.match(/\.trade-modal\s*\{[^}]*\}/)?.[0] ?? ""

describe("TradeModal.css — mobile transactability (UX-1)", () => {
    it("finds the .trade-modal shell rule", () => {
        expect(shell).not.toBe("")
    })

    it("caps the modal height so the CTA can't sit below the fold", () => {
        expect(shell).toMatch(/max-height:/)
    })

    it("scrolls the modal body so the CTA stays reachable at 375px", () => {
        expect(shell).toMatch(/overflow-y:\s*auto/)
    })
})

// ── Mobile layout (Phase 5) ──────────────────────────────────────────────────
//
// The shell had NO @media at all. The base rule already caps height and scrolls,
// so the CTA was reachable — but at 375px the two actions sat side by side in a
// right-aligned row under the 44px tap-target floor, on a path where one tap
// moves funds. Below 640px the modal is a bottom sheet with stacked, full-width
// actions. Guarded because it is invisible on the desktop everyone develops on.
const mobileBlock = css.match(/@media\s*\(max-width:\s*640px\)\s*\{[\s\S]*?\n\}/)?.[0] ?? ""

describe("TradeModal.css — mobile bottom sheet (Phase 5)", () => {
    it("has a max-width: 640px block at all", () => {
        expect(mobileBlock).not.toBe("")
    })

    it("anchors the sheet to the bottom of the viewport", () => {
        expect(mobileBlock).toMatch(/\.trade-modal-overlay\s*\{[^}]*align-items:\s*flex-end/)
    })

    it("gives the actions a >=44px tap target", () => {
        // WCAG 2.5.5 / HIG floor. The base buttons are text-sm with space-2
        // padding, which lands well under it.
        expect(mobileBlock).toMatch(/min-height:\s*44px/)
    })

    it("stacks the actions full-width instead of a cramped right-aligned row", () => {
        expect(mobileBlock).toMatch(/\.trade-modal__actions\s*\{[^}]*flex-direction:\s*column/)
        expect(mobileBlock).toMatch(/width:\s*100%/)
    })

    it("respects the home-indicator inset", () => {
        expect(mobileBlock).toMatch(/env\(safe-area-inset-bottom/)
    })

    it("leaves the desktop rule untouched", () => {
        // The base shell must keep the cap + scroll the older guard pins; a
        // mobile block that accidentally replaced them would regress UX-1.
        expect(shell).toMatch(/max-height:/)
        expect(shell).toMatch(/overflow-y:\s*auto/)
        expect(shell).toMatch(/width:\s*min\(480px/)
    })
})

