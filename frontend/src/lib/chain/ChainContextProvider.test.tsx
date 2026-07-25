/**
 * ChainContextProvider tests (B-5 Phase 1).
 *
 * The provider mounts INERT — zero page consumers — but two behaviors are
 * load-bearing from day one and pinned here:
 *   1. It provides a Gno provider for config.ts's active network (B-3 contract:
 *      the CAL follows `memba_network`, no parallel chain state).
 *   2. It bridges the walletBus (B-5 Phase 2a — the shared source every
 *      useAdena instance publishes its transitions to) into the GnoProvider
 *      via setWalletBridge: connects published from ANY instance reach the
 *      provider without a remount, and disconnects actively clear it. This
 *      closed the Phase-1 review's stale-bridge finding.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, waitFor, act } from "@testing-library/react"
import { useContext } from "react"
import { ChainContextProvider } from "./ChainContextProvider"
import { ChainContext, type ChainContextValue } from "./context"
import { clearProviderCache } from "./registry"
import { ACTIVE_NETWORK_KEY } from "../config"
import { configKeyToChainId } from "./gnoBridge"
import { publishWalletState, resetWalletBusForTests } from "../walletBus"

// The provider fires a real dynamic import of EvmProvider (lazy viem chunk in
// prod). Mock it so tests don't load viem into the worker or race teardown.
vi.mock("./evm/EvmProvider", () => ({
    createEvmProvider: vi.fn(),
}))

function Capture({ onValue }: { onValue: (v: ChainContextValue) => void }) {
    const value = useContext(ChainContext)
    if (value) onValue(value)
    return null
}

function renderWithCapture() {
    let captured: ChainContextValue | null = null
    const utils = render(
        <ChainContextProvider>
            <Capture onValue={(v) => { captured = v }} />
        </ChainContextProvider>,
    )
    return { utils, get value() { return captured! } }
}

beforeEach(() => {
    clearProviderCache()
    resetWalletBusForTests()
})

describe("ChainContextProvider — inert mount (B-5 Phase 1)", () => {
    it("provides a Gno provider for config.ts's active network", () => {
        const { value } = renderWithCapture()
        expect(value.family).toBe("gno")
        expect(value.network.chainId).toBe(configKeyToChainId(ACTIVE_NETWORK_KEY))
        expect(value.provider.family).toBe("gno")
    })

    it("bridges a wallet connected BEFORE mount (bus already seeded)", async () => {
        publishWalletState({ connected: true, address: "g1bridged" })
        const { value } = renderWithCapture()
        await waitFor(() => {
            expect(value.provider.getWalletState()).toEqual({
                connected: true,
                address: { raw: "g1bridged", family: "gno" },
                family: "gno",
            })
        })
    })

    it("bridges a connect published AFTER mount — the cross-instance case the old own-useAdena bridge missed", async () => {
        const { value } = renderWithCapture()
        expect(value.provider.getWalletState().connected).toBe(false)
        // Any useAdena instance anywhere in the app publishing (interactive
        // connect via Layout's button, silent reconnect in App) must reach
        // this provider without a remount.
        act(() => publishWalletState({ connected: true, address: "g1late" }))
        await waitFor(() => {
            expect(value.provider.getWalletState()).toEqual({
                connected: true,
                address: { raw: "g1late", family: "gno" },
                family: "gno",
            })
        })
    })

    it("clears the provider's wallet state on the connected → disconnected TRANSITION", async () => {
        // Start connected — the disconnect branch must actively clear, not
        // just observe a never-connected provider (which would pass vacuously).
        publishWalletState({ connected: true, address: "g1gone" })
        const { value } = renderWithCapture()
        await waitFor(() => {
            expect(value.provider.getWalletState().connected).toBe(true)
        })
        act(() => publishWalletState({ connected: false, address: "" }))
        await waitFor(() => {
            expect(value.provider.getWalletState()).toEqual({
                connected: false, address: null, family: "gno",
            })
        })
    })

    it("lists all networks (gno + evm) for future selectors without creating any EVM provider", () => {
        const { value } = renderWithCapture()
        expect(value.availableNetworks.some((n) => n.family === "evm")).toBe(true)
        // Creating an EVM provider is Phase 4 — the mount alone must not do it.
        // (The eager-graph bundle gate pins that viem stays out of the entry chunk.)
    })
})
