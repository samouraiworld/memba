/**
 * showcaseDoors.test.tsx
 *
 * TDD coverage for Task 1.2b:
 *   - FeaturedDoor: onRetry now calls useFeaturedDao's real refetch
 *   - ContributorsDoor: top-3 contributors from useGnoloveHighlights
 *   - NetworkHealthDoor: active/total + status from useValidatorHealth
 *   - DirectoryDoor: member count + search affordance from useDirectoryHighlights
 *   - LaunchpadDoor: static promo, no data fetch
 *   - ShowcaseBoard: all 5 slots render in order
 *
 * Each door: ready (real values + correct link href), empty → invitation or
 * omitted-metric (never "0"/"—"), error → Door error path.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { screen, fireEvent } from "@testing-library/react"
import { renderWithProviders } from "../../../test/test-utils"
import { FeaturedDoor } from "./FeaturedDoor"
import { ContributorsDoor } from "./ContributorsDoor"
import { NetworkHealthDoor } from "./NetworkHealthDoor"
import { DirectoryDoor } from "./DirectoryDoor"
import { LaunchpadDoor } from "./LaunchpadDoor"
import { ShowcaseBoard } from "../ShowcaseBoard"
import type { FeaturedDaoResult } from "../../../hooks/home/useFeaturedDao"
import type { GnoloveHighlights } from "../../../hooks/home/useGnoloveHighlights"
import type { ValidatorHealth } from "../../../hooks/home/useValidatorHealth"
import type { DirectoryHighlights } from "../../../hooks/home/useDirectoryHighlights"

// ── Mock hooks ─────────────────────────────────────────────────────────────

const mockUseFeaturedDao = vi.fn<(networkKey: string) => FeaturedDaoResult>()
vi.mock("../../../hooks/home/useFeaturedDao", () => ({
    useFeaturedDao: (networkKey: string) => mockUseFeaturedDao(networkKey),
}))

const mockUseGnoloveHighlights = vi.fn<() => GnoloveHighlights>()
vi.mock("../../../hooks/home/useGnoloveHighlights", () => ({
    useGnoloveHighlights: () => mockUseGnoloveHighlights(),
}))

const mockUseValidatorHealth = vi.fn<() => ValidatorHealth>()
vi.mock("../../../hooks/home/useValidatorHealth", () => ({
    useValidatorHealth: () => mockUseValidatorHealth(),
}))

const mockUseDirectoryHighlights = vi.fn<() => DirectoryHighlights>()
vi.mock("../../../hooks/home/useDirectoryHighlights", () => ({
    useDirectoryHighlights: () => mockUseDirectoryHighlights(),
}))

// useNetwork — used by NetworkHealthDoor and DirectoryDoor
vi.mock("../../../hooks/useNetwork", () => ({
    useNetwork: () => ({ networkKey: "test13", rpcUrl: "https://rpc.test13.gno.land" }),
}))

// ── IntersectionObserver stub for ShowcaseBoard lazy-mount ─────────────────
class IoStub {
    private callback: IntersectionObserverCallback
    constructor(callback: IntersectionObserverCallback) { this.callback = callback }
    observe(el: Element) {
        this.callback(
            [{ isIntersecting: true, target: el } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
        )
    }
    disconnect() {}
    unobserve() {}
    takeRecords() { return [] }
}

beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", IoStub)
    mockUseFeaturedDao.mockReset()
    mockUseGnoloveHighlights.mockReset()
    mockUseValidatorHealth.mockReset()
    mockUseDirectoryHighlights.mockReset()
})

afterEach(() => {
    vi.unstubAllGlobals()
})

// ══════════════════════════════════════════════════════════════════════════
// FeaturedDoor — real refetch wiring
// ══════════════════════════════════════════════════════════════════════════

describe("FeaturedDoor — real refetch on retry", () => {
    it("calls refetch from useFeaturedDao when the retry button is clicked", () => {
        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
        const refetchSpy = vi.fn()

        mockUseFeaturedDao.mockReturnValue({
            state: "error",
            invitationHref: "/test13/dao",
            refetch: refetchSpy,
        })

        renderWithProviders(<FeaturedDoor networkKey="test13" />)

        const retryBtn = screen.getByRole("button", { name: /retry/i })
        fireEvent.click(retryBtn)

        expect(refetchSpy).toHaveBeenCalledOnce()
        consoleSpy.mockRestore()
    })
})

// ══════════════════════════════════════════════════════════════════════════
// ContributorsDoor
// ══════════════════════════════════════════════════════════════════════════

describe("ContributorsDoor — ready", () => {
    beforeEach(() => {
        mockUseGnoloveHighlights.mockReturnValue({
            top: [
                { login: "alice", score: 980 },
                { login: "bob", score: 720 },
                { login: "carol", score: 560 },
            ],
            contributorCount: 42,
            loading: false,
        })
    })

    it("renders each top-3 contributor name", () => {
        renderWithProviders(<ContributorsDoor networkKey="test13" />)
        expect(screen.getByText("alice")).toBeInTheDocument()
        expect(screen.getByText("bob")).toBeInTheDocument()
        expect(screen.getByText("carol")).toBeInTheDocument()
    })

    it("renders the link to gnolove", () => {
        renderWithProviders(<ContributorsDoor networkKey="test13" />)
        const links = screen.getAllByRole("link")
        const gnoloveLink = links.find(l => l.getAttribute("href") === "/test13/gnolove")
        expect(gnoloveLink).toBeDefined()
    })

    it("renders scores without fabricating zeros", () => {
        renderWithProviders(<ContributorsDoor networkKey="test13" />)
        // Scores should be visible
        expect(screen.getByText(/980/)).toBeInTheDocument()
        // No bare "0" / "—" placeholders
        expect(screen.queryByText("0")).not.toBeInTheDocument()
        expect(screen.queryByText("—")).not.toBeInTheDocument()
    })
})

describe("ContributorsDoor — loading", () => {
    it("renders loading state (skeleton) while data loads", () => {
        mockUseGnoloveHighlights.mockReturnValue({ top: [], contributorCount: 0, loading: true })
        const { container } = renderWithProviders(<ContributorsDoor networkKey="test13" />)
        // Door loading skeleton bars
        expect(container.querySelectorAll(".door__sk").length).toBeGreaterThan(0)
    })
})

describe("ContributorsDoor — empty (no contributors yet)", () => {
    it("shows an invitation to gnolove, never a bare '0'", () => {
        mockUseGnoloveHighlights.mockReturnValue({ top: [], contributorCount: 0, loading: false })
        renderWithProviders(<ContributorsDoor networkKey="test13" />)
        // invitation link to gnolove
        const link = screen.getByRole("link", { name: /open gnolove/i })
        expect(link).toHaveAttribute("href", "/test13/gnolove")
        expect(screen.queryByText("0")).not.toBeInTheDocument()
        expect(screen.queryByText("—")).not.toBeInTheDocument()
    })
})

// ══════════════════════════════════════════════════════════════════════════
// NetworkHealthDoor
// ══════════════════════════════════════════════════════════════════════════

describe("NetworkHealthDoor — ready", () => {
    beforeEach(() => {
        mockUseValidatorHealth.mockReturnValue({
            status: "healthy",
            active: 14,
            total: 14,
            avgUptime: null,
            latestIncident: null,
            loading: false,
        })
    })

    it("renders active / total validator count", () => {
        renderWithProviders(<NetworkHealthDoor networkKey="test13" />)
        expect(screen.getByText(/14 \/ 14/)).toBeInTheDocument()
    })

    it("renders a link to validators page", () => {
        renderWithProviders(<NetworkHealthDoor networkKey="test13" />)
        const links = screen.getAllByRole("link")
        const validatorsLink = links.find(l => l.getAttribute("href") === "/test13/validators")
        expect(validatorsLink).toBeDefined()
    })

    it("renders 'Healthy' status", () => {
        renderWithProviders(<NetworkHealthDoor networkKey="test13" />)
        expect(screen.getByText(/healthy/i)).toBeInTheDocument()
    })

    it("omits avg block time when not present (no '—' or '0')", () => {
        mockUseValidatorHealth.mockReturnValue({
            status: "healthy",
            active: 14,
            total: 14,
            avgUptime: null,
            latestIncident: null,
            loading: false,
        })
        renderWithProviders(<NetworkHealthDoor networkKey="test13" />)
        expect(screen.queryByText("—")).not.toBeInTheDocument()
        expect(screen.queryByText("0")).not.toBeInTheDocument()
    })
})

describe("NetworkHealthDoor — loading", () => {
    it("renders loading skeleton", () => {
        mockUseValidatorHealth.mockReturnValue({
            status: "unknown", active: 0, total: 0, avgUptime: null, latestIncident: null, loading: true,
        })
        const { container } = renderWithProviders(<NetworkHealthDoor networkKey="test13" />)
        expect(container.querySelectorAll(".door__sk").length).toBeGreaterThan(0)
    })
})

describe("NetworkHealthDoor — error (no data, total=0)", () => {
    it("never renders a bare '0' or '—' when total=0", () => {
        mockUseValidatorHealth.mockReturnValue({
            status: "unknown", active: 0, total: 0, avgUptime: null, latestIncident: null, loading: false,
        })
        renderWithProviders(<NetworkHealthDoor networkKey="test13" />)
        // Should show invitation when unknown / no data
        expect(screen.queryByText("0 / 0")).not.toBeInTheDocument()
        expect(screen.queryByText("—")).not.toBeInTheDocument()
    })
})

// ══════════════════════════════════════════════════════════════════════════
// DirectoryDoor
// ══════════════════════════════════════════════════════════════════════════

describe("DirectoryDoor — ready with count", () => {
    beforeEach(() => {
        mockUseDirectoryHighlights.mockReturnValue({
            memberCount: 158,
            members: [
                { name: "alice", address: "g1alice" },
                { name: "bob", address: "g1bob" },
            ],
            loading: false,
        })
    })

    it("renders the member count", () => {
        renderWithProviders(<DirectoryDoor networkKey="test13" />)
        expect(screen.getByText(/158/)).toBeInTheDocument()
    })

    it("renders the search affordance link to directory", () => {
        renderWithProviders(<DirectoryDoor networkKey="test13" />)
        const links = screen.getAllByRole("link")
        const dirLink = links.find(l => l.getAttribute("href") === "/test13/directory")
        expect(dirLink).toBeDefined()
    })

    it("never fabricates a '0' or '—' when count is present", () => {
        renderWithProviders(<DirectoryDoor networkKey="test13" />)
        expect(screen.queryByText("0")).not.toBeInTheDocument()
        expect(screen.queryByText("—")).not.toBeInTheDocument()
    })
})

describe("DirectoryDoor — ready with count=0 (absent)", () => {
    it("omits the count but still shows the search affordance + link", () => {
        mockUseDirectoryHighlights.mockReturnValue({ memberCount: 0, members: [], loading: false })
        renderWithProviders(<DirectoryDoor networkKey="test13" />)
        // No bare "0"
        expect(screen.queryByText("0")).not.toBeInTheDocument()
        expect(screen.queryByText("—")).not.toBeInTheDocument()
        // Still shows "Open directory" link
        const links = screen.getAllByRole("link")
        const dirLink = links.find(l => l.getAttribute("href") === "/test13/directory")
        expect(dirLink).toBeDefined()
    })
})

describe("DirectoryDoor — loading", () => {
    it("renders loading skeleton", () => {
        mockUseDirectoryHighlights.mockReturnValue({ memberCount: 0, members: [], loading: true })
        const { container } = renderWithProviders(<DirectoryDoor networkKey="test13" />)
        expect(container.querySelectorAll(".door__sk").length).toBeGreaterThan(0)
    })
})

// ══════════════════════════════════════════════════════════════════════════
// LaunchpadDoor
// ══════════════════════════════════════════════════════════════════════════

describe("LaunchpadDoor — static promo", () => {
    it("renders a link to the token factory", () => {
        renderWithProviders(<LaunchpadDoor networkKey="test13" />)
        const link = screen.getByRole("link")
        expect(link).toHaveAttribute("href", "/test13/tokens")
    })

    it("renders promo headline text", () => {
        renderWithProviders(<LaunchpadDoor networkKey="test13" />)
        expect(screen.getByText(/launch a token in minutes/i)).toBeInTheDocument()
    })

    it("never renders a fabricated '0' or '—'", () => {
        renderWithProviders(<LaunchpadDoor networkKey="test13" />)
        expect(screen.queryByText("0")).not.toBeInTheDocument()
        expect(screen.queryByText("—")).not.toBeInTheDocument()
    })
})

// ══════════════════════════════════════════════════════════════════════════
// ShowcaseBoard — all 5 slots in order
// ══════════════════════════════════════════════════════════════════════════

describe("ShowcaseBoard — all 5 slots in order", () => {
    beforeEach(() => {
        mockUseFeaturedDao.mockReturnValue({
            state: "ready",
            dao: { name: "Memba DAO", members: 42, href: "/test13/dao/r/memba" },
            invitationHref: "/test13/dao",
            refetch: vi.fn(),
        })
        mockUseGnoloveHighlights.mockReturnValue({
            top: [{ login: "alice", score: 500 }],
            contributorCount: 10,
            loading: false,
        })
        mockUseValidatorHealth.mockReturnValue({
            status: "healthy", active: 14, total: 14, avgUptime: null, latestIncident: null, loading: false,
        })
        mockUseDirectoryHighlights.mockReturnValue({
            memberCount: 50, members: [], loading: false,
        })
    })

    it("renders the board container with all 5 slots", () => {
        renderWithProviders(<ShowcaseBoard networkKey="test13" />)
        expect(screen.getByTestId("showcase-slot-featured")).toBeInTheDocument()
        expect(screen.getByTestId("showcase-slot-contributors")).toBeInTheDocument()
        expect(screen.getByTestId("showcase-slot-network-health")).toBeInTheDocument()
        expect(screen.getByTestId("showcase-slot-directory")).toBeInTheDocument()
        expect(screen.getByTestId("showcase-slot-launchpad")).toBeInTheDocument()
    })

    it("featured slot is the FIRST child of the board container", () => {
        renderWithProviders(<ShowcaseBoard networkKey="test13" />)
        const board = screen.getByTestId("showcase-board")
        const featuredSlot = screen.getByTestId("showcase-slot-featured")
        expect(board.firstElementChild).toBe(featuredSlot)
    })

    it("slots appear in DOM order: featured → contributors → network-health → directory → launchpad", () => {
        renderWithProviders(<ShowcaseBoard networkKey="test13" />)
        const board = screen.getByTestId("showcase-board")
        const slotIds = Array.from(board.children).map(
            (el) => el.getAttribute("data-slot"),
        )
        expect(slotIds).toEqual([
            "featured",
            "contributors",
            "network-health",
            "directory",
            "launchpad",
        ])
    })
})
