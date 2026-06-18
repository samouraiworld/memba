/**
 * DirectoryPanel.test.tsx
 *
 * Per-panel isolation contract:
 *   1. With data   → member count tile + member chips render
 *   2. Members labelled "member" (never "newest" or "recent")
 *   3. CTA link → "Open directory" href points to /:network/directory
 *   4. Loading    → skeleton cards render; no values visible
 *   5. Error/empty → "—" rendered; panel does NOT throw/blank
 */

import { describe, it, expect, vi } from "vitest"
import { screen } from "@testing-library/react"
import { renderWithProviders } from "../../../test/test-utils"
import { DirectoryPanel } from "./DirectoryPanel"

// ── Mocks ─────────────────────────────────────────────────────

vi.mock("../../../hooks/home/useDirectoryHighlights", () => ({
    useDirectoryHighlights: vi.fn(() => ({
        memberCount: 0,
        members: [],
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
const dirMod = await import("../../../hooks/home/useDirectoryHighlights")
const networkMod = await import("../../../hooks/useNetwork")

// ── Fixtures ──────────────────────────────────────────────────

const MOCK_MEMBERS = [
    { name: "alice",   address: "g1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    { name: "bob",     address: "g1bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    { name: "charlie", address: "g1cccccccccccccccccccccccccccccccccccccccc" },
    { name: "dave",    address: "g1dddddddddddddddddddddddddddddddddddddddd" },
]

function setupData(overrides: Partial<ReturnType<typeof dirMod.useDirectoryHighlights>> = {}) {
    vi.mocked(dirMod.useDirectoryHighlights).mockReturnValue({
        memberCount: 42,
        members: MOCK_MEMBERS,
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

// ── Tests ─────────────────────────────────────────────────────

describe("DirectoryPanel — panel container", () => {
    it("renders the directory-panel testid", () => {
        setupData()
        renderWithProviders(<DirectoryPanel />)
        expect(screen.getByTestId("directory-panel")).toBeInTheDocument()
    })

    it("does NOT throw when hook returns empty state", () => {
        vi.mocked(dirMod.useDirectoryHighlights).mockReturnValue({
            memberCount: 0,
            members: [],
            loading: false,
        })
        expect(() => renderWithProviders(<DirectoryPanel />)).not.toThrow()
    })
})

describe("DirectoryPanel — with data", () => {
    it("renders the member count", () => {
        setupData()
        renderWithProviders(<DirectoryPanel />)
        expect(screen.getByText("42")).toBeInTheDocument()
    })

    it("renders member names", () => {
        setupData()
        renderWithProviders(<DirectoryPanel />)
        expect(screen.getByText("alice")).toBeInTheDocument()
        expect(screen.getByText("bob")).toBeInTheDocument()
        expect(screen.getByText("charlie")).toBeInTheDocument()
        expect(screen.getByText("dave")).toBeInTheDocument()
    })

    it("renders truncated addresses as meta", () => {
        setupData()
        renderWithProviders(<DirectoryPanel />)
        // g1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa -> g1aaaaaaaa…aaaaaa (10 chars + ellipsis + 6)
        expect(screen.getByText("g1aaaaaaaa…aaaaaa")).toBeInTheDocument()
    })

    it("renders 'Open directory' CTA link to /:network/directory", () => {
        setupData()
        renderWithProviders(<DirectoryPanel />)
        const links = screen.getAllByRole("link")
        const dirLink = links.find(l => l.getAttribute("href") === "/test13/directory")
        expect(dirLink).toBeDefined()
    })

    it("'members' eyebrow label is present", () => {
        setupData()
        renderWithProviders(<DirectoryPanel />)
        // The count tile has eyebrow "members"
        expect(screen.getByText("members")).toBeInTheDocument()
    })
})

describe("DirectoryPanel — honesty: no 'newest' or 'recent' wording", () => {
    it("does NOT contain the word 'newest' anywhere", () => {
        setupData()
        renderWithProviders(<DirectoryPanel />)
        // Should not have "newest" anywhere in the panel
        expect(screen.queryByText(/newest/i)).not.toBeInTheDocument()
    })

    it("does NOT contain the word 'recent' anywhere", () => {
        setupData()
        renderWithProviders(<DirectoryPanel />)
        expect(screen.queryByText(/recent/i)).not.toBeInTheDocument()
    })
})

describe("DirectoryPanel — loading state", () => {
    it("renders skeleton cards while loading", () => {
        vi.mocked(dirMod.useDirectoryHighlights).mockReturnValue({
            memberCount: 0,
            members: [],
            loading: true,
        })
        renderWithProviders(<DirectoryPanel />)
        const skeletons = screen.getAllByTestId("action-card-skeleton")
        expect(skeletons.length).toBeGreaterThanOrEqual(1)
    })

    it("does not show count values while loading", () => {
        vi.mocked(dirMod.useDirectoryHighlights).mockReturnValue({
            memberCount: 42,
            members: MOCK_MEMBERS,
            loading: true,
        })
        renderWithProviders(<DirectoryPanel />)
        expect(screen.queryByText("42")).not.toBeInTheDocument()
        expect(screen.queryByText("alice")).not.toBeInTheDocument()
    })
})

describe("DirectoryPanel — error / empty state", () => {
    it("degrades to '—' when memberCount is 0", () => {
        vi.mocked(dirMod.useDirectoryHighlights).mockReturnValue({
            memberCount: 0,
            members: [],
            loading: false,
        })
        renderWithProviders(<DirectoryPanel />)
        const dashes = screen.getAllByText("—")
        expect(dashes.length).toBeGreaterThanOrEqual(1)
    })

    it("still renders the panel testid on error", () => {
        vi.mocked(dirMod.useDirectoryHighlights).mockReturnValue({
            memberCount: 0,
            members: [],
            loading: false,
        })
        renderWithProviders(<DirectoryPanel />)
        expect(screen.getByTestId("directory-panel")).toBeInTheDocument()
    })

    it("Open directory link still present on error state", () => {
        vi.mocked(dirMod.useDirectoryHighlights).mockReturnValue({
            memberCount: 0,
            members: [],
            loading: false,
        })
        vi.mocked(networkMod.useNetwork).mockReturnValue({
            networkKey: "test13",
            rpcUrl: "https://rpc.test13.gno.land",
            chainId: "test-13",
            label: "Testnet 13",
            switchNetwork: vi.fn(),
            networks: {},
        })
        renderWithProviders(<DirectoryPanel />)
        const links = screen.getAllByRole("link")
        const dirLink = links.find(l => l.getAttribute("href") === "/test13/directory")
        expect(dirLink).toBeDefined()
    })

    it("renders the panel structure even when both sources fail", () => {
        vi.mocked(dirMod.useDirectoryHighlights).mockReturnValue({
            memberCount: 0,
            members: [],
            loading: false,
        })
        const { container } = renderWithProviders(<DirectoryPanel />)
        expect(container.firstChild).not.toBeNull()
    })
})
