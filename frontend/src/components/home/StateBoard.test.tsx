/**
 * StateBoard.test.tsx
 *
 * Panel architecture contract:
 *   1. Grid renders children
 *   2. A child that throws → PanelBoundary shows fallback; siblings still render (isolation)
 *   3. Eager panels mount immediately; lazy panels mount after IO fires (or immediately in jsdom)
 */

import { describe, it, expect, vi, afterEach } from "vitest"
import { screen } from "@testing-library/react"
import { renderWithProviders } from "../../test/test-utils"
import { StateBoard, PanelBoundary } from "./StateBoard"

// ── Stub IntersectionObserver for jsdom ──────────────────────────────────
//
// jsdom has no real IO. We provide a class-based stub that immediately
// fires isIntersecting=true so lazy panels mount synchronously in tests.

let capturedObserveEl: Element | null = null

class IoStub {
    private callback: IntersectionObserverCallback
    constructor(callback: IntersectionObserverCallback) {
        this.callback = callback
    }
    observe(el: Element) {
        capturedObserveEl = el
        // Fire immediately so lazy panels mount during the test
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
    capturedObserveEl = null
    vi.stubGlobal("IntersectionObserver", IoStub)
})

afterEach(() => {
    vi.unstubAllGlobals()
})

// ── Helper panels ────────────────────────────────────────────────────────

function GoodPanel({ label }: { label: string }) {
    return <div data-testid={`good-panel-${label}`}>{label}</div>
}

function BadPanel() {
    throw new Error("panel exploded")
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("StateBoard — layout", () => {
    it("renders the state-board grid container", () => {
        renderWithProviders(
            <StateBoard>
                <GoodPanel label="a" />
            </StateBoard>,
        )
        expect(screen.getByTestId("state-board")).toBeInTheDocument()
    })

    it("renders a single child panel", () => {
        renderWithProviders(
            <StateBoard>
                <GoodPanel label="alpha" />
            </StateBoard>,
        )
        expect(screen.getByTestId("good-panel-alpha")).toBeInTheDocument()
        expect(screen.getByText("alpha")).toBeInTheDocument()
    })

    it("renders multiple children", () => {
        renderWithProviders(
            <StateBoard>
                <GoodPanel label="one" />
                <GoodPanel label="two" />
                <GoodPanel label="three" />
            </StateBoard>,
        )
        expect(screen.getByText("one")).toBeInTheDocument()
        expect(screen.getByText("two")).toBeInTheDocument()
        expect(screen.getByText("three")).toBeInTheDocument()
    })
})

describe("StateBoard — error isolation", () => {
    it("shows PanelBoundary fallback when a child throws", () => {
        // Suppress React's error output during this test
        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

        renderWithProviders(
            <StateBoard>
                <BadPanel />
            </StateBoard>,
        )

        // The fallback action card must be in the DOM
        expect(screen.getByText("couldn't load")).toBeInTheDocument()

        consoleSpy.mockRestore()
        warnSpy.mockRestore()
    })

    it("sibling panels still render when one panel throws", () => {
        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

        renderWithProviders(
            <StateBoard>
                <GoodPanel label="before" />
                <BadPanel />
                <GoodPanel label="after" />
            </StateBoard>,
        )

        // Failing panel shows fallback
        expect(screen.getByText("couldn't load")).toBeInTheDocument()

        // Siblings are still rendered — board is NOT blanked
        expect(screen.getByText("before")).toBeInTheDocument()
        expect(screen.getByText("after")).toBeInTheDocument()

        consoleSpy.mockRestore()
        warnSpy.mockRestore()
    })

    it("multiple throwing panels each get their own fallback", () => {
        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

        renderWithProviders(
            <StateBoard>
                <BadPanel />
                <GoodPanel label="middle" />
                <BadPanel />
            </StateBoard>,
        )

        // Two independent fallbacks
        const fallbacks = screen.getAllByText("couldn't load")
        expect(fallbacks).toHaveLength(2)

        // The healthy panel still renders
        expect(screen.getByText("middle")).toBeInTheDocument()

        consoleSpy.mockRestore()
        warnSpy.mockRestore()
    })
})

describe("StateBoard — eager mounting", () => {
    it("first child is eager by default (eagerIndices=[0]) and mounts immediately", () => {
        // With jsdom IO stub firing synchronously, both eager and lazy mount.
        // This test verifies the structural outcome: panel is present.
        renderWithProviders(
            <StateBoard>
                <GoodPanel label="eager-first" />
            </StateBoard>,
        )
        expect(screen.getByText("eager-first")).toBeInTheDocument()
    })

    it("non-eager children also mount (IO stub fires immediately in jsdom)", () => {
        renderWithProviders(
            <StateBoard eagerIndices={[0]}>
                <GoodPanel label="first" />
                <GoodPanel label="lazy" />
            </StateBoard>,
        )
        expect(screen.getByText("first")).toBeInTheDocument()
        expect(screen.getByText("lazy")).toBeInTheDocument()
    })
})

describe("PanelBoundary — standalone", () => {
    it("renders children normally when no error occurs", () => {
        renderWithProviders(
            <PanelBoundary>
                <div data-testid="inner">hello</div>
            </PanelBoundary>,
        )
        expect(screen.getByTestId("inner")).toBeInTheDocument()
    })
})
