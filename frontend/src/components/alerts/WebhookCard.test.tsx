/**
 * The chain badge reads webhook.ChainID. The server sends chain_id, so before
 * the wire boundary existed this was permanently undefined and the badge never
 * rendered — a silent read-side half of the same bug.
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
    })

    it("renders no badge for a legacy unscoped webhook", () => {
        const { container } = render(<WebhookCard webhook={webhook(null)} kind="validator"
            onEdit={vi.fn()} onDelete={vi.fn()} />)
        expect(container.textContent).not.toContain("topaz-1")
    })
})
