/**
 * Pins WebhookCard's own rendering rule: the chain badge shows when
 * webhook.ChainID is set, and is absent entirely when it is null. This does
 * NOT cover the wire boundary (the mapping from the server's chain_id to the
 * domain ChainID field) — that mapping is pinned in monitoringAuth.test.ts,
 * "maps chain_id back to ChainID when reading", since this file builds its
 * MonitoringWebhook fixture by hand and never crosses toWire/fromWire.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, cleanup, screen } from "@testing-library/react"
import { WebhookCard } from "./WebhookCard"
import type { MonitoringWebhook } from "../../lib/monitoringAuth"

const webhook = (chainID: string | null): MonitoringWebhook => ({
    ID: 1,
    URL: "https://discord.com/api/webhooks/abc",
    Type: "discord",
    Description: "Team alerts",
    ChainID: chainID,
})

describe("WebhookCard chain badge", () => {
    afterEach(cleanup)

    it("shows the chain the webhook is scoped to", () => {
        render(<WebhookCard webhook={webhook("topaz-1")} kind="validator"
            onEdit={vi.fn()} onDelete={vi.fn()} />)
        expect(screen.getByText("topaz-1")).toBeInTheDocument()
        expect(screen.queryByTestId("chain-badge")).not.toBeNull()
    })

    it("renders no badge for a legacy unscoped webhook", () => {
        render(<WebhookCard webhook={webhook(null)} kind="validator"
            onEdit={vi.fn()} onDelete={vi.fn()} />)
        expect(screen.queryByTestId("chain-badge")).toBeNull()
    })
})
