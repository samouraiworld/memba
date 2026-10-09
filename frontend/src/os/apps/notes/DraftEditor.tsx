import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { createDraftSession, type DraftBase, type DraftRecord, type NotesScope, type NotesStore } from "../../../lib/notes/drafts"
import { MAX_NOTE_BODY_BYTES, newNoteId } from "../../../lib/notes/config"
import { MarkdownPreview } from "./MarkdownPreview"
import { CodeEditor } from "../terminal/CodeEditor"
import { registerCloseGuard } from "../../shell/closeGuards"

type SaveState = "loading" | "saved" | "dirty" | "saving" | "deleting" | "conflict" | "unavailable" | "missing" | "locked" | "load-error"

export function DraftEditor({ store, scope, onSaved, remote, actions }: { store: NotesStore; scope: NotesScope; onSaved(): void; remote?: ReactNode; actions?: (record: DraftRecord, published: (base: DraftBase) => Promise<boolean>) => ReactNode }) {
    const [session] = useState(createDraftSession)
    const [title, setTitle] = useState("")
    const [body, setBody] = useState("")
    const [state, setState] = useState<SaveState>("loading")
    const [view, setView] = useState<"edit" | "split" | "preview">("split")
    const [notice, setNotice] = useState("")
    const [armed, setArmed] = useState(false)
    const [reload, setReload] = useState(0)
    const revision = useRef("0")
    const base = useRef<DraftBase | undefined>(undefined)
    const [durable, setDurable] = useState<DraftRecord | null>(null)
    const draft = useRef({ title: "", body: "", changes: 0 })
    const saved = useRef(onSaved)
    const inflight = useRef(false)
    const descriptionId = useId()
    useLayoutEffect(() => registerCloseGuard(`notes:${scope.noteId}`, () =>
        !["dirty", "saving", "conflict", "unavailable"].includes(state)
            || window.confirm("This note has unsaved edits. Close it and discard those edits?")), [scope.noteId, state])
    useEffect(() => { saved.current = onSaved }, [onSaved])
    useEffect(() => () => session.invalidate(), [session])
    useEffect(() => {
        let alive = true
        const load = () => {
            setState("loading")
            void store.getDraft(scope).then(record => {
                if (!alive) return
                if (!record) { setState("missing"); return }
                revision.current = record.localRevision
                setDurable(record)
                if (record.payload.kind !== "public") { setState("locked"); return }
                base.current = record.payload.base
                draft.current = { title: record.payload.title, body: record.payload.body, changes: 0 }
                setTitle(record.payload.title); setBody(record.payload.body); setState("saved"); setNotice("")
            }).catch(() => { if (alive) setState("load-error") })
        }
        load()
        return () => { alive = false }
        // This component is keyed by its complete account/network/note scope.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [store, reload])
    async function save() {
        if (inflight.current || !["dirty", "unavailable"].includes(state)) return
        inflight.current = true; setState("saving")
        const snapshot = { ...draft.current }
        const result = await store.saveDraft(scope, revision.current, { kind: "public", title: snapshot.title, body: snapshot.body, ...(base.current ? { base: base.current } : {}) }, session)
        inflight.current = false
        if (result.status === "session-changed") return
        if (result.status === "saved") {
            revision.current = result.value.localRevision
            setDurable(result.value)
            setState(draft.current.changes === snapshot.changes ? "saved" : "dirty")
            saved.current()
        } else setState(result.status === "conflict" ? "conflict" : "unavailable")
    }
    useEffect(() => {
        if (state !== "dirty") return
        const timer = setTimeout(() => void save(), 600)
        return () => clearTimeout(timer)
        // save snapshots the latest draft ref when the debounce expires.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [title, body, state])
    useEffect(() => {
        const unload = (event: BeforeUnloadEvent) => {
            if (["dirty", "saving", "conflict", "unavailable"].includes(state)) { event.preventDefault(); event.returnValue = "" }
        }
        window.addEventListener("beforeunload", unload)
        return () => window.removeEventListener("beforeunload", unload)
    }, [state])
    function edit(field: "title" | "body", value: string) {
        if (field === "title" && ([...value].length > 80 || new TextEncoder().encode(value).length > 160)) {
            setNotice("The title is limited to 80 characters and 160 UTF-8 bytes.")
            return
        }
        draft.current = { ...draft.current, [field]: value, changes: draft.current.changes + 1 }
        if (field === "title") setTitle(value); else setBody(value)
        setArmed(false)
        if (!["conflict", "saving"].includes(state)) setState("dirty")
    }
    function exportDraft() {
        const url = URL.createObjectURL(new Blob([`# ${title}\n\n${body}`], { type: "text/markdown;charset=utf-8" }))
        const a = document.createElement("a"); a.href = url; a.download = "note.md"; a.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
    async function remove() {
        if (!armed) { setArmed(true); return }
        setState("deleting")
        const result = await store.deleteDraft(scope, revision.current, session)
        if (result.status === "saved") { setTitle(""); setBody(""); draft.current = { title: "", body: "", changes: 0 }; setState("missing"); saved.current() }
        else if (result.status !== "session-changed") { setState("conflict"); setArmed(false) }
    }
    async function keepCopy() {
        const result = await store.saveDraft({ ...scope, noteId: newNoteId() }, "0", { kind: "public", title, body }, session)
        if (result.status === "saved") { saved.current(); setNotice("A separate copy was saved in your library. This draft remains open.") }
        else if (result.status !== "session-changed") setNotice("The copy could not be saved. Export Markdown to keep these edits.")
    }
    async function published(nextBase: DraftBase): Promise<boolean> {
        if (!durable || durable.payload.kind !== "public" || inflight.current || revision.current !== durable.localRevision
            || draft.current.title !== durable.payload.title || draft.current.body !== durable.payload.body) return false
        const snapshot = { ...draft.current }
        inflight.current = true; setState("saving")
        const result = await store.saveDraft(scope, durable.localRevision, { ...durable.payload, base: nextBase }, session)
        inflight.current = false
        if (result.status === "session-changed") return false
        if (result.status !== "saved") { setState(result.status === "conflict" ? "conflict" : "unavailable"); return false }
        base.current = nextBase; revision.current = result.value.localRevision; setDurable(result.value)
        setState(snapshot.changes === draft.current.changes ? "saved" : "dirty"); saved.current()
        setNotice("Publication confirmed. Further edits remain local until you publish them.")
        return true
    }
    if (state === "loading") return <section className="os-notes-welcome" role="status">Loading draft…</section>
    if (state === "deleting") return <section className="os-notes-welcome" role="status">Deleting draft…</section>
    if ((state === "missing" || state === "load-error") && remote) return remote
    if (state === "load-error") return <section className="os-notes-welcome"><p role="alert">This draft could not be read. Its stored copy was kept.</p><button className="os-btn" onClick={() => setReload(v => v + 1)}>Retry loading</button></section>
    if (state === "missing" || state === "locked") return <section className="os-notes-welcome"><h1>{state === "locked" ? "Encrypted note" : "No local draft"}</h1><p>{state === "locked" ? "This encrypted draft is kept on this device. Unlocking is not available in this release." : "There is no draft for this note in the current account’s local workspace."}</p></section>
    return <section className="os-notes-document" aria-label="Draft editor">
        <header className="os-notes-toolbar">
            {(["edit", "split", "preview"] as const).map(mode => <button className="os-btn os-quiet" aria-pressed={view === mode} key={mode} onClick={() => setView(mode)}>{mode === "edit" ? "Write" : mode === "split" ? "Split" : "Read"}</button>)}
            <button className="os-btn os-quiet" onClick={exportDraft}>Export</button>
            <button className="os-btn os-quiet" disabled={state !== "saved"} onClick={() => void remove()}>{armed ? "Delete this draft?" : "Delete"}</button>
            {/* eslint-disable-next-line react-hooks/refs -- The renderer passes this event callback to the action UI; it never invokes it during render. */}
            {state === "saved" && durable && actions?.(durable, published)}
            <span role="status">{state === "saved" ? "Saved on this device" : state === "saving" ? "Saving…" : "Edits not saved"}</span>
        </header>
        {(state === "conflict" || state === "unavailable") && <div className="os-notes-message" role="alert"><p>{state === "conflict" ? "This draft changed in another window. Your edits have not replaced its saved copy." : "Device storage is unavailable. Keep this window open or export your edits."}</p>
            {state === "unavailable" && <button className="os-btn" onClick={() => void save()}>Retry save</button>}
            <button className="os-btn os-quiet" onClick={() => void keepCopy()}>Save a separate copy</button>
            <button className="os-btn os-quiet" onClick={() => { setArmed(false); setReload(v => v + 1) }}>Discard these edits and reload</button>
        </div>}
        <input className="os-notes-title" aria-label="Note title" value={title} maxLength={160} onChange={event => edit("title", event.target.value)} />
        <p id={descriptionId} className="os-notes-hint">Local draft · Stored unencrypted on this device · Markdown · 128 KiB maximum</p>
        {notice && <p className="os-notes-message" role="status">{notice}</p>}
        <div className="os-notes-content" data-view={view}>
            {view !== "preview" && <CodeEditor value={body} onChange={value => edit("body", value)} onLimit={() => setNotice("The body is limited to 128 KiB. This change was not inserted.")} invalid={false} descriptionId={descriptionId} language="text" maxBytes={MAX_NOTE_BODY_BYTES} label="Markdown editor" className="os-notes-code" />}
            {view !== "edit" && <MarkdownPreview body={body} noteId={scope.noteId} />}
        </div>
    </section>
}
