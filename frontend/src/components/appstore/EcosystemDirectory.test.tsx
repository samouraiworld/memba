import { afterEach, describe, expect, it, vi } from "vitest"
import { fireEvent, screen } from "@testing-library/react"
import { useLocation, useNavigate } from "react-router-dom"
import { renderWithProviders } from "../../test/test-utils"
import { EcosystemDirectory } from "./EcosystemDirectory"
afterEach(() => vi.unstubAllEnvs())
function Harness() {
    const location = useLocation()
    const navigate = useNavigate()
    return <><EcosystemDirectory standalone /><div data-testid="location">{location.pathname}{location.search}</div><button onClick={() => navigate(-1)}>Back</button></>
}
describe("ecosystem discovery controls", () => {
    it("restores shared filters, reports empty results and resets", () => {
        renderWithProviders(<Harness />, { route: "/pearl/apps?q=missing&availability=mainnet" })
        expect(screen.getByRole("status")).toHaveTextContent("0 projects found")
        fireEvent.click(screen.getByRole("button", { name: "Reset filters" }))
        expect(screen.getByRole("status")).toHaveTextContent("10 projects found")
        fireEvent.change(screen.getByRole("searchbox", { name: "Search projects" }), { target: { value: "boards" } })
        fireEvent.change(screen.getByLabelText("Availability"), { target: { value: "unknown" } })
        expect(screen.getByRole("status")).toHaveTextContent("0 projects found")
        fireEvent.click(screen.getByRole("button", { name: "Back" }))
        expect(screen.getByRole("searchbox")).toHaveValue("boards")
        expect(screen.getByRole("status")).toHaveTextContent("1 project found")
    })
    it("dates the availability evidence, not every link on the card", () => {
        renderWithProviders(<Harness />, { route: "/pearl/apps?q=gnoswap" })
        // GnoSwap's record dates its router realm (the availability line), not its website.
        expect(screen.getByText("Mainnet · router realm checked")).toBeInTheDocument()
        expect(screen.getByText("Availability checked 2026-09-26")).toBeInTheDocument()
        expect(screen.queryByText(/Links checked/)).not.toBeInTheDocument()
    })
    it("keeps mainnet realm destinations explicit when browsing from Pearl", () => {
        vi.stubEnv("VITE_ENABLE_EXPLORER", "true")
        renderWithProviders(<Harness />, { route: "/pearl/apps?q=boards" })
        const explorerHref = screen.getByRole("link", { name: "Mainnet Explorer" }).getAttribute("href")!
        const explorerUrl = new URL(explorerHref, "https://memba.test")
        expect(explorerUrl.pathname).toBe("/mainnet/directory")
        expect(explorerUrl.searchParams.get("tab")).toBe("explorer")
        expect(explorerUrl.searchParams.get("realm")).toBe("r/gnoland/boards2/v0")
        expect(screen.getByRole("link", { name: "Boards source (opens in a new tab)" })).toHaveAttribute("href", "https://gno.land/r/gnoland/boards2/v0$source")
        expect(screen.getByTestId("location")).toHaveTextContent("/pearl/apps")
    })
    it("does not offer disabled explorer routes or nest interactive elements", () => {
        vi.stubEnv("VITE_ENABLE_EXPLORER", "false")
        const { container } = renderWithProviders(<EcosystemDirectory standalone />)
        expect(screen.queryByRole("link", { name: "Mainnet Explorer" })).not.toBeInTheDocument()
        expect(container.querySelector("a a, button a, a button")).toBeNull()
        expect(screen.getByRole("link", { name: "Visit mygnoscan (opens in a new tab)" })).toHaveAttribute("href", "https://mygnoscan.moul.p2p.team/storage?network=mainnet")
    })
    it("shows only unmatched projects after live listings, with verified realm links only", () => {
        renderWithProviders(<EcosystemDirectory onChain={[
            { pkgPath: "gno.land/r/gnoswap/router", appURL: "https://gnoswap.io/" },
            { pkgPath: "gno.land/r/gnoland/boards2/v0", appURL: "https://gno.land/r/gnoland/boards2/v0" },
        ]} />)
        expect(screen.getByRole("heading", { level: 2, name: "More from the Gno ecosystem" })).toBeInTheDocument()
        expect(screen.getByRole("status")).toHaveTextContent("8 projects found")
        expect(screen.queryByRole("heading", { name: "GnoSwap" })).not.toBeInTheDocument()
        expect(screen.queryByRole("heading", { name: "Boards" })).not.toBeInTheDocument()
        expect(screen.getByRole("link", { name: "Visit Bubble Rumble (opens in a new tab)" })).toHaveAttribute("href", "https://bubblerumble.net/")
        expect(screen.queryByRole("link", { name: "Bubble Rumble mainnet realm (opens in a new tab)" })).not.toBeInTheDocument()
        expect(screen.getByRole("link", { name: "Kourt mainnet realm (opens in a new tab)" })).toHaveAttribute("href", "https://gno.land/r/g1ecsuj0q572jr0dhu29q9njtnmw03hyu7tyyvv6/kourt")
    })
})
