import { act, fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { DraftBase, DraftRecord, NotesScope, NotesStore } from "../../../lib/notes/drafts"
import { DraftEditor } from "./DraftEditor"
vi.mock("../terminal/CodeEditor", () => ({ CodeEditor: ({ value, onChange }: { value: string; onChange(value: string): void }) => <textarea aria-label="Markdown editor" value={value} onChange={event => onChange(event.target.value)} /> }))
vi.mock("../../../lib/notes/render", () => ({ createNotesRenderer: () => ({ render: async (text: string) => ({ kind: "text", text }), dispose() {} }) }))
const scope: NotesScope = { chainId: "gnoland-1", realm: "gno.land/r/samcrew/memba_notes_v1", owner: "guest", noteId: "0123456789abcdef0123456789abcdef" }
const record: DraftRecord = { schema: 1, scope, localRevision: "1", payload: { kind: "public", title: "Saved", body: "Saved body" }, updatedAt: 1 }
describe("Draft editor asynchronous boundaries", () => {
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
    it("does not advance the baseline over edits made after publication was requested", async () => {
        let confirm!: (base: DraftBase) => Promise<boolean>
        const saveDraft = vi.fn()
        const store = { getDraft: vi.fn(async () => record), saveDraft } as unknown as NotesStore
        render(<DraftEditor store={store} scope={scope} onSaved={() => {}} actions={(_value, published) => { confirm = published; return <button>Publish saved snapshot</button> }} />)
        await screen.findByRole("button", { name: "Publish saved snapshot" })
        fireEvent.change(screen.getByRole("textbox", { name: "Markdown editor" }), { target: { value: "Newer unsaved edits" } })
        expect(await confirm({ stateRevision: "1", epoch: "0", ownerGeneration: "1", titleRevision: "1", bodyRevision: "1" })).toBe(false)
        expect(saveDraft).not.toHaveBeenCalled()
        expect(screen.getByRole("textbox", { name: "Markdown editor" })).toHaveValue("Newer unsaved edits")
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
