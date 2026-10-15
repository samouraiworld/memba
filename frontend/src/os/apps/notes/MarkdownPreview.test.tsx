import { act, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { NotesRenderResult } from "../../../lib/notes/render"
import { MarkdownPreview } from "./MarkdownPreview"

const renderer = vi.hoisted(() => ({ render: vi.fn(), dispose: vi.fn() }))
vi.mock("../../../lib/notes/render", () => ({ createNotesRenderer: () => renderer }))
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

describe("shared Markdown preview lifecycle", () => {
    it("cancels superseded previews and never presents a stale rendered body", async () => {
        vi.useFakeTimers()
        const finish: ((value: NotesRenderResult) => void)[] = []
        renderer.render.mockImplementation(() => new Promise(resolve => finish.push(resolve)))
        const view = render(<MarkdownPreview body="Old body" noteId={"ab".repeat(16)} />)
        await act(async () => { vi.advanceTimersByTime(180) })
        const firstSignal = renderer.render.mock.calls[0][1].signal as AbortSignal
        view.rerender(<MarkdownPreview body="New body" noteId={"ab".repeat(16)} />)
        expect(firstSignal.aborted).toBe(true)
        expect(screen.queryByText("New body")).toBeNull()
        expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true")
        await act(async () => { finish[0]({ kind: "html", html: "<h1>Stale rendered</h1>" }); vi.advanceTimersByTime(180) })
        expect(screen.queryByText("Stale rendered")).toBeNull()
        await act(async () => { finish[1]({ kind: "text", text: "Safe text fallback", reason: "timeout", truncated: false }) })
        expect(screen.getByText("Safe text fallback")).toBeVisible()
        const activeSignal = renderer.render.mock.calls[1][1].signal as AbortSignal
        view.unmount()
        expect(activeSignal.aborted).toBe(true)
        expect(renderer.dispose).toHaveBeenCalledTimes(2)
    })
    it("shows a skeleton, then keeps the previous render while the next one is pending, never the Markdown source", async () => {
        vi.useFakeTimers()
        const finish: ((value: NotesRenderResult) => void)[] = []
        renderer.render.mockImplementation(() => new Promise(resolve => finish.push(resolve)))
        const view = render(<MarkdownPreview body="- one" noteId={"ab".repeat(16)} />)
        expect(screen.queryByText("- one")).toBeNull()
        expect(screen.getByLabelText("Note preview")).toHaveAttribute("data-rendered", "loading")
        await act(async () => { vi.advanceTimersByTime(180) })
        await act(async () => { finish[0]({ kind: "html", html: "<ul><li>one</li></ul>" }) })
        view.rerender(<MarkdownPreview body={"- one\n- two"} noteId={"ab".repeat(16)} />)
        expect(screen.getByText("one")).toBeVisible()
        expect(screen.queryByText(/- two/)).toBeNull()
        expect(screen.getByLabelText("Note preview")).toHaveAttribute("data-rendered", "loading")
    })
    it("namespaces previews of the same note independently", async () => {
        vi.useFakeTimers()
        renderer.render.mockResolvedValue({ kind: "html", html: "<p>Rendered</p>" })
        render(<><MarkdownPreview body="Text" noteId={"ab".repeat(16)} /><MarkdownPreview body="Text" noteId={"ab".repeat(16)} /></>)
        await act(async () => { vi.advanceTimersByTime(180) })
        const scopes = renderer.render.mock.calls.map(call => call[1].scopeId)
        expect(new Set(scopes).size).toBe(2)
        expect(scopes.every(scope => /^[a-zA-Z0-9_-]+$/.test(scope))).toBe(true)
    })
})
