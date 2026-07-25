/**
 * ChainContextProvider tests (B-5 Phase 1).
 *
 * The provider mounts INERT — zero page consumers — but two behaviors are
 * load-bearing from day one and pinned here:
 *   1. It provides a Gno provider for config.ts's active network (B-3 contract:
 *      the CAL follows `memba_network`, no parallel chain state).
 *   2. It bridges useAdena's wallet state into the GnoProvider via
 *      setWalletBridge (B-5 Phase 0's injection path) — connected address in,
 *      cleared on disconnect. NOTE: the bridge mirrors THIS instance's
 *      useAdena state only; instances don't cross-sync, so Phase 2 needs a
 *      shared wallet source before pages rely on CAL writes (recorded in
 *      B5_CAL_MOUNT_PLAN Phase 2 prerequisites).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, waitFor } from "@testing-library/react"
import { useContext } from "react"
import { ChainContextProvider } from "./ChainContextProvider"
import { ChainContext, type ChainContextValue } from "./context"
import { clearProviderCache } from "./registry"
import { ACTIVE_NETWORK_KEY } from "../config"
import { configKeyToChainId } from "./gnoBridge"

const adenaState = {
    connected: false,
    address: "",
    pubkeyJSON: "",
    chainId: "",
    loading: false,
    reconnecting: false,
    error: null as string | null,
    rpcUrl: "",
    rpcTrusted: false,
}

vi.mock("../../hooks/useAdena", () => ({
    useAdena: () => ({ ...adenaState, installed: true }),
}))

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
    adenaState.connected = false
    adenaState.address = ""
})

describe("ChainContextProvider — inert mount (B-5 Phase 1)", () => {
    it("provides a Gno provider for config.ts's active network", () => {
        const { value } = renderWithCapture()
        expect(value.family).toBe("gno")
        expect(value.network.chainId).toBe(configKeyToChainId(ACTIVE_NETWORK_KEY))
        expect(value.provider.family).toBe("gno")
    })

    it("bridges a connected useAdena wallet into the provider", async () => {
        adenaState.connected = true
        adenaState.address = "g1bridged"
        const { value } = renderWithCapture()
        await waitFor(() => {
            expect(value.provider.getWalletState()).toEqual({
                connected: true,
                address: { raw: "g1bridged", family: "gno" },
                family: "gno",
            })
        })
    })

    it("clears the provider's wallet state on the connected → disconnected TRANSITION", async () => {
        // Start connected — the disconnect branch must actively clear, not
        // just observe a never-connected provider (which would pass vacuously).
        adenaState.connected = true
        adenaState.address = "g1gone"
        const { utils, value } = renderWithCapture()
        await waitFor(() => {
            expect(value.provider.getWalletState().connected).toBe(true)
        })
        adenaState.connected = false
        adenaState.address = ""
        utils.rerender(
            <ChainContextProvider>
                <Capture onValue={() => { /* value already captured */ }} />
            </ChainContextProvider>,
        )
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
