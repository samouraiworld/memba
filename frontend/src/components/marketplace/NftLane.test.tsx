/**
 * NftLane.test.tsx — LIVE NFT lane (v1 surface, VITE_ENABLE_MARKETPLACE_V2 off).
 *
 * Covers the workstream-2c merchandising additions on the live lane:
 *   - a result-count badge next to the "Trending Collections" title (A5)
 *   - skeleton loaders while the chain read is in flight (A6)
 *   - featured/pinned ordering by FULL address-qualified id, never slug/name (A8)
 *
 * The chain read (nftHub) is mocked so the lane is deterministic in jsdom.
 */
import { screen, waitFor } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderWithProviders } from "../../test/test-utils"
import type { HubCollection } from "../../lib/nftHub"

// Mutable fixture the mock returns — each test sets it before rendering.
let mockCollections: HubCollection[] = []
const fetchVerifiedCollections = vi.fn(async (): Promise<HubCollection[]> => mockCollections)
const fetchRecentActivity = vi.fn(async () => [])

vi.mock("../../lib/nftHub", () => ({
    fetchVerifiedCollections: (...a: unknown[]) => fetchVerifiedCollections(...a),
    fetchRecentActivity: (...a: unknown[]) => fetchRecentActivity(...a),
}))

import NftLane, { orderByFeatured } from "./NftLane"

function col(over: Partial<HubCollection> & { id: string; name: string }): HubCollection {
    return {
        creator: "g1creator000000000000000000000000000000",
        slug: over.id.split("/").pop() ?? over.id,
        verified: false,
        floorUgnot: 1_000_000n,
        volumeUgnot: 1_000_000n,
        ...over,
    }
}

beforeEach(() => {
    mockCollections = []
    fetchVerifiedCollections.mockClear()
    fetchRecentActivity.mockClear()
})

describe("NftLane — result-count badge (A5)", () => {
    it("shows the number of collections next to the title", async () => {
        mockCollections = [
            col({ id: "g1aaa.../alpha", name: "Alpha" }),
            col({ id: "g1bbb.../beta", name: "Beta" }),
            col({ id: "g1ccc.../gamma", name: "Gamma" }),
        ]
        renderWithProviders(<NftLane />, { route: "/test13/marketplace/nfts" })

        await waitFor(() => expect(screen.getByText("Trending Collections")).toBeInTheDocument())
        const badge = screen.getByTestId("nft-count-badge")
        expect(badge).toHaveTextContent("3")
    })
})

describe("orderByFeatured — curated-first, FULL-ID match only (A8)", () => {
    const real = { id: "g1REALcreatoraddr000000000000000000000/genesis", name: "Genesis" }
    const beta = { id: "g1OTHERaddr00000000000000000000000000/beta", name: "Beta" }
    // Same 'genesis' SLUG, different creator address — the impersonation vector:
    // any creator can CreateCollection("genesis") from their own address.
    const imposter = { id: "g1EVILaddr000000000000000000000000000/genesis", name: "Genesis" }

    it("pins a featured full-id to the front, keeping the rest in incoming order", () => {
        const out = orderByFeatured([beta, real], [real.id])
        expect(out[0]).toBe(real)
        expect(out[1]).toBe(beta)
    })

    it("does NOT feature a same-slug / different-address collection", () => {
        // Featured list holds the REAL genesis id. The imposter shares only the slug.
        const out = orderByFeatured([imposter, real], [real.id])
        expect(out[0]).toBe(real) // real id floats up
        expect(out[1]).toBe(imposter) // imposter stays behind — slug is never matched
    })

    it("is a no-op (same reference) when nothing is curated", () => {
        const list = [beta, real]
        expect(orderByFeatured(list, [])).toBe(list)
    })
})

describe("NftLane — skeleton loaders (A6)", () => {
    it("renders shared skeleton cards while the chain read is in flight, not plain text", () => {
        // Never resolves → the lane stays in its loading state for the assertion.
        fetchVerifiedCollections.mockReturnValueOnce(new Promise<HubCollection[]>(() => {}))
        renderWithProviders(<NftLane />, { route: "/test13/marketplace/nfts" })

        const loading = screen.getByTestId("nft-loading")
        expect(loading).toHaveAttribute("aria-busy", "true")
        // The old "Loading collections…" copy is gone, replaced by SkeletonCards.
        expect(screen.queryByText(/Loading collections/i)).not.toBeInTheDocument()
        expect(loading.querySelectorAll(".k-card").length).toBeGreaterThan(1)
    })
})
