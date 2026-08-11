/**
 * Covers the WIRING, not just the helpers. The chain options now come from
 * gnomonitoring /info; the never-render-blank invariant is unit-tested in
 * webhookForm.test.ts, and pinned end-to-end here.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import { render, cleanup, fireEvent, waitFor, screen } from "@testing-library/react"
import type { MonitoringWebhook } from "../../lib/monitoringAuth"

const mocks = vi.hoisted(() => ({ fetchEnabledChains: vi.fn() }))

vi.mock("../../lib/gnomonitoring", () => ({
    fetchEnabledChains: mocks.fetchEnabledChains,
}))

import { WebhookForm } from "./WebhookForm"

const ENABLED = ["gnoland1", "sapphire-1", "topaz-1"]

const webhook = (chainID: string | null): MonitoringWebhook => ({
    ID: 1,
    URL: "https://discord.com/api/webhooks/abc",
    Type: "discord",
    Description: "Team alerts",
    ChainID: chainID,
})

const chainSelect = () => document.querySelector<HTMLSelectElement>("#webhook-chain")!

describe("WebhookForm", () => {
    beforeEach(() => {
        mocks.fetchEnabledChains.mockResolvedValue(ENABLED)
    })
    afterEach(() => {
        cleanup()
        vi.clearAllMocks()
    })

    it("populates the selector from /info", async () => {
        render(<WebhookForm onSubmit={vi.fn()} />)
        await waitFor(() => expect(chainSelect().querySelectorAll("option").length)
            .toBeGreaterThanOrEqual(ENABLED.length))

        const values = [...chainSelect().querySelectorAll("option")].map(o => o.value)
        for (const chain of ENABLED) expect(values).toContain(chain)
    })

    it("offers no 'All chains' option — the server requires a chain", async () => {
        render(<WebhookForm onSubmit={vi.fn()} />)
        await waitFor(() => expect(mocks.fetchEnabledChains).toHaveBeenCalled())

        const labels = [...chainSelect().querySelectorAll("option")].map(o => o.text)
        expect(labels.some(l => /all chains/i.test(l))).toBe(false)
    })

    it("shows a stored chain the service no longer offers, rather than blanking", async () => {
        render(<WebhookForm initial={webhook("test-13")} onSubmit={vi.fn()} />)
        await waitFor(() => expect(mocks.fetchEnabledChains).toHaveBeenCalled())

        expect(chainSelect().value).toBe("test-13")
        expect(chainSelect().selectedIndex).toBeGreaterThanOrEqual(0)
        expect(chainSelect().options[chainSelect().selectedIndex].text)
            .toContain("no longer offered")
    })

    it("submits chain_id-ready ChainID from the stored webhook", async () => {
        const onSubmit = vi.fn().mockResolvedValue({ ok: true })
        render(<WebhookForm initial={webhook("topaz-1")} onSubmit={onSubmit} />)
        await waitFor(() => expect(mocks.fetchEnabledChains).toHaveBeenCalled())

        fireEvent.submit(document.querySelector("form")!)
        await waitFor(() => expect(onSubmit).toHaveBeenCalled())
        expect(onSubmit).toHaveBeenCalledWith(
            expect.objectContaining({ ChainID: "topaz-1" }),
        )
    })

    it("submits a chain the user changes it to", async () => {
        const onSubmit = vi.fn().mockResolvedValue({ ok: true })
        render(<WebhookForm initial={webhook("topaz-1")} onSubmit={onSubmit} />)
        await waitFor(() => expect(mocks.fetchEnabledChains).toHaveBeenCalled())

        fireEvent.change(chainSelect(), { target: { value: "sapphire-1" } })
        fireEvent.submit(document.querySelector("form")!)

        await waitFor(() => expect(onSubmit).toHaveBeenCalled())
        expect(onSubmit).toHaveBeenCalledWith(
            expect.objectContaining({ ChainID: "sapphire-1" }),
        )
    })

    it("blocks submission when a legacy row has no chain", async () => {
        // A legacy row can carry a NULL chain, and the server now requires one.
        // Editing must NOT silently invent a scope for it — the user has to
        // choose, so the form blocks instead of submitting a guess.
        const onSubmit = vi.fn()
        render(<WebhookForm initial={webhook(null)} onSubmit={onSubmit} />)
        await waitFor(() => expect(mocks.fetchEnabledChains).toHaveBeenCalled())

        expect(chainSelect().value).toBe("")
        fireEvent.submit(document.querySelector("form")!)

        await waitFor(() => expect(screen.getByText("Chain is required")).toBeInTheDocument())
        expect(onSubmit).not.toHaveBeenCalled()
    })

    it("preselects the active chain on CREATE only", async () => {
        // Read the constant rather than hardcoding "topaz-1": the active
        // network is environment-derived. This does not make the test immune
        // to a chain cutover — ENABLED is still a hardcoded fixture — but it
        // moves the breakage to the premise line below, which fails loudly
        // and points straight at the mismatch instead of failing obscurely
        // deeper in the assertion. That failure is intentional, not a bug.
        const { GNO_MONITORING_CHAIN } = await import("../../lib/config")
        expect(ENABLED).toContain(GNO_MONITORING_CHAIN) // premise

        render(<WebhookForm onSubmit={vi.fn()} />)
        await waitFor(() => expect(chainSelect().value).toBe(GNO_MONITORING_CHAIN))
    })

    it("rejects a host the server would refuse, before submitting", async () => {
        const onSubmit = vi.fn()
        render(<WebhookForm onSubmit={onSubmit} />)
        await waitFor(() => expect(mocks.fetchEnabledChains).toHaveBeenCalled())

        fireEvent.change(document.querySelector("#webhook-url")!, {
            target: { value: "https://example.com/hook" },
        })
        fireEvent.change(document.querySelector("#webhook-description")!, {
            target: { value: "test" },
        })
        fireEvent.submit(document.querySelector("form")!)

        await waitFor(() => expect(screen.getByText(/discord\.com/)).toBeInTheDocument())
        expect(onSubmit).not.toHaveBeenCalled()
    })

    it("displays the server's refusal message", async () => {
        const onSubmit = vi.fn().mockResolvedValue({
            ok: false,
            error: "chain_id is required",
        })
        render(<WebhookForm initial={webhook("topaz-1")} onSubmit={onSubmit} />)
        await waitFor(() => expect(mocks.fetchEnabledChains).toHaveBeenCalled())

        fireEvent.submit(document.querySelector("form")!)

        await waitFor(() =>
            expect(screen.getByText("chain_id is required")).toBeInTheDocument())
    })

    it("warns instead of silently offering nothing when /info fails", async () => {
        mocks.fetchEnabledChains.mockResolvedValue([])
        render(<WebhookForm onSubmit={vi.fn()} />)

        await waitFor(() =>
            expect(screen.getByText(/could not load/i)).toBeInTheDocument())
    })
})
