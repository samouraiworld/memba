// NetworkSync reload-branching regression tests.
//
// This reload logic has now caused two regressions (an unconditional reload on
// every first visit — the e2e workers:2 pass-rate regression and a double-load
// for every fresh visitor — and, earlier, the network-switch RPC staleness it
// exists to fix). These tests pin the full decision table: reload ONLY when the
// URL network differs from the network config.ts was module-loaded with
// (ACTIVE_NETWORK_KEY); a first visit on the active network persists silently.

import { render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NetworkSync } from "./NetworkSync"

const mocks = vi.hoisted(() => ({
    params: { network: undefined as string | undefined },
}))

vi.mock("react-router-dom", async (importOriginal) => ({
    ...(await importOriginal<typeof import("react-router-dom")>()),
    useParams: () => mocks.params,
}))

// importOriginal spread — narrow config mocks break transitive importers.
vi.mock("../../lib/config", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/config")>()),
    // The network config.ts "loaded with" in these tests, regardless of what
    // jsdom's localStorage held when the real module evaluated.
    ACTIVE_NETWORK_KEY: "test13",
    NETWORKS: {
        test13: { chainId: "test-13" },
        betanet: { chainId: "beta-1" },
    },
}))

describe("NetworkSync", () => {
    const reload = vi.fn()
    const realLocation = window.location

    beforeEach(() => {
        localStorage.clear()
        reload.mockClear()
        Object.defineProperty(window, "location", {
            value: { ...realLocation, reload },
            writable: true,
        })
    })

    afterEach(() => {
        Object.defineProperty(window, "location", { value: realLocation, writable: true })
    })

    const renderWithNetwork = (network?: string) => {
        mocks.params.network = network
        return render(<NetworkSync />)
    }

    it("first visit on the ACTIVE network: persists the key, does NOT reload", () => {
        renderWithNetwork("test13")
        expect(localStorage.getItem("memba_network")).toBe("test13")
        expect(reload).not.toHaveBeenCalled()
    })

    it("first visit on a DIFFERENT network than config loaded with: persists and reloads", () => {
        renderWithNetwork("betanet")
        expect(localStorage.getItem("memba_network")).toBe("betanet")
        expect(reload).toHaveBeenCalledTimes(1)
    })

    it("stored network already matches the URL: fully inert", () => {
        localStorage.setItem("memba_network", "test13")
        renderWithNetwork("test13")
        expect(reload).not.toHaveBeenCalled()
    })

    it("real network switch (stored and config differ from URL): reloads", () => {
        localStorage.setItem("memba_network", "test13")
        renderWithNetwork("betanet")
        expect(localStorage.getItem("memba_network")).toBe("betanet")
        expect(reload).toHaveBeenCalledTimes(1)
    })

    it("unknown network param: inert (no persist, no reload)", () => {
        renderWithNetwork("nonsense")
        expect(localStorage.getItem("memba_network")).toBeNull()
        expect(reload).not.toHaveBeenCalled()
    })

    it("no network param: inert", () => {
        renderWithNetwork(undefined)
        expect(reload).not.toHaveBeenCalled()
    })

    it("no-reload-loop: after the post-reload remount the key matches, so nothing fires", () => {
        // Simulates the page state right after a (b)/(d) reload: setItem already
        // happened, and the remounted module would have ACTIVE_NETWORK_KEY equal
        // to the stored key. Here stored === URL param short-circuits before the
        // reload check is ever reached.
        localStorage.setItem("memba_network", "test13")
        renderWithNetwork("test13")
        renderWithNetwork("test13")
        expect(reload).not.toHaveBeenCalled()
    })
})
