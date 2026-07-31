import { describe, it, expect, vi, afterEach } from "vitest"
import { render, cleanup } from "@testing-library/react"
import { WebhookForm } from "./WebhookForm"
import { NETWORKS } from "../../lib/config"
import type { MonitoringWebhook } from "../../lib/monitoringAuth"

/**
 * Covers the WIRING, not just the helper. `selectableChainIdOptions` is unit-tested
 * in config.test.ts, but nothing rendered this form — reverting the JSX back to
 * `Object.entries(VISIBLE_NETWORKS)` left the whole suite green.
 *
 * The bug: hiding gnoland1 left an existing webhook scoped to it with no matching
 * <option>, so the browser rendered the control BLANK (selectedIndex -1) while
 * state still submitted `gnoland1` — invisible and uncorrectable.
 */
const webhook = (chainID: string | null): MonitoringWebhook => ({
    ID: 1,
    URL: "https://discord.com/api/webhooks/abc",
    Type: "discord",
    Description: "Team alerts",
    ChainID: chainID,
} as MonitoringWebhook)

const getChainSelect = () => document.querySelector<HTMLSelectElement>("#webhook-chain")!

describe("WebhookForm — the chain selector must never render blank", () => {
    afterEach(cleanup)

    it("shows a HIDDEN chain as the selected option when editing", () => {
        render(<WebhookForm initial={webhook("gnoland1")} onSubmit={vi.fn()} />)
        const select = getChainSelect()
        expect(NETWORKS.gnoland1.hidden).toBe(true) // premise
        expect(select.value).toBe("gnoland1")
        // The real regression signal: a value with no matching <option> gives -1.
        expect(select.selectedIndex, "blank control — value matches no option").toBeGreaterThanOrEqual(0)
        expect(select.options[select.selectedIndex].text).toContain("no longer offered")
    })

    it("shows an UNRECOGNISED stored chain rather than blanking", () => {
        render(<WebhookForm initial={webhook("some-retired-chain")} onSubmit={vi.fn()} />)
        const select = getChainSelect()
        expect(select.value).toBe("some-retired-chain")
        expect(select.selectedIndex).toBeGreaterThanOrEqual(0)
        expect(select.options[select.selectedIndex].text).toContain("unrecognised chain")
    })

    it("selects the visible network normally", () => {
        render(<WebhookForm initial={webhook(NETWORKS.topaz.chainId)} onSubmit={vi.fn()} />)
        const select = getChainSelect()
        expect(select.value).toBe(NETWORKS.topaz.chainId)
        expect(select.selectedIndex).toBeGreaterThanOrEqual(0)
        expect(select.options[select.selectedIndex].text).not.toContain("no longer offered")
    })

    it("defaults to 'All chains' on create, adding no extra option", () => {
        render(<WebhookForm onSubmit={vi.fn()} />)
        const select = getChainSelect()
        expect(select.value).toBe("")
        expect(select.selectedIndex).toBe(0)
        expect(select.options[0].text).toBe("All chains")
        // "All chains" + exactly the visible networks — nothing invented.
        expect(select.options.length).toBe(1 + Object.values(NETWORKS).filter(n => !n.hidden).length)
    })

    it("treats a null ChainID as 'All chains'", () => {
        render(<WebhookForm initial={webhook(null)} onSubmit={vi.fn()} />)
        expect(getChainSelect().value).toBe("")
    })
})
