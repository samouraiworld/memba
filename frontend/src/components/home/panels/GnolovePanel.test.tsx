/**
 * GnolovePanel.test.tsx
 *
 * Per-panel isolation contract:
 *   1. With data   → top-3 logins + scores render; "N contributors" footer present
 *   2. CTA link    → "Open Gnolove" href points to /:network/gnolove
 *   3. Loading     → skeleton cards render; no values visible
 *   4. Error/empty → "—" rendered; panel does NOT throw/blank
 */

import { describe, it, expect, vi } from "vitest"
import { screen } from "@testing-library/react"
import { renderWithProviders } from "../../../test/test-utils"
import { GnolovePanel } from "./GnolovePanel"

// ── Mocks ──────────────────────────────────────────────────────

vi.mock("../../../hooks/home/useGnoloveHighlights", () => ({
    useGnoloveHighlights: vi.fn(() => ({
        top: [],
        contributorCount: 0,
        loading: false,
    })),
}))

vi.mock("../../../hooks/useNetwork", () => ({
    useNetwork: vi.fn(() => ({
        networkKey: "test13",
        rpcUrl: "https://rpc.test13.gno.land",
        chainId: "test-13",
        label: "Testnet 13",
        switchNetwork: vi.fn(),
        networks: {},
    })),
}))

// Resolve mocked modules for per-test control
const highlightsMod = await import("../../../hooks/home/useGnoloveHighlights")
const networkMod = await import("../../../hooks/useNetwork")

// ── Fixture ────────────────────────────────────────────────────

const TOP_3 = [
    { login: "charlie", score: 300 },
    { login: "bob",     score: 250 },
    { login: "eve",     score: 175 },
]

function setupData(overrides: Partial<Parameters<typeof vi.mocked<typeof highlightsMod.useGnoloveHighlights>>[0]> = {}) {
    vi.mocked(highlightsMod.useGnoloveHighlights).mockReturnValue({
        top: TOP_3,
        contributorCount: 5,
        loading: false,
        ...overrides,
    })
    vi.mocked(networkMod.useNetwork).mockReturnValue({
        networkKey: "test13",
        rpcUrl: "https://rpc.test13.gno.land",
        chainId: "test-13",
        label: "Testnet 13",
        switchNetwork: vi.fn(),
        networks: {},
    })
}

// ── Tests ──────────────────────────────────────────────────────

describe("GnolovePanel — panel container", () => {
    it("renders the gnolove-panel testid", () => {
        setupData()
        renderWithProviders(<GnolovePanel />)
        expect(screen.getByTestId("gnolove-panel")).toBeInTheDocument()
    })

    it("does NOT throw when hook returns empty top", () => {
        vi.mocked(highlightsMod.useGnoloveHighlights).mockReturnValue({
            top: [],
            contributorCount: 0,
            loading: false,
        })
        expect(() => renderWithProviders(<GnolovePanel />)).not.toThrow()
    })
})

describe("GnolovePanel — with data", () => {
    it("renders all 3 contributor logins", () => {
        setupData()
        renderWithProviders(<GnolovePanel />)
        expect(screen.getByText("charlie")).toBeInTheDocument()
        expect(screen.getByText("bob")).toBeInTheDocument()
        expect(screen.getByText("eve")).toBeInTheDocument()
    })

    it("renders scores for each contributor", () => {
        setupData()
        renderWithProviders(<GnolovePanel />)
        expect(screen.getByText(/300/)).toBeInTheDocument()
        expect(screen.getByText(/250/)).toBeInTheDocument()
        expect(screen.getByText(/175/)).toBeInTheDocument()
    })

    it("renders '5 contributors' footer", () => {
        setupData()
        renderWithProviders(<GnolovePanel />)
        expect(screen.getByText("5 contributors")).toBeInTheDocument()
    })

    it("renders 'Open Gnolove' CTA link to /test13/gnolove", () => {
        setupData()
        renderWithProviders(<GnolovePanel />)
        const links = screen.getAllByRole("link")
        const gnoloveLink = links.find(l => l.getAttribute("href") === "/test13/gnolove")
        expect(gnoloveLink).toBeDefined()
    })
})

describe("GnolovePanel — loading state", () => {
    it("renders skeleton cards while loading", () => {
        vi.mocked(highlightsMod.useGnoloveHighlights).mockReturnValue({
            top: [],
            contributorCount: 0,
            loading: true,
        })
        renderWithProviders(<GnolovePanel />)
        const skeletons = screen.getAllByTestId("action-card-skeleton")
        expect(skeletons.length).toBeGreaterThanOrEqual(1)
    })

    it("does not show contributor logins while loading", () => {
        vi.mocked(highlightsMod.useGnoloveHighlights).mockReturnValue({
            top: TOP_3,
            contributorCount: 5,
            loading: true,
        })
        renderWithProviders(<GnolovePanel />)
        expect(screen.queryByText("charlie")).not.toBeInTheDocument()
        expect(screen.queryByText("bob")).not.toBeInTheDocument()
    })
})

describe("GnolovePanel — error / empty state", () => {
    it("degrades to '—' rows when top is empty", () => {
        vi.mocked(highlightsMod.useGnoloveHighlights).mockReturnValue({
            top: [],
            contributorCount: 0,
            loading: false,
        })
        renderWithProviders(<GnolovePanel />)
        const dashes = screen.getAllByText("—")
        expect(dashes.length).toBeGreaterThanOrEqual(1)
    })

    it("still renders the panel testid on error", () => {
        vi.mocked(highlightsMod.useGnoloveHighlights).mockReturnValue({
            top: [],
            contributorCount: 0,
            loading: false,
        })
        renderWithProviders(<GnolovePanel />)
        expect(screen.getByTestId("gnolove-panel")).toBeInTheDocument()
    })

    it("Open Gnolove link still present on error state", () => {
        vi.mocked(highlightsMod.useGnoloveHighlights).mockReturnValue({
            top: [],
            contributorCount: 0,
            loading: false,
        })
        renderWithProviders(<GnolovePanel />)
        const links = screen.getAllByRole("link")
        const gnoloveLink = links.find(l => l.getAttribute("href") === "/test13/gnolove")
        expect(gnoloveLink).toBeDefined()
    })
})
