import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NETWORKS } from "../../../lib/config"
import { classicForSection } from "../../page/classicRoute"
import type { WindowSpec } from "../../shell/windows"
import MarketWindow from "./native"

// The lane registry is real: only its inputs (each lane's build flag and realm check) are driven here.
const gates = vi.hoisted(() => ({ flags: new Set<string>(), realms: new Set<string>() }))
vi.mock("../../../lib/config", async (original) => ({
    ...(await original<typeof import("../../../lib/config")>()),
    isNftEnabled: () => gates.flags.has("nft"),
    isNftMarketV3Valid: () => gates.realms.has("nft"),
    isServicesEnabled: () => gates.flags.has("service"),
    isEscrowValid: () => gates.realms.has("service"),
    isTokensEnabled: () => gates.flags.has("token"),
    isTokenOtcValid: () => gates.realms.has("token"),
    isAgentsEnabled: () => gates.flags.has("agent"),
    isAgentRegistryValid: () => gates.realms.has("agent"),
}))
const live = (...lanes: string[]) => lanes.forEach((lane) => { gates.flags.add(lane); gates.realms.add(lane) })
// The session only names the chain in the no-lane note; the gates above decide which lanes are live.
const base = { query: undefined, session: { network: { key: "mainnet" } } as never, openApp: () => {}, close: () => {}, toast: () => {}, fallback: <p>classic page</p> }
const buttonNames = () => screen.queryAllByRole("button").map((b) => b.textContent)
const sectionOf = (spec: WindowSpec) => (spec.target?.kind === "app" ? spec.target.section : null)

describe("Market window", () => {
    beforeEach(() => { gates.flags.clear(); gates.realms.clear() })

    it("says no lane is available here and what a lane needs, with no card and no promise, when no lane is live", () => {
        render(<MarketWindow {...base} section={null} open={vi.fn()} />)
        expect(screen.getByRole("heading", { name: "Market lanes" })).toBeInTheDocument()
        const note = screen.getByRole("note")
        expect(note).toHaveTextContent("No Market lane is available here.")
        expect(note).toHaveTextContent(`A lane appears only when it is enabled in this build and its realm is available on ${NETWORKS.mainnet.chainId}.`)
        expect(note).not.toHaveTextContent(/\b(yet|soon)\b/i)
        expect(buttonNames()).toEqual([])
        expect(screen.queryByText("classic page")).toBeNull()
    })

    it("keeps a lane off the home when only its flag or only its realm is there", () => {
        gates.flags.add("nft")
        gates.realms.add("service")
        render(<MarketWindow {...base} section={null} open={vi.fn()} />)
        expect(screen.getByRole("note")).toHaveTextContent("No Market lane is available here.")
        expect(buttonNames()).toEqual([])
    })

    it("shows exactly the live lanes, each opening its lane in the Market window", () => {
        live("service", "nft")
        const open = vi.fn<(spec: WindowSpec) => void>()
        render(<MarketWindow {...base} section={null} open={open} />)
        expect(screen.getAllByRole("heading")).toHaveLength(1)
        expect(screen.queryByRole("note")).toBeNull()
        expect(buttonNames()).toEqual(["NFTsCollections and listings", "ServicesHire with milestone escrow"])

        fireEvent.click(screen.getByRole("button", { name: /NFTs/ }))
        expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ key: "app:market", target: { kind: "app", app: "market", section: "nfts" } }))

        fireEvent.click(screen.getByRole("button", { name: /Services/ }))
        expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ key: "app:market", target: { kind: "app", app: "market", section: "marketplace/services" } }))
    })

    it("stays on the home when exactly one lane is live", () => {
        live("service")
        const open = vi.fn()
        render(<MarketWindow {...base} section={null} open={open} />)
        expect(buttonNames()).toEqual(["ServicesHire with milestone escrow"])
        expect(open).not.toHaveBeenCalled()
    })

    it("lands every lane card on that lane's classic page, never on a redirect", () => {
        live("nft", "service", "token", "agent")
        const open = vi.fn<(spec: WindowSpec) => void>()
        render(<MarketWindow {...base} section={null} open={open} />)
        const pages = screen.getAllByRole("button").map((card) => {
            fireEvent.click(card)
            return classicForSection("market", sectionOf(open.mock.lastCall![0]))
        })
        expect(pages).toEqual(["marketplace/nfts", "marketplace/services", "marketplace/tokens", "marketplace/agents"])
    })

    it("renders the fallback for every section other than the home, under a control that opens the home", () => {
        live("nft")
        const open = vi.fn<(spec: WindowSpec) => void>()
        render(<MarketWindow {...base} section="nfts" open={open} />)
        expect(screen.getByText("classic page")).toBeInTheDocument()
        expect(screen.queryByRole("heading")).toBeNull()
        expect(buttonNames()).toEqual(["← Market lanes"])

        fireEvent.click(screen.getByRole("button", { name: "Market lanes" }))
        expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ key: "app:market", target: { kind: "app", app: "market", section: null } }))
    })

    it("carries focus into the view a card or the home control opens, instead of dropping it on the page", () => {
        live("service")
        const open = vi.fn<(spec: WindowSpec) => void>()
        const view = (section: string | null) => <MarketWindow {...base} section={section} open={open} />
        const { rerender } = render(view(null))
        const card = screen.getByRole("button", { name: /Services/ })
        card.focus()
        fireEvent.click(card)
        rerender(view(sectionOf(open.mock.lastCall![0])))
        const back = screen.getByRole("button", { name: "Market lanes" })
        expect(back).toHaveFocus()

        fireEvent.click(back)
        rerender(view(sectionOf(open.mock.lastCall![0])))
        expect(screen.getByRole("heading", { name: "Market lanes" })).toHaveFocus()
    })

    it("takes no focus when the window opens straight on a lane or on the home", () => {
        live("service")
        const { rerender } = render(<MarketWindow {...base} section="marketplace/services" open={vi.fn()} />)
        expect(document.body).toHaveFocus()
        rerender(<MarketWindow {...base} section={null} open={vi.fn()} />)
        expect(document.body).toHaveFocus()
    })
})
