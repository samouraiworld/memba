/**
 * W6.5 PR1 — root ErrorBoundary must report to Sentry (app-wide render
 * crashes were previously invisible; only alerts/gnolove boundaries
 * captured). The self-healing first stale-chunk reload stays unreported.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render } from "@testing-library/react"
import { ErrorBoundary } from "./ErrorBoundary"

const mocks = vi.hoisted(() => ({ capture: vi.fn() }))

vi.mock("@sentry/react", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@sentry/react")>()),
    captureException: mocks.capture,
}))

function Bomb({ message }: { message: string }): never {
    throw new Error(message)
}

beforeEach(() => {
    mocks.capture.mockReset()
    sessionStorage.clear()
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => vi.restoreAllMocks())

describe("ErrorBoundary → Sentry (W6.5)", () => {
    it("captures render crashes with the root-boundary tag", () => {
        render(<ErrorBoundary><Bomb message="app exploded" /></ErrorBoundary>)
        expect(mocks.capture).toHaveBeenCalledTimes(1)
        const [err, ctx] = mocks.capture.mock.calls[0]
        expect((err as Error).message).toBe("app exploded")
        expect(ctx.tags.memba_boundary).toBe("root")
    })

    it("stale-chunk crashes are captured WITH the filterable tag and still auto-reload", () => {
        // Design note: componentDidMount clears the reload guard on every
        // successful boot, so persistent stale chunks reload once per boot —
        // capture must happen BEFORE the early-return or those loops are
        // invisible. The tag keeps benign one-off reloads filterable.
        const reload = vi.fn()
        const realLocation = window.location
        Object.defineProperty(window, "location", { value: { ...realLocation, reload }, writable: true })
        try {
            render(<ErrorBoundary><Bomb message="Failed to fetch dynamically imported module: /assets/x.js" /></ErrorBoundary>)
            expect(reload).toHaveBeenCalledTimes(1)
            expect(mocks.capture).toHaveBeenCalledTimes(1)
            expect(mocks.capture.mock.calls[0][1].tags.memba_stale_chunk).toBe("yes")
        } finally {
            Object.defineProperty(window, "location", { value: realLocation, writable: true })
        }
    })

    it("ordinary crashes carry the no-stale tag", () => {
        render(<ErrorBoundary><Bomb message="plain render bug" /></ErrorBoundary>)
        expect(mocks.capture.mock.calls[0][1].tags.memba_stale_chunk).toBe("no")
    })
})
