import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NFT_MARKET_PATH } from "../../../lib/nft/market"
import { classicForSection } from "../../page/classicRoute"
import type { WindowSpec } from "../../shell/windows"
import MarketWindow from "./native"

// The lane registry is real: only its inputs (each lane's build flag and realm check) are driven here.
// The NFT lane's realm is checked per network, as "<network>:<path>"; the v3 engine it no longer reads as "nft-v3".
const gates = vi.hoisted(() => ({ flags: new Set<string>(), realms: new Set<string>() }))
vi.mock("../../../lib/config", async (original) => ({
    ...(await original<typeof import("../../../lib/config")>()),
    isNftEnabled: () => gates.flags.has("nft"),
    isRealmValidOn: (network: string, path: string) => gates.realms.has(`${network}:${path}`),
    isNftMarketV3Valid: () => gates.realms.has("nft-v3"),
    isServicesEnabled: () => gates.flags.has("service"),
    isEscrowValid: () => gates.realms.has("service"),
    isTokensEnabled: () => gates.flags.has("token"),
    isTokenOtcValid: () => gates.realms.has("token"),
    isAgentsEnabled: () => gates.flags.has("agent"),
    isAgentRegistryValid: () => gates.realms.has("agent"),
}))
// The NFT lane's views are their own module's to test: here, only which one the window shows.
vi.mock("./nft/lane", () => ({ default: ({ route }: { route: { kind: string } }) => <p>NFT lane: {route.kind}</p> }))
const NFT_REALM = `mainnet:${NFT_MARKET_PATH}`
const live = (...lanes: string[]) => lanes.forEach((lane) => { gates.flags.add(lane); gates.realms.add(lane === "nft" ? NFT_REALM : lane) })
// The session names the network the NFT realm is checked on and the chain the notes name; the gates above decide the rest.
const session = { network: { key: "mainnet", chainId: "session-chain-1" } } as never
const base = { query: undefined, session, active: true, push: () => {}, openApp: () => {}, close: () => {}, toast: () => {}, fallback: <p>classic page</p> }
const buttonNames = () => screen.queryAllByRole("button").map((b) => b.textContent)
const sectionOf = (spec: WindowSpec) => (spec.target?.kind === "app" ? spec.target.section : null)

describe("Market window", () => {
    beforeEach(() => { gates.flags.clear(); gates.realms.clear() })

    it("says no lane is available here and what a lane needs, with no card and no promise, when no lane is live", () => {
        render(<MarketWindow {...base} section={null} open={vi.fn()} />)
        expect(screen.getByRole("heading", { name: "Market lanes" })).toBeInTheDocument()
        const note = screen.getByRole("note")
        // The pill and the first sentence say the same thing; the chain is the session's.
        expect(note.textContent).toBe("No Market lane here No Market lane is available here. A lane appears only when it is enabled in this build and its realm is available on session-chain-1.")
        expect(note).not.toHaveTextContent(/\b(yet|soon)\b/i)
        expect(buttonNames()).toEqual([])
        expect(screen.queryByText("classic page")).toBeNull()
    })

    it("keeps a lane off the home when only its flag or only its realm is there", () => {
        gates.flags.add("nft")
        gates.realms.add("service")
        // The NFT lane reads the launchpad market: the v3 engine, or the realm on another network, does not open it.
        gates.realms.add("nft-v3")
        gates.realms.add(`testnet12:${NFT_MARKET_PATH}`)
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

    it("renders the fallback for a live lane's section, under a control that opens the home", () => {
        live("service")
        const open = vi.fn<(spec: WindowSpec) => void>()
        render(<MarketWindow {...base} section="marketplace/services" open={open} />)
        expect(screen.getByText("classic page")).toBeInTheDocument()
        expect(screen.queryByRole("heading")).toBeNull()
        expect(buttonNames()).toEqual(["← Market lanes"])

        fireEvent.click(screen.getByRole("button", { name: "Market lanes" }))
        expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ key: "app:market", target: { kind: "app", app: "market", section: null } }))
    })

    it("hands a section no lane names to the classic page while any lane is live, and shows the home while none is", () => {
        live("service")
        const { rerender } = render(<MarketWindow {...base} section="my-listings" open={vi.fn()} />)
        expect(screen.getByText("classic page")).toBeInTheDocument()

        gates.flags.clear()
        rerender(<MarketWindow {...base} section="my-listings" open={vi.fn()} />)
        expect(screen.queryByText("classic page")).toBeNull()
        expect(screen.getByRole("note")).toHaveTextContent("No Market lane is available here.")
    })

    it("shows the home with a note naming the lane for a section of a lane that is not live, and still lists the live ones", () => {
        live("service")
        render(<MarketWindow {...base} section="tokens" open={vi.fn()} />)
        expect(screen.getByRole("heading", { name: "Market lanes" })).toBeInTheDocument()
        expect(screen.getByRole("note").textContent).toBe("Tokens unavailable here The Tokens lane is unavailable here. A lane appears only when it is enabled in this build and its realm is available on session-chain-1.")
        expect(buttonNames()).toEqual(["ServicesHire with milestone escrow"])
        expect(screen.queryByText("classic page")).toBeNull()
    })

    it.each(["nfts", "nfts/c/C1", "nfts/c/C1/2", "nfts/mine", "nfts/c/C01"])("shows the NFT note for %s while the NFT lane is not live, and no lane view", (section) => {
        gates.flags.add("nft")
        gates.realms.add("nft-v3")
        render(<MarketWindow {...base} section={section} open={vi.fn()} />)
        expect(screen.getByRole("note")).toHaveTextContent(/^NFTs unavailable here The NFTs lane is unavailable here\./)
        expect(screen.queryByText("classic page")).toBeNull()
        expect(screen.queryByText(/NFT lane:/)).toBeNull()
    })

    it.each([["nfts", "explore"], ["nfts/c/C1", "collection"], ["nfts/c/C1/2", "token"], ["nfts/mine", "mine"]])("shows the NFT lane view for %s, never the fallback", async (section, kind) => {
        live("nft")
        render(<MarketWindow {...base} section={section} open={vi.fn()} />)
        expect(await screen.findByText(`NFT lane: ${kind}`)).toBeInTheDocument()
        expect(screen.queryByText("classic page")).toBeNull()
        expect(screen.getByRole("button", { name: "Market lanes" })).toBeInTheDocument()
    })

    it("hands an NFT section it cannot parse to the fallback", () => {
        live("nft")
        render(<MarketWindow {...base} section="nfts/c/C01" open={vi.fn()} />)
        expect(screen.getByText("classic page")).toBeInTheDocument()
        expect(screen.queryByText(/NFT lane:/)).toBeNull()
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

    it("lands focus on the home, not a lane control, when the lane a card opened is no longer live", () => {
        live("service")
        const open = vi.fn<(spec: WindowSpec) => void>()
        const view = (section: string | null) => <MarketWindow {...base} section={section} open={open} />
        const { rerender } = render(view(null))
        fireEvent.click(screen.getByRole("button", { name: /Services/ }))
        gates.flags.clear()
        rerender(view(sectionOf(open.mock.lastCall![0])))
        expect(screen.queryByRole("button", { name: "Market lanes" })).toBeNull()
        expect(screen.getByRole("heading", { name: "Market lanes" })).toHaveFocus()
    })

    it("takes no focus when another window came to the front before the lane it opened was shown", () => {
        live("service")
        const open = vi.fn<(spec: WindowSpec) => void>()
        const view = (section: string | null, active: boolean) => <MarketWindow {...base} active={active} section={section} open={open} />
        const { rerender } = render(view(null, true))
        const card = screen.getByRole("button", { name: /Services/ })
        card.focus()
        fireEvent.click(card)
        const lane = sectionOf(open.mock.lastCall![0])
        // The lane shows late, in a window that is no longer in front: focus would raise it.
        rerender(view(lane, false))
        expect(screen.getByRole("button", { name: "Market lanes" })).not.toHaveFocus()
        expect(document.body).toHaveFocus()
        // Coming back to the front later does not replay the move.
        rerender(view(lane, true))
        expect(document.body).toHaveFocus()
    })
})
