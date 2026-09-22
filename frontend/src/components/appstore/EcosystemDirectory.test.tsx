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
        expect(screen.getByRole("status")).toHaveTextContent("7 projects found")
        fireEvent.change(screen.getByRole("searchbox", { name: "Search projects" }), { target: { value: "boards" } })
        fireEvent.change(screen.getByLabelText("Availability"), { target: { value: "unknown" } })
        expect(screen.getByRole("status")).toHaveTextContent("0 projects found")
        fireEvent.click(screen.getByRole("button", { name: "Back" }))
        expect(screen.getByRole("searchbox")).toHaveValue("boards")
        expect(screen.getByRole("status")).toHaveTextContent("1 project found")
    })
    it("keeps mainnet realm destinations explicit when browsing from Pearl", () => {
        vi.stubEnv("VITE_ENABLE_EXPLORER", "true")
        renderWithProviders(<Harness />, { route: "/pearl/apps?q=boards" })
        expect(screen.getByRole("link", { name: "Mainnet Explorer" })).toHaveAttribute("href", "/mainnet/directory?tab=explorer&realm=r/gnoland/boards2/v0")
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
})
