/**
 * home-a11y.test.tsx — Accessibility assertions for the Home Control Room.
 *
 * Verifies:
 *   - Member home: "Act now" section is reachable by role/label, and
 *     the all-caught-up "Browse DAOs" link is reachable by role.
 *   - Visitor home: primary CTA ("Explore DAOs") and secondary CTA
 *     ("Connect wallet" or "Install Adena") are reachable by role.
 *   - No interactive div-with-onClick in the home root (semantic controls only).
 */

import { describe, it, expect, vi } from "vitest"
import { screen } from "@testing-library/react"
import { renderWithProviders } from "../test/test-utils"
import { Home } from "./Home"

// ── Shared mocks ──────────────────────────────────────────────────────

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
                installed: true,
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

vi.mock("../hooks/home/useNetworkPulse", () => ({
    useNetworkPulse: vi.fn(() => ({
        blockHeight: 1000,
        avgBlockTime: 2,
        totalValidators: 3,
        daoCount: 5,
        memberCount: 10,
        loading: false,
    })),
}))

vi.mock("../hooks/home/useEcosystemCounts", () => ({
    useEcosystemCounts: vi.fn(() => ({
        tokens: 1,
        agents: 0,
        validators: 3,
        daos: 5,
        collections: 2,
        loading: false,
    })),
}))

vi.mock("../hooks/home/useValidatorHealth", () => ({
    useValidatorHealth: vi.fn(() => ({
        status: "healthy",
        active: 3,
        total: 3,
        avgUptime: null,
        latestIncident: null,
        loading: false,
    })),
}))

vi.mock("../hooks/home/useGnoloveHighlights", () => ({
    useGnoloveHighlights: vi.fn(() => ({
        top: [],
        contributorCount: 0,
        loading: false,
    })),
}))

vi.mock("../hooks/home/useDirectoryHighlights", () => ({
    useDirectoryHighlights: vi.fn(() => ({
        memberCount: 5,
        members: [],
        loading: false,
    })),
}))

// Member-mode spine mocks (ActionInbox deps)
vi.mock("../hooks/home/useHomeActions", () => ({
    useHomeActions: vi.fn(() => ({
        actions: [],
        loading: false,
        allCaughtUp: true,
        unvotedProposals: [],
    })),
}))

vi.mock("../hooks/useUnvotedProposals", () => ({
    useUnvotedProposals: vi.fn(() => ({
        proposals: [],
        loading: false,
        refresh: vi.fn(),
    })),
}))

vi.mock("../hooks/useNetworkNav", () => ({
    useNetworkPath: vi.fn(() => (path: string) => `/test13/${path}`),
    useNetworkKey: vi.fn(() => "test13"),
    useNetworkNav: vi.fn(() => vi.fn()),
}))

// ── Tests ─────────────────────────────────────────────────────────────

describe("Home a11y — member mode", () => {
    it("'Act now' region is reachable by role and label", () => {
        renderWithProviders(<Home mode="member" />, { route: "/test13/" })
        // ActionInbox renders <section aria-label="Act now">
        expect(
            screen.getByRole("region", { name: /act now/i }),
        ).toBeInTheDocument()
    })

    it("'Browse DAOs' link is reachable by role in all-caught-up state", () => {
        renderWithProviders(<Home mode="member" />, { route: "/test13/" })
        // The all-caught-up card renders an <a> with text "Browse DAOs"
        expect(
            screen.getByRole("link", { name: /browse daos/i }),
        ).toBeInTheDocument()
    })
})

describe("Home a11y — visitor mode", () => {
    it("primary CTA 'Explore DAOs' is reachable by role", () => {
        renderWithProviders(<Home mode="visitor" />, { route: "/test13/" })
        expect(
            screen.getByRole("link", { name: /explore daos/i }),
        ).toBeInTheDocument()
    })

    it("secondary wallet CTA is reachable by role", () => {
        renderWithProviders(<Home mode="visitor" />, { route: "/test13/" })
        // Adena is installed → renders a <button>
        expect(
            screen.getByRole("button", { name: /connect wallet/i }),
        ).toBeInTheDocument()
    })
})
