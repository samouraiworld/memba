/**
 * Home.test.tsx — Tests for the mode-aware Control Room Home shell.
 *
 * Covers:
 * - member mode: home-spine-member + home-state-board + StatusStrip chain label
 * - visitor mode: home-spine-visitor + home-state-board
 * - StatusStrip renders deterministically with mocked hooks
 */

import { describe, it, expect, vi } from "vitest"
import { screen } from "@testing-library/react"
import { renderWithProviders } from "../test/test-utils"
import { Home } from "./Home"

// ── Mock react-router-dom's useOutletContext ──────────────────────────
vi.mock("react-router-dom", async () => {
    const actual = await import("react-router-dom")
    return {
        ...actual,
        useOutletContext: vi.fn(() => ({
            adena: {
                connected: false,
                address: "",
                pubkeyJSON: "",
                chainId: "",
                installed: false,
                loading: false,
                connect: vi.fn(),
                disconnect: vi.fn(),
                signArbitrary: vi.fn(),
            },
            balance: "0",
            auth: {
                token: null,
                isAuthenticated: false,
                address: "",
                loading: false,
                error: null,
            },
            isLoggingIn: false,
            syncTimedOut: false,
        })),
    }
})

// ── Mock useNetwork so StatusStrip has a deterministic chain label ────
vi.mock("../hooks/useNetwork", () => ({
    useNetwork: vi.fn(() => ({
        networkKey: "test13",
        chainId: "test13",
        rpcUrl: "https://rpc.test13.gno.land",
        label: "test13",
        switchNetwork: vi.fn(),
        networks: {},
    })),
}))

// ── Mock useNetworkPulse so StatusStrip renders without RPC calls ─────
vi.mock("../hooks/home/useNetworkPulse", () => ({
    useNetworkPulse: vi.fn(() => ({
        blockHeight: 12345,
        avgBlockTime: 2.1,
        totalValidators: 3,
        daoCount: 8,
        memberCount: 42,
        loading: false,
    })),
}))

// ── Mock useEcosystemCounts so EcosystemPanel renders without RPC calls ─
vi.mock("../hooks/home/useEcosystemCounts", () => ({
    useEcosystemCounts: vi.fn(() => ({
        tokens: 3,
        agents: 2,
        validators: 5,
        daos: 7,
        collections: 4,
        loading: false,
    })),
}))

// ── Mock useValidatorHealth so ValidatorsPanel renders without RPC calls ─
vi.mock("../hooks/home/useValidatorHealth", () => ({
    useValidatorHealth: vi.fn(() => ({
        status: "healthy",
        active: 5,
        total: 5,
        avgUptime: null,
        latestIncident: null,
        loading: false,
    })),
}))

// ── Mock useGnoloveHighlights so GnolovePanel renders without API calls ──
vi.mock("../hooks/home/useGnoloveHighlights", () => ({
    useGnoloveHighlights: vi.fn(() => ({
        top: [
            { login: "charlie", score: 300 },
            { login: "bob", score: 250 },
            { login: "eve", score: 175 },
        ],
        contributorCount: 5,
        loading: false,
    })),
}))

// Resolve mocks before tests (vi.mock + await import pattern)
const _networkMock = await import("../hooks/useNetwork")
const _pulseMock = await import("../hooks/home/useNetworkPulse")
const _ecosystemMock = await import("../hooks/home/useEcosystemCounts")
void _networkMock
void _pulseMock
void _ecosystemMock

describe("Home — member mode", () => {
    it("renders the member spine container", () => {
        renderWithProviders(<Home mode="member" />, { route: "/test13/" })
        expect(screen.getByTestId("home-spine-member")).toBeInTheDocument()
    })

    it("does NOT render the visitor spine container", () => {
        renderWithProviders(<Home mode="member" />, { route: "/test13/" })
        expect(screen.queryByTestId("home-spine-visitor")).not.toBeInTheDocument()
    })

    it("renders the state board container", () => {
        renderWithProviders(<Home mode="member" />, { route: "/test13/" })
        expect(screen.getByTestId("home-state-board")).toBeInTheDocument()
    })

    it("renders StatusStrip with the chain label", () => {
        renderWithProviders(<Home mode="member" />, { route: "/test13/" })
        expect(screen.getByText("test13")).toBeInTheDocument()
    })
})

describe("Home — visitor mode", () => {
    it("renders the visitor spine container", () => {
        renderWithProviders(<Home mode="visitor" />, { route: "/test13/" })
        expect(screen.getByTestId("home-spine-visitor")).toBeInTheDocument()
    })

    it("does NOT render the member spine container", () => {
        renderWithProviders(<Home mode="visitor" />, { route: "/test13/" })
        expect(screen.queryByTestId("home-spine-member")).not.toBeInTheDocument()
    })

    it("renders the state board container", () => {
        renderWithProviders(<Home mode="visitor" />, { route: "/test13/" })
        expect(screen.getByTestId("home-state-board")).toBeInTheDocument()
    })

    it("StatusStrip chain label visible in visitor mode too", () => {
        renderWithProviders(<Home mode="visitor" />, { route: "/test13/" })
        expect(screen.getByText("test13")).toBeInTheDocument()
    })
})

describe("Home — StatusStrip", () => {
    it("renders the status strip", () => {
        renderWithProviders(<Home mode="member" />, { route: "/test13/" })
        expect(screen.getByTestId("status-strip")).toBeInTheDocument()
    })

    it("shows メンバー wordmark", () => {
        renderWithProviders(<Home mode="member" />, { route: "/test13/" })
        expect(screen.getByText("メンバー")).toBeInTheDocument()
    })

    it("shows block height when not loading", () => {
        renderWithProviders(<Home mode="member" />, { route: "/test13/" })
        expect(screen.getByTestId("status-block-height")).toBeInTheDocument()
    })

    it("shows validator count when not loading", () => {
        renderWithProviders(<Home mode="member" />, { route: "/test13/" })
        expect(screen.getByTestId("status-validators")).toBeInTheDocument()
    })
})
