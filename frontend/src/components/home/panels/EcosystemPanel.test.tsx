/**
 * EcosystemPanel.test.tsx
 *
 * Per-panel isolation contract:
 *   1. With data   → counts render, deep-link hrefs present
 *   2. Loading     → skeleton cards render
 *   3. null count  → tile shows "—" while siblings still render (per-tile isolation)
 *   4. Never throws / blanks
 */

import { describe, it, expect, vi } from "vitest"
import { screen } from "@testing-library/react"
import { renderWithProviders } from "../../../test/test-utils"
import { EcosystemPanel } from "./EcosystemPanel"

// ── Mock the hooks consumed by EcosystemPanel ─────────────────

vi.mock("../../../hooks/home/useEcosystemCounts", () => ({
    useEcosystemCounts: vi.fn(() => ({
        tokens: null,
        agents: null,
        validators: null,
        daos: null,
        collections: null,
        loading: false,
    })),
}))

vi.mock("../../../hooks/home/useNetworkPulse", () => ({
    useNetworkPulse: vi.fn(() => ({
        blockHeight: 12345,
        avgBlockTime: 2.1,
        totalValidators: 5,
        daoCount: 8,
        memberCount: 42,
        loading: false,
    })),
}))

vi.mock("../../../hooks/useNetwork", () => ({
    useNetwork: vi.fn(() => ({
        networkKey: "test13",
        rpcUrl: "https://rpc.test13.gno.land",
    })),
}))

// Resolve for per-test control
const countsMod = await import("../../../hooks/home/useEcosystemCounts")
const pulseMod = await import("../../../hooks/home/useNetworkPulse")
const networkMod = await import("../../../hooks/useNetwork")

// ── Happy-path data ───────────────────────────────────────────

const FULL_COUNTS = {
    tokens: 3,
    agents: 2,
    validators: 5,
    daos: 7,
    collections: 4,
    loading: false,
}

const FULL_PULSE = {
    blockHeight: 12345,
    avgBlockTime: 2.1,
    totalValidators: 5,
    daoCount: 8,
    memberCount: 42,
    loading: false,
}

function setup(countsOverride = {}) {
    vi.mocked(countsMod.useEcosystemCounts).mockReturnValue({ ...FULL_COUNTS, ...countsOverride })
    vi.mocked(pulseMod.useNetworkPulse).mockReturnValue(FULL_PULSE)
    vi.mocked(networkMod.useNetwork).mockReturnValue({
        networkKey: "test13",
        rpcUrl: "https://rpc.test13.gno.land",
        chainId: "test-13",
        label: "Testnet 13",
        switchNetwork: vi.fn(),
        networks: {},
    })
}

// ── Tests ─────────────────────────────────────────────────────

describe("EcosystemPanel — panel container", () => {
    it("renders the panel testid", () => {
        setup()
        renderWithProviders(<EcosystemPanel />)
        expect(screen.getByTestId("ecosystem-panel")).toBeInTheDocument()
    })

    it("does NOT throw when hook returns all-null counts", () => {
        vi.mocked(countsMod.useEcosystemCounts).mockReturnValue({
            tokens: null, agents: null, validators: null, daos: null, collections: null, loading: false,
        })
        expect(() => renderWithProviders(<EcosystemPanel />)).not.toThrow()
    })
})

describe("EcosystemPanel — with data", () => {
    it("renders tokens count", () => {
        setup()
        renderWithProviders(<EcosystemPanel />)
        expect(screen.getByText("3")).toBeInTheDocument()
    })

    it("renders agents count", () => {
        setup()
        renderWithProviders(<EcosystemPanel />)
        expect(screen.getByText("2")).toBeInTheDocument()
    })

    it("renders validators count", () => {
        setup()
        renderWithProviders(<EcosystemPanel />)
        expect(screen.getByText("5")).toBeInTheDocument()
    })

    it("renders daos count", () => {
        setup()
        renderWithProviders(<EcosystemPanel />)
        expect(screen.getByText("7")).toBeInTheDocument()
    })

    it("renders collections count", () => {
        setup()
        renderWithProviders(<EcosystemPanel />)
        expect(screen.getByText("4")).toBeInTheDocument()
    })

    it("tiles link to feature routes with correct network prefix", () => {
        setup()
        renderWithProviders(<EcosystemPanel />)
        const links = screen.getAllByRole("link")
        const hrefs = links.map((l) => l.getAttribute("href"))
        expect(hrefs).toContain("/test13/tokens")
        expect(hrefs).toContain("/test13/marketplace")
        expect(hrefs).toContain("/test13/validators")
        expect(hrefs).toContain("/test13/dao")
        expect(hrefs).toContain("/test13/nft")
    })

    it("shows snapshot block-height stamp", () => {
        setup()
        renderWithProviders(<EcosystemPanel />)
        expect(screen.getByText("#12345")).toBeInTheDocument()
    })
})

describe("EcosystemPanel — null count shows '—' (per-tile isolation)", () => {
    it("tokens null -> that tile shows '—'", () => {
        setup({ tokens: null })
        renderWithProviders(<EcosystemPanel />)
        // The "—" for the null tile should be visible
        const dashes = screen.getAllByText("—")
        expect(dashes.length).toBeGreaterThanOrEqual(1)
    })

    it("tokens null but other counts still render", () => {
        setup({ tokens: null })
        renderWithProviders(<EcosystemPanel />)
        // Agents=2, validators=5, daos=7, collections=4 still visible
        expect(screen.getByText("2")).toBeInTheDocument()
        expect(screen.getByText("5")).toBeInTheDocument()
        expect(screen.getByText("7")).toBeInTheDocument()
        expect(screen.getByText("4")).toBeInTheDocument()
    })

    it("all null — all tiles show '—', panel still renders", () => {
        vi.mocked(countsMod.useEcosystemCounts).mockReturnValue({
            tokens: null, agents: null, validators: null, daos: null, collections: null, loading: false,
        })
        renderWithProviders(<EcosystemPanel />)
        const dashes = screen.getAllByText("—")
        // 5 tiles, each shows "—"
        expect(dashes.length).toBeGreaterThanOrEqual(5)
        expect(screen.getByTestId("ecosystem-panel")).toBeInTheDocument()
    })

    it("collections null -> that tile shows '—' while tokens/agents/validators/daos render", () => {
        setup({ collections: null })
        renderWithProviders(<EcosystemPanel />)
        const dashes = screen.getAllByText("—")
        expect(dashes.length).toBeGreaterThanOrEqual(1)
        expect(screen.getByText("3")).toBeInTheDocument()
    })
})

describe("EcosystemPanel — loading", () => {
    it("shows skeleton cards while loading", () => {
        vi.mocked(countsMod.useEcosystemCounts).mockReturnValue({
            tokens: null, agents: null, validators: null, daos: null, collections: null, loading: true,
        })
        renderWithProviders(<EcosystemPanel />)
        const skeletons = screen.getAllByTestId("action-card-skeleton")
        expect(skeletons.length).toBeGreaterThanOrEqual(1)
    })

    it("does not show count values while loading", () => {
        vi.mocked(countsMod.useEcosystemCounts).mockReturnValue({
            tokens: 3, agents: 2, validators: 5, daos: 7, collections: 4, loading: true,
        })
        renderWithProviders(<EcosystemPanel />)
        expect(screen.queryByText("3")).not.toBeInTheDocument()
    })
})
