/**
 * NFTMedia.test.tsx — TDD tests for the NFTMedia component.
 *
 * Three cases:
 *   (a) empty uri  → renders placeholder, no <img>
 *   (b) non-empty uri → renders <img loading="lazy" src={nftImageUrl(uri)}>
 *   (c) onError on the img → swaps to placeholder
 */

import { render, screen, fireEvent } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NFTMedia } from "./NFTMedia"

// Mock nftImageUrl — we verify the component consumes it correctly
vi.mock("../../lib/nftApi", () => ({
    nftImageUrl: (uriOrCid: string) => `https://proxy.example.com/image?uri=${encodeURIComponent(uriOrCid)}`,
}))

describe("NFTMedia", () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it("(a) empty uri: renders placeholder without an <img>", () => {
        render(<NFTMedia uri="" alt="empty token" />)

        // No img element should be present
        expect(screen.queryByRole("img")).toBeNull()

        // Placeholder should be visible (aria-label or test-id)
        const placeholder = screen.getByTestId("nft-media-placeholder")
        expect(placeholder).toBeInTheDocument()
    })

    it("(b) non-empty uri: renders <img> with loading=lazy and proxied src", () => {
        const uri = "ipfs://QmFoo123"
        render(<NFTMedia uri={uri} alt="my nft" />)

        const img = screen.getByRole("img")
        expect(img).toBeInTheDocument()
        expect(img).toHaveAttribute("loading", "lazy")
        expect(img).toHaveAttribute(
            "src",
            `https://proxy.example.com/image?uri=${encodeURIComponent(uri)}`
        )
        expect(img).toHaveAttribute("alt", "my nft")
    })

    it("(c) onError on img: swaps to placeholder, removes img from view", () => {
        const uri = "ipfs://QmBroken"
        render(<NFTMedia uri={uri} alt="broken nft" />)

        const img = screen.getByRole("img")

        // Simulate image load failure
        fireEvent.error(img)

        // Placeholder should appear
        const placeholder = screen.getByTestId("nft-media-placeholder")
        expect(placeholder).toBeInTheDocument()

        // The img should be hidden or removed (not visible)
        // NFTMedia hides img on error (not role=img anymore or has hidden style)
        expect(screen.queryByRole("img")).toBeNull()
    })
})
