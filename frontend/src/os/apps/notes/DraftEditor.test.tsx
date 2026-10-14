import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { DraftBase, DraftRecord, NotesScope, NotesStore } from "../../../lib/notes/drafts"
import { DraftEditor } from "./DraftEditor"
vi.mock("../terminal/CodeEditor", () => ({ CodeEditor: ({ value, onChange }: { value: string; onChange(value: string): void }) => <textarea aria-label="Markdown editor" value={value} onChange={event => onChange(event.target.value)} /> }))
vi.mock("../../../lib/notes/render", () => ({ createNotesRenderer: () => ({ render: async (text: string) => ({ kind: "text", text }), dispose() {} }) }))
const bound = vi.hoisted(() => ({ ms: undefined as number | undefined }))
// Bounded waits, shortened per test: a step that never answers ends quickly.
vi.mock("../../../lib/notes/freshness", async original => {
    const actual = await original<typeof import("../../../lib/notes/freshness")>()
    return { ...actual, withTimeout: <T,>(promise: Promise<T>, ms?: number) => actual.withTimeout(promise, bound.ms ?? ms) }
})
afterEach(() => { bound.ms = undefined })
const scope: NotesScope = { chainId: "gnoland-1", realm: "gno.land/r/samcrew/memba_notes_v1", owner: "guest", noteId: "0123456789abcdef0123456789abcdef" }
const record: DraftRecord = { schema: 1, scope, localRevision: "1", payload: { kind: "public", title: "Saved", body: "Saved body" }, updatedAt: 1 }
describe("a separate copy (F26)", () => {
    it("says it is an unpublished copy of the note, and keeps that through edits", async () => {
        const copy: DraftRecord = { ...record, payload: { kind: "public", title: "Sushi (my version)", body: "Mine", copyOf: { noteId: "ab".repeat(16), title: "Sushi" } } }
        const saveDraft = vi.fn(async (_scope, revision: string, payload) => ({ status: "saved", value: { ...copy, localRevision: String(BigInt(revision) + 1n), payload } }))
        render(<DraftEditor store={{ getDraft: vi.fn(async () => copy), saveDraft } as unknown as NotesStore} scope={scope} onSaved={() => {}} />)
        expect(await screen.findByText("Copy of your text from “Sushi”, not published. Publishing it creates a new public note; the original note is unchanged.")).toBeVisible()
        expect(screen.getByText(/^Unpublished copy · /)).toBeVisible()
        fireEvent.change(screen.getByRole("textbox", { name: "Note title" }), { target: { value: "Sushi, mine" } })
        // The autosave timer and the save's answer update the editor: both land inside act.
        await act(async () => { await vi.waitFor(() => expect(saveDraft).toHaveBeenCalledOnce(), { timeout: 2000 }) })
        expect(saveDraft.mock.calls[0][2]).toEqual({ kind: "public", title: "Sushi, mine", body: "Mine", copyOf: { noteId: "ab".repeat(16), title: "Sushi" } })
        expect(screen.getByText(/^Unpublished copy · /)).toBeVisible()
    })
})
describe("Draft editor asynchronous boundaries", () => {
    it("stores edits typed just before it unmounts, after a save already in flight, which unmounting never aborts", async () => {
        let finish!: (value: unknown) => void
        const saveDraft = vi.fn((_scope, revision: string, payload, guard: { signal: AbortSignal }) => saveDraft.mock.calls.length === 1
            ? new Promise(resolve => { finish = resolve }).then(() => ({ status: guard.signal.aborted ? "session-changed" : "saved", value: { ...record, localRevision: "2", payload } }))
            : Promise.resolve({ status: "saved", value: { ...record, localRevision: String(BigInt(revision) + 1n), payload } }))
        const store = { getDraft: vi.fn(async () => record), saveDraft } as unknown as NotesStore
        const view = render(<DraftEditor store={store} scope={scope} onSaved={() => {}} />)
        fireEvent.change(await screen.findByRole("textbox", { name: "Note title" }), { target: { value: "Shopping" } })
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 700)) })
        expect(saveDraft).toHaveBeenCalledOnce()
        fireEvent.change(screen.getByRole("textbox", { name: "Note title" }), { target: { value: "Shopping list" } })
        view.unmount()
        await act(async () => { finish(undefined); await new Promise(resolve => setTimeout(resolve, 0)) })
        await vi.waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(2))
        expect(saveDraft.mock.calls[1][1]).toBe("2")
        expect(saveDraft.mock.calls[1][2]).toMatchObject({ title: "Shopping list", body: "Saved body" })
        expect(saveDraft.mock.calls[0][3].signal.aborted).toBe(false)
    })

    it("reopened on the same note before the closing save lands, reads the draft only after that save (X, Y, X)", async () => {
        let finish!: () => void
        let stored: DraftRecord = record
        const saveDraft = vi.fn((_scope, revision: string, payload) => {
            const save = () => { stored = { ...record, localRevision: String(BigInt(revision) + 1n), payload }; return { status: "saved", value: stored } }
            return saveDraft.mock.calls.length === 1 ? new Promise(resolve => { finish = () => resolve(save()) }) : Promise.resolve(save())
        })
        const getDraft = vi.fn(async () => stored)
        const store = { getDraft, saveDraft } as unknown as NotesStore
        const first = render(<DraftEditor store={store} scope={scope} onSaved={() => {}} />)
        fireEvent.change(await screen.findByRole("textbox", { name: "Note title" }), { target: { value: "Typed before switching" } })
        first.unmount()
        await vi.waitFor(() => expect(saveDraft).toHaveBeenCalledOnce())
        render(<DraftEditor store={store} scope={scope} onSaved={() => {}} />)
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
        expect(getDraft).toHaveBeenCalledOnce()
        await act(async () => { finish(); await new Promise(resolve => setTimeout(resolve, 0)) })
        expect(await screen.findByRole("textbox", { name: "Note title" })).toHaveValue("Typed before switching")
        fireEvent.change(screen.getByRole("textbox", { name: "Note title" }), { target: { value: "Typed after coming back" } })
        await vi.waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(2), { timeout: 2000 })
        expect(saveDraft.mock.calls[1][1]).toBe("2")
        expect(screen.queryByText(/changed in another window/)).toBeNull()
    })

    it("opens the stored draft with a notice when the closing save never settles", async () => {
        const stuckScope = { ...scope, noteId: "fedcba9876543210fedcba9876543210" }, stuckRecord = { ...record, scope: stuckScope }
        const saveDraft = vi.fn(() => new Promise(() => {}))
        const getDraft = vi.fn(async () => stuckRecord)
        const store = { getDraft, saveDraft } as unknown as NotesStore
        const first = render(<DraftEditor store={store} scope={stuckScope} onSaved={() => {}} />)
        fireEvent.change(await screen.findByRole("textbox", { name: "Note title" }), { target: { value: "Typed" } })
        first.unmount()
        await vi.waitFor(() => expect(saveDraft).toHaveBeenCalledOnce())
        vi.useFakeTimers({ shouldAdvanceTime: true })
        try {
            render(<DraftEditor store={store} scope={stuckScope} onSaved={() => {}} />)
            await act(async () => { await vi.advanceTimersByTimeAsync(5_100) })
            expect(await screen.findByRole("textbox", { name: "Note title" })).toHaveValue("Saved")
            expect(screen.getByText(/An earlier save of this note is still running/)).toBeVisible()
        } finally { vi.useRealTimers() }
    })

    it("retains the published baseline while autosaving and exposes only durable snapshots", async () => {
        const base = { stateRevision: "7", epoch: "0", ownerGeneration: "1", titleRevision: "2", bodyRevision: "4" }
        const initial = { ...record, payload: { kind: "public" as const, title: "Saved", body: "Saved body", base } }
        const saveDraft = vi.fn(async (_scope, _revision, payload) => ({ status: "saved", value: { ...initial, localRevision: "2", payload } }))
        const store = { getDraft: vi.fn(async () => initial), saveDraft } as unknown as NotesStore
        render(<DraftEditor store={store} scope={scope} onSaved={() => {}} actions={value => ({ primary: <button>Review revision {value.localRevision}</button> })} />)
        await screen.findByRole("button", { name: "Review revision 1" })
        fireEvent.change(screen.getByRole("textbox", { name: "Markdown editor" }), { target: { value: "My changes" } })
        expect(screen.queryByRole("button", { name: /Review revision/ })).not.toBeInTheDocument()
        await screen.findByRole("button", { name: "Review revision 2" })
        expect(saveDraft.mock.calls[0][2]).toEqual({ kind: "public", title: "Saved", body: "My changes", base })
    })
    it("moves the baseline to the published revision and keeps edits made after publication was requested", async () => {
        let confirm!: (base: DraftBase, fromRevision: string) => Promise<boolean>
        const saveDraft = vi.fn(async (_scope, revision, payload) => ({ status: "saved", value: { ...record, localRevision: String(Number(revision) + 1), payload } }))
        const store = { getDraft: vi.fn(async () => record), saveDraft } as unknown as NotesStore
        render(<DraftEditor store={store} scope={scope} onSaved={() => {}} actions={(_value, editor) => { confirm = editor.published; return { primary: <button>Publish saved snapshot</button> } }} />)
        await screen.findByRole("button", { name: "Publish saved snapshot" })
        fireEvent.change(screen.getByRole("textbox", { name: "Markdown editor" }), { target: { value: "Newer unsaved edits" } })
        const next = { stateRevision: "1", epoch: "0", ownerGeneration: "1", titleRevision: "1", bodyRevision: "1" }
        let moved = false; await act(async () => { moved = await confirm(next, "1") }); expect(moved).toBe(true)
        expect(saveDraft).toHaveBeenLastCalledWith(scope, "1", { kind: "public", title: "Saved", body: "Newer unsaved edits", base: next }, expect.anything())
        expect(screen.getByRole("textbox", { name: "Markdown editor" })).toHaveValue("Newer unsaved edits")
    })
    it("exports the draft under a file name derived from its title", async () => {
        const names: string[] = [], click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download) })
        Object.assign(URL, { createObjectURL: vi.fn(() => "blob:draft"), revokeObjectURL: vi.fn() })
        const store = { getDraft: vi.fn(async () => ({ ...record, payload: { kind: "public" as const, title: "Plans/2026  Q4", body: "Body" } })) } as unknown as NotesStore
        render(<DraftEditor store={store} scope={scope} onSaved={() => {}} />)
        fireEvent.click(await screen.findByRole("button", { name: "More actions" }))
        fireEvent.click(screen.getByRole("menuitem", { name: /^Export/ }))
        expect(names).toEqual(["Plans-2026 Q4.md"])
        click.mockRestore()
    })
    it("explains a title the realm would refuse while the draft is edited", async () => {
        const store = { getDraft: vi.fn(async () => record), saveDraft: vi.fn(async () => ({ status: "saved", value: record })) } as unknown as NotesStore
        render(<DraftEditor store={store} scope={scope} onSaved={() => {}} />)
        const title = await screen.findByRole("textbox", { name: "Note title" })
        expect(screen.queryByText(/Titles cannot/)).toBeNull()
        fireEvent.change(title, { target: { value: "Recipes/sushi" } })
        expect(screen.getByText("Titles cannot contain “/”.")).toBeVisible()
        fireEvent.change(title, { target: { value: " Recipes " } })
        expect(screen.queryByText(/Titles cannot/)).toBeNull()
    })
    it("reports a baseline move only after its own save has settled, even behind a running autosave", async () => {
        let confirm!: (base: DraftBase, fromRevision: string) => Promise<boolean>
        let finishAutosave!: () => void
        const saveDraft = vi.fn()
            .mockImplementationOnce((_scope, revision, payload) => new Promise(resolve => { finishAutosave = () => resolve({ status: "saved", value: { ...record, localRevision: String(Number(revision) + 1), payload } }) }))
            .mockImplementation(async (_scope, revision, payload) => ({ status: "saved", value: { ...record, localRevision: String(Number(revision) + 1), payload } }))
        const store = { getDraft: vi.fn(async () => record), saveDraft } as unknown as NotesStore
        render(<DraftEditor store={store} scope={scope} onSaved={() => {}} actions={(_value, editor) => { confirm = editor.published; return { primary: <button>Publish saved snapshot</button> } }} />)
        await screen.findByRole("button", { name: "Publish saved snapshot" })
        const publishedConfirm = confirm
        fireEvent.change(screen.getByRole("textbox", { name: "Markdown editor" }), { target: { value: "Typed while signing" } })
        await waitFor(() => expect(saveDraft).toHaveBeenCalledOnce())
        const next = { stateRevision: "2", epoch: "0", ownerGeneration: "1", titleRevision: "1", bodyRevision: "2" }
        let settled: boolean | undefined
        void publishedConfirm(next, "1").then(value => { settled = value })
        await act(async () => { await Promise.resolve() }); expect(settled).toBeUndefined()
        await act(async () => finishAutosave())
        await waitFor(() => expect(settled).toBe(true))
        expect(saveDraft).toHaveBeenLastCalledWith(scope, "2", { kind: "public", title: "Saved", body: "Typed while signing", base: next }, expect.anything())
    })
    it("never moves the baseline of a draft that was replaced from another window", async () => {
        let confirm!: (base: DraftBase, fromRevision: string) => Promise<boolean>
        const saveDraft = vi.fn()
        const store = { getDraft: vi.fn(async () => ({ ...record, localRevision: "3" })), saveDraft } as unknown as NotesStore
        render(<DraftEditor store={store} scope={scope} onSaved={() => {}} actions={(_value, editor) => { confirm = editor.published; return { primary: <button>Publish saved snapshot</button> } }} />)
        await screen.findByRole("button", { name: "Publish saved snapshot" })
        expect(await confirm({ stateRevision: "1", epoch: "0", ownerGeneration: "1", titleRevision: "1", bodyRevision: "1" }, "2")).toBe(false)
        expect(saveDraft).not.toHaveBeenCalled()
    })
    it("offers public reading when local storage is unavailable", async () => {
        const store = { getDraft: vi.fn(async () => { throw new Error("storage failed") }) } as unknown as NotesStore
        render(<DraftEditor store={store} scope={scope} onSaved={() => {}} remote={<p>Public reading</p>} />)
        await screen.findByText("Public reading")
        expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
    })
    it("prevents new edits while deletion is pending", async () => {
        let finish!: (result: { status: "saved"; value: null }) => void
        const store = { getDraft: vi.fn(async () => record), deleteDraft: vi.fn(() => new Promise(resolve => { finish = resolve })) } as unknown as NotesStore
        const onSaved = vi.fn()
        render(<DraftEditor store={store} scope={scope} onSaved={onSaved} />)
        await screen.findByRole("textbox", { name: "Markdown editor" })
        const ask = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true)
        fireEvent.click(screen.getByRole("button", { name: "More actions" })); fireEvent.click(screen.getByRole("menuitem", { name: "Delete note…" }))
        expect(store.deleteDraft).not.toHaveBeenCalled(); expect(screen.getByRole("textbox", { name: "Markdown editor" })).toBeVisible()
        fireEvent.click(screen.getByRole("button", { name: "More actions" })); fireEvent.click(screen.getByRole("menuitem", { name: "Delete note…" }))
        expect(ask).toHaveBeenCalledTimes(2); ask.mockRestore()
        await waitFor(() => expect(screen.queryByRole("textbox")).not.toBeInTheDocument())
        expect(screen.getByRole("status")).toHaveTextContent("Deleting draft")
        await act(async () => finish({ status: "saved", value: null }))
        expect(screen.getByRole("heading", { name: "No local draft" })).toBeInTheDocument()
        expect(onSaved).toHaveBeenCalledOnce()
    })
    it("keeps a confirmed discard locked when the running save lands meanwhile", async () => {
        let finishAutosave!: () => void, finishDelete!: (result: { status: "saved"; value: null }) => void
        const saveDraft = vi.fn((_scope, revision, payload) => new Promise(resolve => { finishAutosave = () => resolve({ status: "saved", value: { ...record, localRevision: String(Number(revision) + 1), payload } }) }))
        const store = { getDraft: vi.fn(async () => record), saveDraft, deleteDraft: vi.fn(() => new Promise(resolve => { finishDelete = resolve })) } as unknown as NotesStore
        // Cancel → discard (confirmed by the page) while the autosave of the last keystrokes is still running.
        render(<DraftEditor store={store} scope={scope} onSaved={() => {}} onCancel={({ discard }) => void discard()} />)
        fireEvent.change(await screen.findByRole("textbox", { name: "Markdown editor" }), { target: { value: "Typed before deleting" } })
        await waitFor(() => expect(saveDraft).toHaveBeenCalledOnce())
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
        await waitFor(() => expect(screen.queryByRole("textbox")).not.toBeInTheDocument())
        await act(async () => finishAutosave())
        await waitFor(() => expect(store.deleteDraft).toHaveBeenCalledOnce())
        expect(screen.queryByRole("textbox")).not.toBeInTheDocument(); expect(screen.getByRole("status")).toHaveTextContent("Deleting draft")
        await act(async () => finishDelete({ status: "saved", value: null }))
        expect(screen.getByRole("heading", { name: "No local draft" })).toBeInTheDocument()
    })
    it("leaves the baseline as it was when the wait for a running save times out", async () => {
        const old = { stateRevision: "7", epoch: "0", ownerGeneration: "1", titleRevision: "2", bodyRevision: "4" }, next = { ...old, stateRevision: "8", bodyRevision: "8" }
        let finishAutosave!: () => void
        const saveDraft = vi.fn()
            .mockImplementationOnce((_scope, revision, payload) => new Promise(resolve => { finishAutosave = () => resolve({ status: "saved", value: { ...record, localRevision: String(Number(revision) + 1), payload } }) }))
            .mockImplementation(async (_scope, revision, payload) => ({ status: "saved", value: { ...record, localRevision: String(Number(revision) + 1), payload } }))
        const store = { getDraft: vi.fn(async () => ({ ...record, payload: { kind: "public" as const, title: "Saved", body: "Saved body", base: old } })), saveDraft } as unknown as NotesStore
        let confirm!: (base: DraftBase, fromRevision: string) => Promise<boolean>
        render(<DraftEditor store={store} scope={scope} onSaved={() => {}} actions={(_value, editor) => { confirm = editor.published; return { primary: <button>Publish saved snapshot</button> } }} />)
        await screen.findByRole("button", { name: "Publish saved snapshot" }); const publishedConfirm = confirm
        fireEvent.change(screen.getByRole("textbox", { name: "Markdown editor" }), { target: { value: "Typed while signing" } })
        await waitFor(() => expect(saveDraft).toHaveBeenCalledOnce())
        bound.ms = 50
        await act(async () => { await expect(publishedConfirm(next, "1")).rejects.toThrow() })
        // The stuck save lands afterwards, then more typing is saved: nothing stored may carry the baseline never confirmed here.
        await act(async () => finishAutosave())
        fireEvent.change(screen.getByRole("textbox", { name: "Markdown editor" }), { target: { value: "Typed afterwards" } })
        await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(2))
        expect(saveDraft.mock.calls[1][2]).toEqual({ kind: "public", title: "Saved", body: "Typed afterwards", base: old })
        expect(screen.getByText(/based on revision 7$/)).toBeVisible()
    })
    it("ends a discard behind a save that never settles with a refusal, not a wait without end", async () => {
        // Its own note: the save that never settles also holds this note's closing flush.
        const stuck = { ...scope, noteId: "11".repeat(16) }, saveDraft = vi.fn(() => new Promise(() => {})), deleteDraft = vi.fn()
        const store = { getDraft: vi.fn(async () => ({ ...record, scope: stuck })), saveDraft, deleteDraft } as unknown as NotesStore
        const outcome = vi.fn()
        render(<DraftEditor store={store} scope={stuck} onSaved={() => {}} onCancel={({ discard }) => void discard().then(outcome)} />)
        fireEvent.change(await screen.findByRole("textbox", { name: "Markdown editor" }), { target: { value: "Unsaved" } })
        await waitFor(() => expect(saveDraft).toHaveBeenCalledOnce())
        bound.ms = 50; fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
        await waitFor(() => expect(outcome).toHaveBeenCalledExactlyOnceWith(false))
        expect(deleteDraft).not.toHaveBeenCalled(); expect(screen.getByRole("textbox", { name: "Markdown editor" })).toHaveValue("Unsaved")
    })
    it("offers Delete note… for a creation draft only while its note is not on chain", async () => {
        const store = { getDraft: vi.fn(async () => record) } as unknown as NotesStore
        const view = render(<DraftEditor store={store} scope={scope} onSaved={() => {}} basis={null} />)
        fireEvent.click(await screen.findByRole("button", { name: "More actions" }))
        expect(screen.getByRole("menuitem", { name: "Delete note…" })).toBeVisible()
        view.rerender(<DraftEditor store={store} scope={scope} onSaved={() => {}} basis={{ revision: "3", title: "Saved", body: "Published body" }} />)
        expect(screen.getByRole("menuitem", { name: /^Export/ })).toBeVisible(); expect(screen.queryByRole("menuitem", { name: "Delete note…" })).toBeNull()
    })
    it("never exposes a blank editable draft after its stored copy fails to load", async () => {
        const store = { getDraft: vi.fn(async () => { throw new Error("storage failed") }) } as unknown as NotesStore
        render(<DraftEditor store={store} scope={scope} onSaved={() => {}} />)
        await screen.findByRole("alert")
        expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Retry loading" })).toBeInTheDocument()
    })
})
