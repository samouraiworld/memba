/**
 * NFTMedia.test.tsx — TDD tests for the NFTMedia component.
 *
 * Cases:
 *   (a) empty uri  → renders placeholder, no <img>
 *   (b) non-empty uri → renders <img loading="lazy" src={nftImageUrl(uri)}>
 *   (c) onError on the img → swaps to placeholder, img removed from DOM
 *   (d) loading state → skeleton is present in the DOM
 *   (e) onLoad on the img → skeleton gone, image visible
 */

import { render, screen, fireEvent } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"
import { NFTMedia } from "./NFTMedia"

// Mock nftImageUrl — we verify the component consumes it correctly
vi.mock("../../lib/nftApi", () => ({
    nftImageUrl: (uriOrCid: string) => `https://proxy.example.com/image?uri=${encodeURIComponent(uriOrCid)}`,
}))

describe("NFTMedia", () => {
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

    it("(c) onError on img: swaps to placeholder, img removed from DOM entirely via early-return", () => {
        const uri = "ipfs://QmBroken"
        render(<NFTMedia uri={uri} alt="broken nft" />)

        const img = screen.getByRole("img")

        // Simulate image load failure
        fireEvent.error(img)

        // Placeholder should appear
        const placeholder = screen.getByTestId("nft-media-placeholder")
        expect(placeholder).toBeInTheDocument()

        // The img is removed from the DOM entirely (early-return renders placeholder branch)
        expect(screen.queryByRole("img")).toBeNull()
    })

    it("(d) loading state: skeleton is present in the DOM before image loads", () => {
        const uri = "ipfs://QmPending"
        render(<NFTMedia uri={uri} alt="pending nft" />)

        // Skeleton should be in the DOM while status is "loading"
        const skeleton = screen.getByTestId("nft-media-skeleton")
        expect(skeleton).toBeInTheDocument()
    })

    it("(e) onLoad on img: skeleton is removed, image is visible (no hidden class)", () => {
        const uri = "ipfs://QmLoaded"
        render(<NFTMedia uri={uri} alt="loaded nft" />)

        const img = screen.getByRole("img")

        // Skeleton should be present before load
        expect(screen.getByTestId("nft-media-skeleton")).toBeInTheDocument()

        // Simulate successful image load
        fireEvent.load(img)

        // Skeleton should be gone
        expect(screen.queryByTestId("nft-media-skeleton")).toBeNull()

        // Image should be visible — no hidden class
        expect(img).not.toHaveClass("nft-media-img--hidden")
    })
})
