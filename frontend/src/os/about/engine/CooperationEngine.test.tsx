import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CooperationEngine } from "./CooperationEngine"
import { DAO, FEATURES, OPERATIONS, RESERVE, publicTarget } from "./engineInfo"

beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
const draw = (chainId = "gnoland-1") => render(<CooperationEngine chainId={chainId} support={vi.fn()} />)
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })

describe("Cooperation engine", () => {
    it("loops through three views in 24 seconds, with the roadmap outside the tour", () => {
        draw()
        expect(screen.getByRole("region", { name: "Engine" })).toBeInTheDocument()
        advance(8_000)
        expect(screen.getByRole("region", { name: "Community" })).toBeInTheDocument()
        advance(8_000)
        expect(screen.getByRole("region", { name: "Fees & rewards" })).toBeInTheDocument()
        advance(8_000)
        expect(screen.getByRole("region", { name: "Engine" })).toBeInTheDocument()
    })

    it("stays on the reader's view after interaction until explicit resume", () => {
        const { container } = draw()
        fireEvent.mouseEnter(container.querySelector(".os-engine")!)
        advance(24_000)
        expect(screen.getByRole("region", { name: "Engine" })).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Community" }))
        advance(24_000)
        expect(screen.getByRole("region", { name: "Community" })).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Play tour" }))
        advance(8_000)
        expect(screen.getByRole("region", { name: "Fees & rewards" })).toBeInTheDocument()
    })

    it("keeps reduced motion and Roadmap manual, with equal future network status", () => {
        vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
        draw()
        expect(screen.getByRole("button", { name: "Manual view" })).toBeDisabled()
        advance(24_000)
        expect(screen.getByRole("region", { name: "Engine" })).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Roadmap" }))
        const roadmap = screen.getByRole("region", { name: "Roadmap" })
        expect(within(roadmap).getByText("EVM chains")).toBeInTheDocument()
        expect(within(roadmap).getByText("Bitcoin")).toBeInTheDocument()
        expect(within(roadmap).getAllByText("Planned")).toHaveLength(2)
        advance(24_000)
        expect(roadmap).toBeInTheDocument()
    })

    it("exposes a DAO source and real account records without inventing future wallet links", () => {
        draw()
        const dao = screen.getByRole("link", { name: "Memba DAO (opens in new tab)" })
        expect(dao).toHaveAttribute("href", "https://gno.land/r/samcrew/memba_dao$source")
        expect(dao).toHaveAttribute("target", "_blank")
        expect(dao).toHaveAttribute("rel", "noopener noreferrer")
        fireEvent.click(screen.getByRole("button", { name: "Fees & rewards" }))
        expect(screen.getByRole("link", { name: "Community Reserve (opens in new tab)" })).toHaveAttribute("href", expect.stringContaining("auth%2Faccounts%2Fg1jw76"))
        expect(screen.queryByRole("link", { name: /Contributor Rewards/ })).not.toBeInTheDocument()
        expect(publicTarget(OPERATIONS, "gnoland-1")).toBeUndefined()
        expect(publicTarget(RESERVE, "onyx-1")).toBeUndefined()
        expect(publicTarget(DAO, "onyx-1")).toBeUndefined()
        expect(publicTarget(DAO, "unknown-chain")).toBeUndefined()
    })

    it("explains details inline and restores the directory and initiating control on Back", () => {
        draw()
        fireEvent.click(screen.getByRole("button", { name: "Explore all 20 tools" }))
        for (const feature of FEATURES) expect(screen.getByRole("button", { name: `Details: ${feature.name}` })).toBeInTheDocument()
        const trigger = screen.getByRole("button", { name: "Details: Shared wallets" })
        fireEvent.click(trigger)
        expect(screen.getByRole("region", { name: "Shared wallets details" })).toHaveTextContent("signature collection")
        expect(screen.getByRole("button", { name: "Back to Engine" })).toHaveFocus()
        advance(24_000)
        expect(screen.getByRole("region", { name: "Shared wallets details" })).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Back to Engine" }))
        expect(screen.getByRole("button", { name: "Hide all 20 tools" })).toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Details: Shared wallets" })).toHaveFocus()
    })

    it("stops when the OS scroll body is read or the document is hidden", () => {
        render(<div className="os-wbody"><CooperationEngine chainId="gnoland-1" support={vi.fn()} /></div>)
        fireEvent.scroll(document.querySelector(".os-wbody")!)
        advance(24_000)
        expect(screen.getByRole("region", { name: "Engine" })).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Play tour" }))
        vi.spyOn(document, "hidden", "get").mockReturnValue(true)
        fireEvent(document, new Event("visibilitychange"))
        advance(24_000)
        expect(screen.getByRole("region", { name: "Engine" })).toBeInTheDocument()
        vi.restoreAllMocks()
    })
})
