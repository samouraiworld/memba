import { withWalletActivity } from "../lib/walletActivity"
/**
 * ErrorBoundary stale-chunk auto-recovery — the owner-reported mobile bug.
 *
 * After each deploy the autoUpdate service worker purges old chunks from live
 * tabs; the next lazy route load imports index.html as JS and fails. The
 * boundary must recognize EVERY browser's phrasing of that failure and reload
 * once — iOS Safari's "'text/html' is not a valid JavaScript MIME type" was
 * missing from the matcher, so mobile users got the generic error card on
 * every deploy instead of a silent recovery.
 */
import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ErrorBoundary } from "./ErrorBoundary"
import { CHUNK_RELOAD_KEY, isStaleChunkError } from "../lib/staleChunk"

vi.mock("@sentry/react", () => ({
    captureException: vi.fn(),
}))

function Thrower({ message }: { message: string }): never {
    throw new Error(message)
}

const WEBKIT_MIME = "'text/html' is not a valid JavaScript MIME type."
const WEBKIT_IMPORT = "Importing a module script failed."
const CHROME_IMPORT = "Failed to fetch dynamically imported module: https://memba.app/assets/DAOHome-abc123.js"

describe("isStaleChunkError", () => {
    it.each([
        WEBKIT_MIME,
        WEBKIT_IMPORT,
        CHROME_IMPORT,
        "error loading dynamically imported module",
        "Loading chunk 42 failed",
        "Loading CSS chunk 7 failed",
    ])("matches %s", (msg) => {
        expect(isStaleChunkError(new Error(msg))).toBe(true)
    })

    it("does not match unrelated errors", () => {
        expect(isStaleChunkError(new Error("Cannot read properties of undefined"))).toBe(false)
        expect(isStaleChunkError(new Error("Failed to fetch"))).toBe(false)
    })
})

describe("ErrorBoundary chunk auto-recovery", () => {
    const reload = vi.fn()
    const realLocation = window.location
    let consoleError: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
        sessionStorage.clear()
        reload.mockClear()
        Object.defineProperty(window, "location", {
            value: { ...realLocation, reload },
            writable: true,
        })
        // React logs boundary-caught errors; keep test output clean.
        consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
        vi.spyOn(console, "warn").mockImplementation(() => {})
    })

    afterEach(() => {
        Object.defineProperty(window, "location", { value: realLocation, writable: true })
        consoleError.mockRestore()
        vi.restoreAllMocks()
    })

    it("iOS Safari MIME error (the reported bug): reloads once and sets the guard", () => {
        render(
            <ErrorBoundary>
                <Thrower message={WEBKIT_MIME} />
            </ErrorBoundary>,
        )
        expect(reload).toHaveBeenCalledTimes(1)
        expect(sessionStorage.getItem(CHUNK_RELOAD_KEY)).toBe("1")
    })

    it("guard already spent: shows the friendly update card, no reload loop", () => {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, "1")
        render(
            <ErrorBoundary>
                <Thrower message={WEBKIT_MIME} />
            </ErrorBoundary>,
        )
        expect(reload).not.toHaveBeenCalled()
        expect(screen.getByText("Page could not load")).toBeInTheDocument()
        // The raw error text must NOT be shown for a recognized chunk error.
        expect(screen.queryByText(WEBKIT_MIME)).not.toBeInTheDocument()
    })

    it("blocked storage leaves a usable fallback without an unbounded reload", () => {
        vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("Denied", "SecurityError") })
        render(<ErrorBoundary><Thrower message={CHROME_IMPORT} /></ErrorBoundary>)
        expect(reload).not.toHaveBeenCalled()
        expect(screen.getByRole("button", { name: "Reload Page" })).toBeInTheDocument()
    })

    it("defers recovery until a pending wallet response settles, without resubmission", async () => {
        let resolve!: () => void
        const sign = vi.fn(() => new Promise<void>(r => { resolve = r }))
        const request = withWalletActivity(sign)
        render(<ErrorBoundary><Thrower message={CHROME_IMPORT} /></ErrorBoundary>)
        expect(reload).not.toHaveBeenCalled()
        expect(screen.getByRole("button", { name: "Reload Page" })).toBeDisabled()
        await act(async () => { resolve(); await request })
        expect(reload).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole("button", { name: "Reload Page" }))
        expect(reload).toHaveBeenCalledTimes(1)
        expect(sign).toHaveBeenCalledTimes(1)
    })

    it("generic errors: no reload, generic card with the raw message", () => {
        render(
            <ErrorBoundary>
                <Thrower message="Cannot read properties of undefined" />
            </ErrorBoundary>,
        )
        expect(reload).not.toHaveBeenCalled()
        expect(screen.getByText("Something went wrong")).toBeInTheDocument()
        expect(screen.getByText("Cannot read properties of undefined")).toBeInTheDocument()
    })

    it("successful mount preserves the reload budget for later lazy routes", () => {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, "1")
        render(
            <ErrorBoundary>
                <div>fine</div>
            </ErrorBoundary>,
        )
        expect(sessionStorage.getItem(CHUNK_RELOAD_KEY)).toBe("1")
    })
})
