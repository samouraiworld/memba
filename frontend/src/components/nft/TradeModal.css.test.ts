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
