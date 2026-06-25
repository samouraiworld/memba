/**
 * ShowcaseBoard.test.tsx
 *
 * Visitor "board of doors" shell contract:
 *   1. GovDAO-first: slot 0 is the gold GovDaoSpotlight, full-width, first child.
 *   2. MembaDAO is demoted to a bonus credit line below the board (no longer a hero).
 *   3. Error isolation: a throwing slot shows the reused PanelBoundary fallback +
 *      retry AND the board container still renders.
 *
 * GovDaoSpotlight is driven by useGovDao, mocked here so the shell is tested in
 * isolation from on-chain fetching. (GovDaoSpotlight's own honesty/empty/error
 * behavior is covered in GovDaoSpotlight.test.tsx.)
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import { screen } from "@testing-library/react"
import { renderWithProviders } from "../../test/test-utils"
import { ShowcaseBoard } from "./ShowcaseBoard"
import type { GovDaoResult } from "../../hooks/home/useGovDao"

// ── Mock useGovDao — drives the eager, full-width spotlight slot ──────────
const mockUseGovDao = vi.fn<(networkKey: string) => GovDaoResult>()
vi.mock("../../hooks/home/useGovDao", () => ({
    useGovDao: (networkKey: string) => mockUseGovDao(networkKey),
    GOVDAO_REALM_PATH: "gno.land/r/gov/dao",
}))

// ── Stub IntersectionObserver for jsdom (mirror StateBoard.test) ─────────
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

const READY: GovDaoResult = {
    state: "ready",
    name: "GovDAO",
    openCount: 3,
    members: 61,
    href: "/test13/dao/gno.land/r/gov/dao",
    refetch: vi.fn(),
}

beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", IoStub)
    mockUseGovDao.mockReset()
    mockUseGovDao.mockReturnValue(READY)
})

afterEach(() => {
    vi.unstubAllGlobals()
})

describe("ShowcaseBoard — GovDAO-first", () => {
    it("renders the board container", () => {
        renderWithProviders(<ShowcaseBoard networkKey="test13" />)
        expect(screen.getByTestId("showcase-board")).toBeInTheDocument()
    })

    it("renders the GovDAO spotlight as the FIRST, full-width slot", () => {
        renderWithProviders(<ShowcaseBoard networkKey="test13" />)
        const board = screen.getByTestId("showcase-board")
        const govSlot = screen.getByTestId("showcase-slot-govdao")
        expect(board.firstElementChild).toBe(govSlot)
        expect(govSlot).toHaveAttribute("data-slot", "govdao")
        expect(govSlot.className).toContain("showcase-board__slot--full")
        expect(govSlot).toHaveTextContent("GovDAO")
    })
})

describe("ShowcaseBoard — MembaDAO demoted to a credit", () => {
    it("renders a MembaDAO credit line (not a hero) linking to the memba_dao page", () => {
        renderWithProviders(<ShowcaseBoard networkKey="test13" />)
        const credit = screen.getByTestId("showcase-board-credit")
        expect(credit).toHaveTextContent(/built on memba/i)
        const link = screen.getByRole("link", { name: /membadao/i })
        expect(link.getAttribute("href")).toContain("memba_dao")
    })
})

describe("ShowcaseBoard — error isolation", () => {
    it("a throwing slot shows the PanelBoundary fallback AND the board still renders", () => {
        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

        // Drive the GovDAO spotlight to throw during render.
        mockUseGovDao.mockImplementation(() => {
            throw new Error("govdao spotlight exploded")
        })

        renderWithProviders(<ShowcaseBoard networkKey="test13" />)

        expect(screen.getByTestId("showcase-board")).toBeInTheDocument()
        expect(screen.getByTestId("panel-boundary-fallback")).toBeInTheDocument()
        expect(screen.getByTestId("panel-boundary-retry")).toBeInTheDocument()

        consoleSpy.mockRestore()
        warnSpy.mockRestore()
    })
})
