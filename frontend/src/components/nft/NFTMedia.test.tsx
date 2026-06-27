/**
 * NFTMedia.test.tsx — TDD tests for the NFTMedia component.
 *
 * Cases:
 *   (a) empty uri  → renders generated fallback art (no broken placeholder)
 *   (b) non-empty uri → renders <img loading="lazy" src={nftImageUrl(uri)}>
 *   (c) onError on the img → swaps to fallback art, network img gone
 *   (d) loading state → skeleton is present in the DOM
 *   (e) onLoad on the img → skeleton gone, image visible
 *   (f) fallback is seeded → distinct seeds produce distinct, stable art
 */

import { render, screen, fireEvent } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"
import { NFTMedia } from "./NFTMedia"

// Mock nftImageUrl — we verify the component consumes it correctly
vi.mock("../../lib/nftApi", () => ({
    nftImageUrl: (uriOrCid: string) => `https://proxy.example.com/image?uri=${encodeURIComponent(uriOrCid)}`,
}))

describe("NFTMedia", () => {
    it("(a) empty uri: renders generated fallback art instead of an empty placeholder", () => {
        render(<NFTMedia uri="" alt="empty token" />)

        // The fallback IS an <img> now — a self-contained data: SVG, no network
        const fallback = screen.getByTestId("nft-media-fallback")
        expect(fallback).toBeInTheDocument()
        expect(fallback.tagName).toBe("IMG")
        expect(fallback.getAttribute("src")).toMatch(/^data:image\/svg\+xml/)
        expect(fallback).toHaveAttribute("alt", "empty token")
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

    it("(c) onError on img: swaps the network img for the generated fallback art", () => {
        const uri = "ipfs://QmBroken"
        render(<NFTMedia uri={uri} alt="broken nft" />)

        const img = screen.getByRole("img")
        expect(img.getAttribute("src")).toContain("proxy.example.com")

        // Simulate image load failure
        fireEvent.error(img)

        // Exactly one image remains: the generated data: fallback (network img gone)
        const imgs = screen.getAllByRole("img")
        expect(imgs).toHaveLength(1)
        expect(imgs[0]).toHaveAttribute("data-testid", "nft-media-fallback")
        expect(imgs[0].getAttribute("src")).toMatch(/^data:image\/svg\+xml/)
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

    it("(f) fallback art is seeded: distinct seeds yield distinct, stable images", () => {
        const { rerender } = render(<NFTMedia uri="" alt="x" seed="col-a/0" />)
        const a = screen.getByTestId("nft-media-fallback").getAttribute("src")

        rerender(<NFTMedia uri="" alt="x" seed="col-a/1" />)
        const b = screen.getByTestId("nft-media-fallback").getAttribute("src")

        rerender(<NFTMedia uri="" alt="x" seed="col-a/0" />)
        const aAgain = screen.getByTestId("nft-media-fallback").getAttribute("src")

        expect(a).not.toEqual(b) // different seed → different art
        expect(a).toEqual(aAgain) // same seed → stable art
    })
})
