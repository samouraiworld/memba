import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { DraftBase, DraftRecord, NotesScope, NotesStore } from "../../../lib/notes/drafts"
import { DraftEditor } from "./DraftEditor"
vi.mock("../terminal/CodeEditor", () => ({ CodeEditor: ({ value, onChange }: { value: string; onChange(value: string): void }) => <textarea aria-label="Markdown editor" value={value} onChange={event => onChange(event.target.value)} /> }))
vi.mock("../../../lib/notes/render", () => ({ createNotesRenderer: () => ({ render: async (text: string) => ({ kind: "text", text }), dispose() {} }) }))
const scope: NotesScope = { chainId: "gnoland-1", realm: "gno.land/r/samcrew/memba_notes_v1", owner: "guest", noteId: "0123456789abcdef0123456789abcdef" }
const record: DraftRecord = { schema: 1, scope, localRevision: "1", payload: { kind: "public", title: "Saved", body: "Saved body" }, updatedAt: 1 }
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

    it("retains the published baseline while autosaving and exposes only durable snapshots", async () => {
        const base = { stateRevision: "7", epoch: "0", ownerGeneration: "1", titleRevision: "2", bodyRevision: "4" }
        const initial = { ...record, payload: { kind: "public" as const, title: "Saved", body: "Saved body", base } }
        const saveDraft = vi.fn(async (_scope, _revision, payload) => ({ status: "saved", value: { ...initial, localRevision: "2", payload } }))
        const store = { getDraft: vi.fn(async () => initial), saveDraft } as unknown as NotesStore
        render(<DraftEditor store={store} scope={scope} onSaved={() => {}} actions={value => <button>Review revision {value.localRevision}</button>} />)
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
        render(<DraftEditor store={store} scope={scope} onSaved={() => {}} actions={(_value, published) => { confirm = published; return <button>Publish saved snapshot</button> }} />)
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
        fireEvent.click(await screen.findByRole("button", { name: "Export" }))
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
        render(<DraftEditor store={store} scope={scope} onSaved={() => {}} actions={(_value, published) => { confirm = published; return <button>Publish saved snapshot</button> }} />)
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
        render(<DraftEditor store={store} scope={scope} onSaved={() => {}} actions={(_value, published) => { confirm = published; return <button>Publish saved snapshot</button> }} />)
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
        fireEvent.click(screen.getByRole("button", { name: "Delete", exact: true }))
        fireEvent.click(screen.getByRole("button", { name: "Delete this draft?", exact: true }))
        expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
        expect(screen.getByRole("status")).toHaveTextContent("Deleting draft")
        await act(async () => finish({ status: "saved", value: null }))
        expect(screen.getByRole("heading", { name: "No local draft" })).toBeInTheDocument()
        expect(onSaved).toHaveBeenCalledOnce()
    })
    it("never exposes a blank editable draft after its stored copy fails to load", async () => {
        const store = { getDraft: vi.fn(async () => { throw new Error("storage failed") }) } as unknown as NotesStore
        render(<DraftEditor store={store} scope={scope} onSaved={() => {}} />)
        await screen.findByRole("alert")
        expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Retry loading" })).toBeInTheDocument()
    })
})
