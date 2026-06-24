/**
 * useHomeSnapshot.test.ts
 *
 * Covers:
 * 1. On SNAPSHOT_NETWORK with a populated snapshot → usable === true, snapshot returned.
 * 2. On a different network → usable === false and fetchHomeSnapshot NOT called (query disabled).
 * 3. Snapshot resolves to null → usable === false.
 * 4. Snapshot is the empty failure shell {staleSources:["all"]} → usable === false.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import React from "react"

// ── Module-level mocks ────────────────────────────────────────

vi.mock("../../lib/homeApi", () => ({
    fetchHomeSnapshot: vi.fn(),
}))

vi.mock("../useNetwork", () => ({
    useNetwork: vi.fn(() => ({
        networkKey: "test13",
        chainId: "test-13",
        rpcUrl: "https://rpc.test13.testnets.gno.land:443",
        label: "Testnet 13",
    })),
}))

// ── Resolve mocked modules for per-test control ───────────────

const homeApiMod = await import("../../lib/homeApi")
const networkMod = await import("../useNetwork")

// ── Wrapper ───────────────────────────────────────────────────

function makeWrapper() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return function Wrapper({ children }: { children: ReactNode }) {
        return React.createElement(QueryClientProvider, { client }, children)
    }
}

// ── Tests ─────────────────────────────────────────────────────

describe("useHomeSnapshot — on SNAPSHOT_NETWORK with populated snapshot", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(networkMod.useNetwork).mockReturnValue({
            networkKey: "test13",
            chainId: "test-13",
            rpcUrl: "https://rpc.test13.testnets.gno.land:443",
            label: "Testnet 13",
            switchNetwork: vi.fn(),
            networks: {},
        })
    })

    it("returns usable=true and the populated snapshot", async () => {
        const mockSnapshot = {
            memberCount: 5,
            openProposalCount: 2,
            featuredDaoTitle: "Memba DAO",
            staleSources: [],
        }
        vi.mocked(homeApiMod.fetchHomeSnapshot).mockResolvedValue(mockSnapshot as never)

        const { useHomeSnapshot } = await import("./useHomeSnapshot")
        const { result } = renderHook(() => useHomeSnapshot(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.isLoading).toBe(false))

        expect(result.current.usable).toBe(true)
        expect(result.current.snapshot).toBe(mockSnapshot)
        expect(homeApiMod.fetchHomeSnapshot).toHaveBeenCalled()
    })
})

describe("useHomeSnapshot — on a different network", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(networkMod.useNetwork).mockReturnValue({
            networkKey: "test12",
            chainId: "test12",
            rpcUrl: "https://rpc.testnet12.samourai.live:443",
            label: "Testnet 12",
            switchNetwork: vi.fn(),
            networks: {},
        })
    })

    it("returns usable=false and does NOT call fetchHomeSnapshot (query disabled)", async () => {
        vi.mocked(homeApiMod.fetchHomeSnapshot).mockResolvedValue(null)

        const { useHomeSnapshot } = await import("./useHomeSnapshot")
        const { result } = renderHook(() => useHomeSnapshot(), { wrapper: makeWrapper() })

        // Query is disabled — isLoading stays false immediately
        await waitFor(() => expect(result.current.isLoading).toBe(false))

        expect(result.current.usable).toBe(false)
        expect(result.current.snapshot).toBeNull()
        expect(homeApiMod.fetchHomeSnapshot).not.toHaveBeenCalled()
    })
})

describe("useHomeSnapshot — snapshot resolves to null", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(networkMod.useNetwork).mockReturnValue({
            networkKey: "test13",
            chainId: "test-13",
            rpcUrl: "https://rpc.test13.testnets.gno.land:443",
            label: "Testnet 13",
            switchNetwork: vi.fn(),
            networks: {},
        })
    })

    it("returns usable=false when snapshot is null", async () => {
        vi.mocked(homeApiMod.fetchHomeSnapshot).mockResolvedValue(null)

        const { useHomeSnapshot } = await import("./useHomeSnapshot")
        const { result } = renderHook(() => useHomeSnapshot(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.isLoading).toBe(false))

        expect(result.current.usable).toBe(false)
        expect(result.current.snapshot).toBeNull()
    })
})

describe("useHomeSnapshot — snapshot is the empty failure shell", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(networkMod.useNetwork).mockReturnValue({
            networkKey: "test13",
            chainId: "test-13",
            rpcUrl: "https://rpc.test13.testnets.gno.land:443",
            label: "Testnet 13",
            switchNetwork: vi.fn(),
            networks: {},
        })
    })

    it("returns usable=false when staleSources=[\"all\"] (total backend failure shell)", async () => {
        const failureShell = {
            memberCount: 0,
            openProposalCount: 0,
            staleSources: ["all"],
        }
        vi.mocked(homeApiMod.fetchHomeSnapshot).mockResolvedValue(failureShell as never)

        const { useHomeSnapshot } = await import("./useHomeSnapshot")
        const { result } = renderHook(() => useHomeSnapshot(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.isLoading).toBe(false))

        expect(result.current.usable).toBe(false)
        expect(result.current.snapshot).toBe(failureShell)
    })
})
