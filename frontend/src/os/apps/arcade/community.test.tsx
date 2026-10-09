import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { CommunityGames } from "./community"

describe("Arcade editorial links", () => {
    it("shows the selected external sites with honest network and preview labels", () => {
        const { container } = render(<CommunityGames />)
        expect(screen.getAllByRole("link")).toHaveLength(3)
        for (const [name, url, status] of [
            ["Gnogolf", "https://gnogolf.xyz/", "Onyx testnet · external site"],
            ["Akkadia", "https://abp.akkadia.land/", "Alpha / Builder preview · network not verified"],
            ["gnofly", "https://gnofly.xyz/", "Mainnet · realm source checked"],
        ]) {
            const link = screen.getByRole("link", { name: `Visit ${name} (opens in a new tab)` })
            expect(link).toHaveAttribute("href", url)
            expect(link).toHaveAttribute("target", "_blank")
            expect(link).toHaveAttribute("rel", "noopener noreferrer")
            expect(within(link).getByText(status)).toBeInTheDocument()
            expect(within(link).getByText("External ↗")).toBeInTheDocument()
        }
        expect(screen.queryByRole("button")).not.toBeInTheDocument()
        expect(screen.queryByRole("link", { name: /Bubble Rumble/ })).not.toBeInTheDocument()
        expect(container.querySelector("iframe")).toBeNull()
    })

    it("reuses Akkadia artwork and leaves Gnogolf as text without fetching unverified artwork", () => {
        render(<CommunityGames />)
        const akkadia = screen.getByRole("link", { name: /Visit Akkadia/ })
        expect(akkadia.querySelector("img")).toHaveAttribute("src", "/store/akkadia/cover.webp")
        expect(screen.getByRole("link", { name: /Visit Gnogolf/ }).querySelector("img")).toBeNull()
    })
})
