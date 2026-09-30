/**
 * The Market home with one live lane, through the real window body: the real
 * native registry, lane registry (the Services build flag stubbed on, the
 * escrow realm from the real allowlist), section routing, window reducer and
 * classic Marketplace page. Only the wallet (a guest) and the Services lane's
 * chain reads are stubbed.
 */
import { fireEvent, render, screen, within } from "@testing-library/react"
import { useReducer } from "react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { ACTIVE_NETWORK_KEY } from "../../../lib/config"
import { mockLayoutContext } from "../../../test/test-utils"
import { activeOsNetwork } from "../../shell/network"
import type { OsSession } from "../../shell/useOsSession"
import { WindowBody } from "../../shell/WindowFrame"
import { appSpec, EMPTY_WINDOWS, windowsReducer, type WindowSpec } from "../../shell/windows"

vi.mock("../../../hooks/useAdena", () => ({ useAdena: () => ({ address: "", connected: false, connect: vi.fn() }) }))
vi.mock("../../../lib/marketplace/escrowState", async (original) => ({
    ...(await original<typeof import("../../../lib/marketplace/escrowState")>()),
    readEscrowPauseState: async () => ({ paused: false, exitsOpen: true, exitsReopenAt: 0, pausedBlocks: 0 }),
    readClientContracts: async () => ({ items: [], next: null }),
}))
vi.mock("../../../lib/dao/proposalDates", async (original) => ({
    ...(await original<typeof import("../../../lib/dao/proposalDates")>()),
    getCurrentBlock: async () => 300_000,
}))

const DESK = { w: 1400, h: 900 }
const session = { status: "guest", network: activeOsNetwork(), layout: mockLayoutContext(), openConnect: vi.fn() } as unknown as OsSession

/** One Market window on the real reducer: `open` retargets it, as the shell's does. */
function MarketOnDesk() {
    const [state, dispatch] = useReducer(windowsReducer, EMPTY_WINDOWS, (s) => windowsReducer(s, { type: "open", spec: appSpec("market"), desk: DESK }))
    const open = (spec: WindowSpec) => dispatch({ type: "open", spec, desk: DESK })
    return <WindowBody win={state.wins[0]} session={session} open={open} openApp={vi.fn()} close={vi.fn()} toast={vi.fn()} />
}

describe("Market window with the Services lane live", () => {
    // The window's lazy chunks load here, so each test's own timeout covers rendering only.
    beforeAll(async () => {
        await Promise.all([import("./native"), import("../../page/ClassicPage"), import("../../../pages/UnifiedMarketplace"), import("../../../components/marketplace/ServiceLane")])
    }, 120_000)
    beforeEach(() => { vi.stubEnv("VITE_ENABLE_SERVICES", "true") })
    afterEach(() => { vi.unstubAllEnvs() })

    it("opens the classic Services lane from its card, and returns to the home from the lane", async () => {
        // The escrow realm is allowlisted on mainnet only: this needs the default network.
        expect(ACTIVE_NETWORK_KEY).toBe("mainnet")
        const { container } = render(<MemoryRouter><MarketOnDesk /></MemoryRouter>)
        const classic = () => container.querySelector<HTMLElement>(".os-classic")

        // One live lane still shows the home: no jump into the lane.
        expect(await screen.findByRole("heading", { name: "Market lanes" })).toBeInTheDocument()
        expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["ServicesHire with milestone escrow"])
        expect(classic()).toBeNull()

        fireEvent.click(screen.getByRole("button", { name: /Services/ }))
        expect(await screen.findByRole("heading", { name: "Freelance Services" })).toBeInTheDocument()
        const page = within(classic()!)
        expect(page.getByRole("tab", { name: /Services/ })).toHaveAttribute("aria-selected", "true")
        expect(await page.findByRole("heading", { name: "Verified Services" })).toBeInTheDocument()
        expect(screen.queryByRole("heading", { name: "Market lanes" })).toBeNull()
        const back = screen.getByRole("button", { name: "Market lanes" })
        expect(classic()).not.toContainElement(back)
        expect(back).toHaveFocus()

        fireEvent.click(back)
        expect(await screen.findByRole("heading", { name: "Market lanes" })).toHaveFocus()
        expect(classic()).toBeNull()
        expect(screen.getByRole("button", { name: /Services/ })).toBeInTheDocument()
    })

    it("lists no lane once the Services flag is off, on the same network", async () => {
        vi.stubEnv("VITE_ENABLE_SERVICES", "false")
        render(<MemoryRouter><MarketOnDesk /></MemoryRouter>)
        expect(await screen.findByRole("note")).toHaveTextContent(`its realm is available on ${session.network.chainId}`)
        expect(screen.queryAllByRole("button")).toEqual([])
    })
})
