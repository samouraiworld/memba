/**
 * ServiceLaneV2.test.tsx — Services lane on the v2 foundation (marketplace-v2 7.2).
 * Fed by the Founding-Supply seed until real listings exist.
 */
import type { ReactNode } from "react"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { describe, it, expect } from "vitest"
import ServiceLaneV2 from "./ServiceLaneV2"

const wrap = () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={qc}>
            <MemoryRouter initialEntries={["/test13/marketplace/services"]}>{children}</MemoryRouter>
        </QueryClientProvider>
    )
}

describe("ServiceLaneV2", () => {
    it("renders the seed founding-supply services with category chips", async () => {
        render(<ServiceLaneV2 />, { wrapper: wrap() })
        // Fiverr-voice gig titles render as card titles (several start with "I will").
        const gigs = await screen.findAllByText(/^I will /)
        expect(gigs.length).toBeGreaterThan(0)
        // The shared toolbar + at least one category chip are present.
        expect(screen.getByRole("searchbox")).toBeInTheDocument()
        expect(screen.getByRole("button", { name: "All" })).toBeInTheDocument()
    })
})
