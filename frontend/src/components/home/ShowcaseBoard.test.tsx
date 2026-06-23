/**
 * ShowcaseBoard.test.tsx
 *
 * Visitor "board of doors" shell contract (Task 1.2a):
 *   1. Featured-first: slot 0 is the FeaturedDoor, full-width, and the first
 *      child of the board container.
 *   2. Error isolation: when a slot's content throws, the reused PanelBoundary
 *      renders its neutral fallback + retry AND the board container still
 *      renders (a single failure never blanks the whole board).
 *   3. Empty → invitation: when the featured DAO resolves to "empty", an
 *      invitation link to invitationHref is rendered (never "0"/"—").
 *
 * The board reuses StateBoard's PanelBoundary + useInViewport lazy-mount; the
 * FeaturedDoor is driven by useFeaturedDao, which we mock here so the board
 * shell is tested in isolation from on-chain/snapshot fetching.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import { screen } from "@testing-library/react"
import { renderWithProviders } from "../../test/test-utils"
import { ShowcaseBoard } from "./ShowcaseBoard"
import type { FeaturedDaoResult } from "../../hooks/home/useFeaturedDao"

// ── Mock useFeaturedDao — the only data source the board renders eagerly ──
const mockUseFeaturedDao = vi.fn<(networkKey: string) => FeaturedDaoResult>()
vi.mock("../../hooks/home/useFeaturedDao", () => ({
    useFeaturedDao: (networkKey: string) => mockUseFeaturedDao(networkKey),
}))

// ── Stub IntersectionObserver for jsdom (mirror StateBoard.test) ─────────
// Fires isIntersecting=true immediately so any lazy slots mount synchronously.
class IoStub {
    private callback: IntersectionObserverCallback
    constructor(callback: IntersectionObserverCallback) {
        this.callback = callback
    }
    observe(el: Element) {
        this.callback(
            [{ isIntersecting: true, target: el } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
        )
    }
    disconnect() {}
    unobserve() {}
    takeRecords() {
        return []
    }
}

beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", IoStub)
    mockUseFeaturedDao.mockReset()
})

afterEach(() => {
    vi.unstubAllGlobals()
})

describe("ShowcaseBoard — featured-first", () => {
    it("renders the board container", () => {
        mockUseFeaturedDao.mockReturnValue({
            state: "ready",
            dao: { name: "Memba DAO", members: 42, href: "/test13/dao/r/memba" },
            invitationHref: "/test13/dao",
            refetch: vi.fn(),
        })
        renderWithProviders(<ShowcaseBoard networkKey="test13" />)
        expect(screen.getByTestId("showcase-board")).toBeInTheDocument()
    })

    it("renders the featured door as the FIRST child of the board, full-width", () => {
        mockUseFeaturedDao.mockReturnValue({
            state: "ready",
            dao: { name: "Memba DAO", members: 42, href: "/test13/dao/r/memba" },
            invitationHref: "/test13/dao",
            refetch: vi.fn(),
        })
        renderWithProviders(<ShowcaseBoard networkKey="test13" />)

        const board = screen.getByTestId("showcase-board")
        const featuredSlot = screen.getByTestId("showcase-slot-featured")
        // Featured slot is the first child of the board container.
        expect(board.firstElementChild).toBe(featuredSlot)
        // Marked as the featured (full-width) slot.
        expect(featuredSlot).toHaveAttribute("data-slot", "featured")
        // The DAO name renders inside it.
        expect(featuredSlot).toHaveTextContent("Memba DAO")
    })

    it("renders members only when present and never a 0 placeholder", () => {
        mockUseFeaturedDao.mockReturnValue({
            state: "ready",
            dao: { name: "NoMembers DAO", href: "/test13/dao/r/x" },
            invitationHref: "/test13/dao",
            refetch: vi.fn(),
        })
        renderWithProviders(<ShowcaseBoard networkKey="test13" />)
        expect(screen.getByText("NoMembers DAO")).toBeInTheDocument()
        // No fabricated 0 / — when members is undefined.
        expect(screen.queryByText("0")).not.toBeInTheDocument()
        expect(screen.queryByText("—")).not.toBeInTheDocument()
    })
})

describe("ShowcaseBoard — error isolation", () => {
    it("a throwing featured slot shows the PanelBoundary fallback AND the board still renders", () => {
        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

        // Drive the FeaturedDoor to throw during render.
        mockUseFeaturedDao.mockImplementation(() => {
            throw new Error("featured door exploded")
        })

        renderWithProviders(<ShowcaseBoard networkKey="test13" />)

        // Board container is NOT blanked — it still renders.
        expect(screen.getByTestId("showcase-board")).toBeInTheDocument()
        // The reused PanelBoundary fallback + retry control are present.
        expect(screen.getByTestId("panel-boundary-fallback")).toBeInTheDocument()
        expect(screen.getByTestId("panel-boundary-retry")).toBeInTheDocument()

        consoleSpy.mockRestore()
        warnSpy.mockRestore()
    })
})

describe("ShowcaseBoard — empty → invitation", () => {
    it("featured empty state renders an invitation link to invitationHref (never 0/—)", () => {
        mockUseFeaturedDao.mockReturnValue({
            state: "empty",
            invitationHref: "/test13/dao",
            refetch: vi.fn(),
        })
        renderWithProviders(<ShowcaseBoard networkKey="test13" />)

        const link = screen.getByRole("link", { name: /explore daos/i })
        expect(link).toHaveAttribute("href", "/test13/dao")
        // Honesty: no zero/dash placeholders.
        expect(screen.queryByText("0")).not.toBeInTheDocument()
        expect(screen.queryByText("—")).not.toBeInTheDocument()
    })
})
