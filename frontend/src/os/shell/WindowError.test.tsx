import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@sentry/react", () => ({ captureException: vi.fn() }))
vi.mock("../../lib/staleChunk", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/staleChunk")>()),
    tryChunkReload: vi.fn(() => false),
}))

import * as Sentry from "@sentry/react"
import { tryChunkReload } from "../../lib/staleChunk"
import { WindowError } from "./WindowError"

function Boom({ msg }: { msg: string }): never {
    throw new Error(msg)
}

const CHUNK = "Failed to fetch dynamically imported module: /assets/MultisigWindows-abc.js"

beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {})
})
afterEach(() => {
    vi.restoreAllMocks()
    vi.mocked(tryChunkReload).mockClear()
    vi.mocked(Sentry.captureException).mockClear()
})

describe("WindowError", () => {
    it("keeps a failing window to itself: its siblings stay rendered", () => {
        render(
            <>
                <WindowError resetKey="a" close={() => {}}><Boom msg="render crash" /></WindowError>
                <p>other window</p>
            </>,
        )
        expect(screen.getByText("Something went wrong in this window")).toBeInTheDocument()
        expect(screen.getByText("other window")).toBeInTheDocument()
        expect(Sentry.captureException).toHaveBeenCalledOnce()
        expect(vi.mocked(Sentry.captureException).mock.calls[0][1]).toMatchObject({ tags: { memba_boundary: "os-window", memba_stale_chunk: "no" } })
        expect(tryChunkReload).not.toHaveBeenCalled()
    })

    it("tries the once-per-session reload on a stale chunk, then offers a manual reload", () => {
        render(<WindowError resetKey="a" close={() => {}}><Boom msg={CHUNK} /></WindowError>)
        expect(tryChunkReload).toHaveBeenCalledOnce()
        expect(screen.getByText("This window could not load")).toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Reload Memba" })).toBeInTheDocument()
        expect(screen.queryByRole("button", { name: "Try again" })).toBeNull()
    })

    it("closes the window from the fallback", () => {
        const close = vi.fn()
        render(<WindowError resetKey="a" close={close}><Boom msg="render crash" /></WindowError>)
        fireEvent.click(screen.getByRole("button", { name: "Close window" }))
        expect(close).toHaveBeenCalledOnce()
    })

    it("clears the error when the window moves to another target", () => {
        const { rerender } = render(<WindowError resetKey="a" close={() => {}}><Boom msg="render crash" /></WindowError>)
        expect(screen.getByText("Something went wrong in this window")).toBeInTheDocument()
        rerender(<WindowError resetKey="b" close={() => {}}><p>next page</p></WindowError>)
        expect(screen.getByText("next page")).toBeInTheDocument()
    })

    it("Try again re-renders the window", () => {
        let fail = true
        function Flaky() {
            if (fail) throw new Error("once")
            return <p>recovered</p>
        }
        render(<WindowError resetKey="a" close={() => {}}><Flaky /></WindowError>)
        fail = false
        fireEvent.click(screen.getByRole("button", { name: "Try again" }))
        expect(screen.getByText("recovered")).toBeInTheDocument()
    })
})
