import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { getIpfsGatewayUrl } from "../../lib/ipfs"
import { nftFallbackUri } from "../../lib/nftFallbackArt"
import { TokenMedia } from "./TokenMedia"

const CID = `bafy${"b".repeat(55)}`

describe("token media", () => {
    it("shows the image the URI resolves to, lazily, under the caller's text", () => {
        render(<TokenMedia uri={`ipfs://${CID}/7.png`} seed="C1/7" alt="Relevé #7" />)
        const image = screen.getByRole("img", { name: "Relevé #7" })
        expect(image).toHaveAttribute("src", `${getIpfsGatewayUrl(CID)}/7.png`)
        expect(image).toHaveAttribute("loading", "lazy")
        expect(image).toHaveAttribute("referrerpolicy", "no-referrer")
        expect(image).toHaveClass("os-nft-media", "os-nft-square")
    })

    it("never loads an image on a creator's own host: it shows the generated art and says why", () => {
        render(<TokenMedia uri="https://example.org/banner.png" seed="C1" alt="Banner" shape="banner" />)
        const image = screen.getByRole("img", { name: "Banner" })
        expect(image).toHaveAttribute("src", nftFallbackUri("C1"))
        expect(document.querySelector('img[src^="https://example.org"]')).toBeNull()
        expect(image).toHaveClass("os-nft-media", "os-nft-banner")
        expect(screen.getByText("Image hosted outside IPFS, not loaded for your privacy.")).toBeInTheDocument()
    })

    it("loads an image already resolved to the gateway, and says nothing more", () => {
        render(<TokenMedia uri={`${getIpfsGatewayUrl(CID)}/7.png`} seed="C1/7" alt="Seven" />)
        expect(screen.getByRole("img", { name: "Seven" })).toHaveAttribute("src", `${getIpfsGatewayUrl(CID)}/7.png`)
        expect(screen.queryByText(/outside IPFS/)).toBeNull()
    })

    it.each([
        ["a script", "javascript:alert(1)"],
        ["inline data", "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>"],
        ["plain http", "http://example.org/7.png"],
        ["a malformed URI", "https://[bad/7.png"],
        ["no image", ""],
        ["no URI at all", null],
    ])("shows the generated art for %s", (_name, uri) => {
        render(<TokenMedia uri={uri} seed="C1/7" alt="Token 7" />)
        const image = screen.getByRole("img", { name: "Token 7" })
        expect(image).toHaveAttribute("src", nftFallbackUri("C1/7"))
        expect(image.getAttribute("src")).toMatch(/^data:image\/svg\+xml;utf8,/)
    })

    it("draws the generated art from the seed, so two tokens differ", () => {
        render(<><TokenMedia uri="" seed="C1/7" alt="Token 7" /><TokenMedia uri="" seed="C1/8" alt="Token 8" /></>)
        expect(screen.getByRole("img", { name: "Token 7" }).getAttribute("src")).not.toBe(screen.getByRole("img", { name: "Token 8" }).getAttribute("src"))
    })

    it("shows the generated art once the image fails to load, and stays on it", () => {
        render(<TokenMedia uri={`ipfs://${CID}/7.png`} seed="C1/7" alt="Token 7" />)
        const image = screen.getByRole("img", { name: "Token 7" })
        fireEvent.error(image)
        expect(image).toHaveAttribute("src", nftFallbackUri("C1/7"))
        fireEvent.error(image)
        expect(image).toHaveAttribute("src", nftFallbackUri("C1/7"))
    })

    it("tries another image after one has failed", () => {
        const { rerender } = render(<TokenMedia uri={`ipfs://${CID}/7.png`} seed="C1/7" alt="Token 7" />)
        fireEvent.error(screen.getByRole("img"))
        rerender(<TokenMedia uri={`ipfs://${CID}/8.png`} seed="C1/8" alt="Token 8" />)
        expect(screen.getByRole("img", { name: "Token 8" })).toHaveAttribute("src", `${getIpfsGatewayUrl(CID)}/8.png`)
        rerender(<TokenMedia uri={`ipfs://${CID}/7.png`} seed="C1/7" alt="Token 7" />)
        expect(screen.getByRole("img", { name: "Token 7" })).toHaveAttribute("src", nftFallbackUri("C1/7"))
    })

    it("never renders a creator's text as markup", () => {
        const hostile = `"><img src=x onerror=alert(1)><script>alert(1)</script>`
        const { container } = render(<TokenMedia uri={`ipfs://${CID}/7.png`} seed={hostile} alt={hostile} />)
        expect(container.querySelectorAll("*")).toHaveLength(1)
        expect(container.querySelector("script")).toBeNull()
        const image = screen.getByRole("img")
        expect(image).toHaveAttribute("alt", hostile)
        expect(image).not.toHaveAttribute("onerror")
        fireEvent.error(image)
        expect(container.querySelectorAll("*")).toHaveLength(1)
        expect(image.getAttribute("src")).toMatch(/^data:image\/svg\+xml;utf8,[A-Za-z0-9%.()'!~*_-]+$/)
    })
})
