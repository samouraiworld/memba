import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { ChainNote, NotesPage } from "../../../lib/notes/chain/schema"
import { PublicLibrary } from "./PublicLibrary"
import { PublicNote } from "./PublicNote"

vi.mock("./MarkdownPreview", () => ({ MarkdownPreview: ({ body }: { body: string }) => <article>{body}</article> }))
const noteId = "ab".repeat(16)
function note(patch: Partial<ChainNote> = {}): ChainNote {
    return { id: noteId, owner: "owner", pendingOwner: "", ownerGeneration: "1", mode: 3, stateRevision: "9007199254740993", titleRevision: "1", bodyRevision: "1", epoch: "0", title: new TextEncoder().encode("Published title"), body: new TextEncoder().encode("Public body"), commitment: new Uint8Array(), deleted: false, listed: true, createdHeight: "1", operationId: "cd".repeat(16), actor: "owner", height: "2", ...patch }
}
function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>(done => { resolve = done })
    return { promise, resolve }
}

describe("public Notes library", () => {
    it("paginates without duplicates, retains the first page on failure and retries the failed cursor", async () => {
        const onOpen = vi.fn(), next = "00000000000000000001:" + noteId
        const client = { publicNotes: vi.fn().mockResolvedValueOnce({ items: [note()], nextCursor: next }).mockRejectedValueOnce(new Error("private diagnostic"))
            .mockResolvedValueOnce({ items: [note(), note({ id: "ee".repeat(16), title: new TextEncoder().encode("Second note") })], nextCursor: "" }) }
        render(<PublicLibrary client={client} onOpen={onOpen} />)
        expect(screen.getByRole("status")).toHaveTextContent("Loading public notes")
        fireEvent.click(await screen.findByRole("button", { name: /Published title/ }))
        expect(onOpen).toHaveBeenCalledWith(noteId)
        fireEvent.click(screen.getByRole("button", { name: "Load more" }))
        expect(await screen.findByRole("alert")).not.toHaveTextContent("private diagnostic")
        expect(screen.getByRole("button", { name: /Published title/ })).toBeVisible()
        fireEvent.click(screen.getByRole("button", { name: "Retry" }))
        expect(await screen.findByRole("button", { name: /Second note/ })).toBeVisible()
        expect(screen.getAllByRole("button", { name: /Published title/ })).toHaveLength(1)
        expect(client.publicNotes.mock.calls).toEqual([["", 20], [next, 20], [next, 20]])
        expect(screen.queryByRole("button", { name: "Load more" })).toBeNull()
    })
    it("ignores an old network response, handles empty/error states and retries", async () => {
        const old = deferred<NotesPage>(), first = { publicNotes: vi.fn(() => old.promise) }
        const second = { publicNotes: vi.fn().mockRejectedValueOnce(new Error(noteId)).mockResolvedValueOnce({ items: [], nextCursor: "" }) }
        const view = render(<PublicLibrary client={first} onOpen={vi.fn()} />)
        view.rerender(<PublicLibrary client={second} onOpen={vi.fn()} />)
        expect(await screen.findByRole("alert")).not.toHaveTextContent(noteId)
        await act(async () => { old.resolve({ items: [note()], nextCursor: "" }) })
        expect(screen.queryByText("Published title")).toBeNull()
        fireEvent.click(screen.getByRole("button", { name: "Retry" }))
        expect(await screen.findByText("No public notes have been listed yet.")).toBeVisible()
    })
    it("refuses a nonadvancing pagination cursor without duplicating rows", async () => {
        const cursor = "00000000000000000001:" + noteId
        const client = { publicNotes: vi.fn().mockResolvedValue({ items: [note()], nextCursor: cursor }) }
        render(<PublicLibrary client={client} onOpen={vi.fn()} />)
        fireEvent.click(await screen.findByRole("button", { name: "Load more" }))
        expect(await screen.findByRole("alert")).toBeVisible()
        expect(screen.getAllByRole("button", { name: /Published title/ })).toHaveLength(1)
    })
})

describe("public note reading", () => {
    it.each([
        [null, "Note not found"],
        [note({ deleted: true, title: new Uint8Array(), body: new Uint8Array() }), "Deleted note"],
        [note({ mode: 1 }), "Encrypted note"],
    ])("renders the explicit nonpublic state without exposing payloads", async (value, heading) => {
        render(<PublicNote id={noteId} client={{ note: vi.fn().mockResolvedValue(value) }} owner={null} onEdit={vi.fn()} />)
        expect(await screen.findByRole("heading", { name: heading as string })).toBeVisible()
        expect(screen.queryByText("Public body")).toBeNull()
        expect(screen.queryByRole("button", { name: "Edit note" })).toBeNull()
    })
    it("allows guests to read, restricts editing to the owner and transfers a defensive baseline", async () => {
        const original = note(), client = { note: vi.fn().mockResolvedValue(original) }, edit = vi.fn()
        const view = render(<PublicNote id={noteId} client={client} owner={null} onEdit={edit} />)
        expect(await screen.findByRole("heading", { name: "Published title" })).toBeVisible()
        expect(screen.getByText("Public body")).toBeVisible()
        expect(screen.getByRole("status")).toHaveTextContent("9007199254740993")
        expect(screen.getByRole("button", { name: "Export Markdown" })).toBeVisible()
        expect(screen.queryByRole("button", { name: "Edit note" })).toBeNull()
        view.rerender(<PublicNote id={noteId} client={client} owner="other" onEdit={edit} />)
        expect(screen.queryByRole("button", { name: "Edit note" })).toBeNull()
        view.rerender(<PublicNote id={noteId} client={client} owner="owner" onEdit={edit} />)
        fireEvent.click(screen.getByRole("button", { name: "Edit note" }))
        const baseline = edit.mock.calls[0][0] as ChainNote
        expect(JSON.stringify(baseline)).toBe(JSON.stringify(original))
        expect(baseline).not.toBe(original)
        baseline.title.fill(0)
        expect(new TextDecoder().decode(original.title)).toBe("Published title")
    })
    it("masks old content immediately on ID changes and ignores responses after cleanup", async () => {
        const stale = deferred<ChainNote | null>(), fresh = deferred<ChainNote | null>()
        const client = { note: vi.fn().mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise) }
        const view = render(<PublicNote id={noteId} client={client} owner={null} />)
        view.rerender(<PublicNote id={"ee".repeat(16)} client={client} owner={null} />)
        await act(async () => { stale.resolve(note()) })
        expect(screen.queryByText("Published title")).toBeNull()
        expect(screen.getByRole("status")).toHaveTextContent("Loading note")
        await act(async () => { fresh.resolve(note({ title: new TextEncoder().encode("New network note") })) })
        expect(screen.getByRole("heading", { name: "New network note" })).toBeVisible()
        view.unmount()
    })
    it("retries a failed read without displaying diagnostic content", async () => {
        const client = { note: vi.fn().mockRejectedValueOnce(new Error(noteId)).mockResolvedValueOnce(note()) }
        render(<PublicNote id={noteId} client={client} owner={null} />)
        expect(await screen.findByRole("alert")).not.toHaveTextContent(noteId)
        fireEvent.click(screen.getByRole("button", { name: "Retry" }))
        await waitFor(() => expect(screen.getByRole("heading", { name: "Published title" })).toBeVisible())
    })
})
