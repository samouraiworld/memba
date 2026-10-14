import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { createDraftSession, type DraftBase, type DraftRecord, type NotesScope, type NotesStore } from "../../../lib/notes/drafts"
import { MAX_NOTE_BODY_BYTES, newNoteId } from "../../../lib/notes/config"
import { saveDraftBounded } from "../../../lib/notes/draftSlot"
import { withTimeout } from "../../../lib/notes/freshness"
import { MarkdownPreview } from "./MarkdownPreview"
import { CodeEditor } from "../terminal/CodeEditor"
import { useNotesPane, useUnsavedText } from "./notesPane"
import { noteExportFilename } from "../../../lib/notes/exportFilename"
import { MAX_PUBLIC_TITLE_BYTES, MAX_PUBLIC_TITLE_CHARACTERS, publicTitleProblem, trimPublicTitle } from "../../../lib/notes/publicFields"
import { draftFlushed, trackDraftFlush } from "../../../lib/notes/draftFlush"
import { NoteBanner, NoteHeader, NoteStatus, type NoteMenuItem } from "./NoteHeader"
import { NoteSkeleton } from "./PublicNote"
import { downloadMarkdown, readPreviewChoice, writePreviewChoice } from "./notesFormat"

type SaveState = "loading" | "saved" | "dirty" | "saving" | "deleting" | "conflict" | "unavailable" | "missing" | "locked" | "load-error"

/** What the editor gives the publishing controls: its saved snapshot and the hooks that act on it. */
export interface EditorActions {
    published(base: DraftBase, fromRevision: string): Promise<boolean>
    /** Shows why the title cannot be published under the title, and puts the caret there. */
    titleProblem(message: string): void
}
/** The published text a draft is based on, when it is known: tells whether the draft holds unpublished changes. */
export interface EditorBasis { revision: string; title: string; body: string }
type Props = {
    store: NotesStore; scope: NotesScope; onSaved(): void; remote?: ReactNode
    /** Publishing controls for the saved snapshot; rendered only while the editor shows exactly that snapshot. */
    actions?(record: DraftRecord, editor: EditorActions): { primary?: ReactNode; banner?: ReactNode }
    basis?: EditorBasis | null
    menu?: NoteMenuItem[]
    /** The page's message (what happened, what next), under the header. */
    banner?: ReactNode
    /** Leaves editing; `discard` deletes this device's draft. */
    onCancel?(current: { title: string; body: string; discard(): Promise<boolean> }): void
}
export function DraftEditor({ store, scope, onSaved, remote, actions, basis, menu = [], banner, onCancel }: Props) {
    const [session] = useState(createDraftSession)
    // Text saves use a lease the unmount never aborts: switching notes or closing Notes must not lose typed text.
    const [keep] = useState(createDraftSession)
    const pane = useNotesPane()
    const [title, setTitle] = useState("")
    const [body, setBody] = useState("")
    const [state, setState] = useState<SaveState>("loading")
    const [preview, setPreview] = useState(readPreviewChoice)
    const [notice, setNotice] = useState("")
    const [titleNotice, setTitleNotice] = useState("")
    const [reload, setReload] = useState(0)
    const revision = useRef("0")
    /** Local revisions this editor loaded or wrote since its last load: the text it holds descends from them. */
    const lineage = useRef(new Set<string>())
    const base = useRef<DraftBase | undefined>(undefined)
    const [durable, setDurable] = useState<DraftRecord | null>(null)
    const draft = useRef({ title: "", body: "", changes: 0 })
    const saved = useRef(onSaved)
    const inflight = useRef(false)
    /** The save in flight: a baseline move and the unmount flush queue behind it. */
    const running = useRef<Promise<unknown> | null>(null)
    /** Edit count already stored, and whether this editor holds an editable public draft. */
    const stored = useRef(0), editable = useRef(false)
    const titleInput = useRef<HTMLInputElement>(null), content = useRef<HTMLDivElement>(null)
    const descriptionId = useId(), titleHintId = useId()
    // Pending edits are stored on unmount; only text that could not be stored keeps the pane and asks before closing.
    useUnsavedText(state === "conflict" || state === "unavailable", "This note has edits that could not be saved on this device. Leave without saving them? Choose Cancel to keep editing.")
    useEffect(() => { saved.current = () => { onSaved(); pane?.saved() } }, [onSaved, pane])
    useLayoutEffect(() => () => {
        session.invalidate()
        // Another note, Explore, Back or closing the window: store what was typed and not yet saved.
        // An editor reopened on this note meanwhile reads its draft only after this save.
        trackDraftFlush(scope, (async () => {
            while (inflight.current && running.current) await running.current.catch(() => {})
            if (!editable.current || inflight.current || draft.current.changes === stored.current) return
            const snapshot = { ...draft.current }
            const result = await Promise.resolve().then(() => store.saveDraft(scope, revision.current, { kind: "public", title: snapshot.title, body: snapshot.body, ...(base.current ? { base: base.current } : {}) }, keep)).catch(() => null)
            if (result?.status === "saved") saved.current()
        })())
        // The editor is keyed by its scope and store; this cleanup runs once, at unmount.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session])
    const focusTitle = !!pane?.focusTitle && state === "saved"
    useEffect(() => {
        if (!focusTitle) return
        // After the click that brought Notes to the front has placed its caret: a click into the text keeps it there.
        const timer = setTimeout(() => {
            if (!content.current?.contains(document.activeElement)) titleInput.current?.focus()
            pane?.titleFocused()
        }, 0)
        return () => clearTimeout(timer)
    }, [focusTitle, pane])
    useEffect(() => {
        let alive = true
        const load = () => {
            setState("loading"); editable.current = false
            let late = false
            void draftFlushed(scope).then(settled => { late = !settled; return store.getDraft(scope) }).then(record => {
                if (!alive) return
                if (!record) { setState("missing"); return }
                revision.current = record.localRevision; lineage.current = new Set([record.localRevision])
                setDurable(record)
                if (record.payload.kind !== "public") { setState("locked"); return }
                base.current = record.payload.base
                draft.current = { title: record.payload.title, body: record.payload.body, changes: 0 }; stored.current = 0; editable.current = true
                setTitle(record.payload.title); setBody(record.payload.body); setState("saved")
                setNotice(late ? "An earlier save of this note is still running on this device. The stored draft was opened; if that save lands later, Notes shows a conflict instead of overwriting either version." : "")
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
        const pending = store.saveDraft(scope, revision.current, { kind: "public", title: snapshot.title, body: snapshot.body, ...(base.current ? { base: base.current } : {}) }, keep)
        running.current = pending
        const result = await pending
        inflight.current = false
        if (result.status === "session-changed") return
        if (result.status === "saved") {
            revision.current = result.value.localRevision; lineage.current.add(result.value.localRevision); stored.current = snapshot.changes
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
        if (field === "title" && ([...value].length > MAX_PUBLIC_TITLE_CHARACTERS || new TextEncoder().encode(value).length > MAX_PUBLIC_TITLE_BYTES)) {
            setTitleNotice(`Too long to publish: shorten it to ${MAX_PUBLIC_TITLE_CHARACTERS} characters.`)
            return
        }
        draft.current = { ...draft.current, [field]: value, changes: draft.current.changes + 1 }
        if (field === "title") { setTitle(value); setTitleNotice("") } else setBody(value)
        if (!["conflict", "saving"].includes(state)) setState("dirty")
    }
    /** Deletes this device's draft once its running save settled; the text in memory goes with it. */
    async function discard(): Promise<boolean> {
        // A save that does not answer ends in "could not be discarded", never in silence.
        // Locked from the confirmation on: nothing typed while a running save settles is deleted unseen.
        setState("deleting")
        if (inflight.current && running.current) {
            const settled = await withTimeout((async () => { while (inflight.current && running.current) await running.current.catch(() => {}) })()).then(() => true, () => false)
            if (!settled) { if (!session.signal.aborted) setState("saving"); return false }
        }
        if (inflight.current || session.signal.aborted) { if (!session.signal.aborted) setState("saving"); return false }
        const result = await store.deleteDraft(scope, revision.current, session)
        if (result.status === "saved") { editable.current = false; setTitle(""); setBody(""); draft.current = { title: "", body: "", changes: 0 }; setState("missing"); saved.current(); pane?.deleted(!!base.current); return true }
        if (result.status !== "session-changed") setState("conflict")
        return false
    }
    function remove() {
        if (window.confirm("Delete this note? It was never published, so it exists only on this device.")) void discard()
    }
    function togglePreview() { const next = !preview; setPreview(next); writePreviewChoice(next) }
    function showTitleProblem(message: string) { setTitleNotice(message); titleInput.current?.focus() }
    async function keepCopy() {
        const result = await store.saveDraft({ ...scope, noteId: newNoteId() }, "0", { kind: "public", title, body }, session)
        if (result.status === "saved") { saved.current(); setNotice("A separate copy was saved in your library. This draft remains open.") }
        else if (result.status !== "session-changed") setNotice("The copy could not be saved. Export Markdown to keep these edits.")
    }
    /**
     * Moves the baseline to a chain revision that already holds local revision `fromRevision`'s text (a confirmed
     * publication) or that the user chose to write over. Later edits here descend from that text, so they stay.
     */
    async function published(nextBase: DraftBase, fromRevision: string): Promise<boolean> {
        if (!lineage.current.has(fromRevision)) return false
        // Queue behind a running save; success is reported only once this baseline is stored. Both waits are bounded,
        // and the baseline only moves once the wait is over: a timeout leaves the draft exactly as it was.
        await withTimeout((async () => { while (inflight.current && running.current) await running.current.catch(() => {}) })())
        if (inflight.current || session.signal.aborted) return false
        base.current = nextBase
        draft.current = { ...draft.current, changes: draft.current.changes + 1 }
        const snapshot = { ...draft.current }
        inflight.current = true; setState("saving")
        const pending = saveDraftBounded(store, scope, revision.current, { kind: "public", title: snapshot.title, body: snapshot.body, base: nextBase }, session)
        running.current = pending
        let result: Awaited<typeof pending>
        try { result = await pending } catch (error) { inflight.current = false; if (!session.signal.aborted) setState("unavailable"); throw error }
        inflight.current = false
        if (result.status === "session-changed") return false
        if (result.status !== "saved") { setState(result.status === "conflict" ? "conflict" : "unavailable"); return false }
        revision.current = result.value.localRevision; lineage.current.add(result.value.localRevision); stored.current = snapshot.changes; setDurable(result.value)
        setState(snapshot.changes === draft.current.changes ? "saved" : "dirty"); saved.current()
        return true
    }
    // An empty title is only reported when publishing; edge spaces are trimmed then.
    const titleProblem = titleNotice || (trimPublicTitle(title) ? publicTitleProblem(title) : null)
    const characters = [...title].length
    if (state === "loading") return <NoteSkeleton label="Loading draft…" />
    if (state === "deleting") return <section className="os-notes-welcome" role="status">Deleting draft…</section>
    if ((state === "missing" || state === "load-error") && remote) return remote
    if (state === "load-error") return <section className="os-notes-welcome"><p role="alert">This draft could not be read. Its stored copy was kept.</p><button className="os-btn" onClick={() => setReload(v => v + 1)}>Retry loading</button></section>
    if (state === "locked") return <section className="os-notes-document"><NoteHeader noteId={scope.noteId} status={<NoteStatus kind="private">Private draft · on this device</NoteStatus>} />
        <p className="os-notes-hint">This private draft is encrypted and kept on this device. Opening private drafts is not available in this version.</p></section>
    if (state === "missing") return <section className="os-notes-welcome"><h1>No local draft</h1><p>There is no draft for this note in the current account’s local workspace.</p></section>
    const ready = state === "saved" && durable
    // eslint-disable-next-line react-hooks/refs -- The controls receive event callbacks; they never invoke them during render.
    const controls = ready ? actions?.(durable, { published, titleProblem: showTitleProblem }) : undefined
    const saving = state === "saved" ? "saved on this device" : state === "saving" ? "saving…" : "edits not saved yet"
    const changed = !basis || trimPublicTitle(title) !== basis.title || body !== basis.body
    // The baseline as last stored: a move only shows once it is durable.
    const baseline = durable?.payload.kind === "public" ? durable.payload.base : undefined
    const status = baseline
        ? <NoteStatus kind={changed ? "changes" : "published"}>{changed ? "Unpublished changes" : "No unpublished changes"} · {saving} · based on revision {baseline.stateRevision}</NoteStatus>
        : <NoteStatus kind="draft">Draft · {saving}</NoteStatus>
    return <section className="os-notes-document os-notes-editing" aria-label="Draft editor">
        <NoteHeader noteId={scope.noteId} status={status} published={!!baseline}
            actions={<>
                <button type="button" role="switch" aria-checked={preview} className="os-notes-switch" onClick={togglePreview}><span aria-hidden="true" />Preview</button>
                {onCancel && <button type="button" className="os-btn os-quiet" onClick={() => onCancel({ title: draft.current.title, body: draft.current.body, discard })}>Cancel</button>}
            </>}
            primary={actions && (controls ? controls.primary : <button type="button" className="os-btn" disabled>Publish</button>)}
            menu={[{ label: "Export", hint: noteExportFilename(title), run: () => downloadMarkdown(title, body) }, ...menu,
                ...!baseline && !basis && state === "saved" ? [{ label: "Delete note…", danger: true, run: remove }] : []]} />
        {(state === "conflict" || state === "unavailable") && <NoteBanner notice={{ tone: "error", text: state === "conflict" ? "This draft changed in another window. Your edits are still here but have not replaced its saved copy." : "This device could not save your edits. They are still here: keep this window open, retry or export them.",
            actions: <>{state === "unavailable" && <button className="os-btn" onClick={() => void save()}>Retry save</button>}
                <button className="os-btn os-quiet" onClick={() => void keepCopy()}>Save a separate copy</button>
                <button className="os-btn os-quiet" onClick={() => setReload(v => v + 1)}>Discard these edits and reload</button></> }} />}
        {banner}{controls?.banner}
        {notice && <NoteBanner notice={{ tone: "info", text: notice }} />}
        <input ref={titleInput} className="os-notes-title" aria-label="Note title" placeholder="Title" value={title} maxLength={160} aria-invalid={!!titleProblem} aria-describedby={titleProblem ? titleHintId : undefined} onChange={event => edit("title", event.target.value)} />
        <div className="os-notes-field">
            {titleProblem ? <span id={titleHintId} className="os-notes-field-error" aria-live="polite">{titleProblem}</span>
                : title !== trimPublicTitle(title) ? <span>Spaces at the start or end are removed for you when you publish.</span> : <span />}
            {characters > MAX_PUBLIC_TITLE_CHARACTERS - 16 && <span>{characters} / {MAX_PUBLIC_TITLE_CHARACTERS}</span>}
        </div>
        <div ref={content} className="os-notes-content" data-view={preview ? "split" : "edit"}>
            <CodeEditor value={body} onChange={value => edit("body", value)} onLimit={() => setNotice("The body is limited to 128 KiB. This change was not inserted.")} invalid={false} descriptionId={descriptionId} language="text" maxBytes={MAX_NOTE_BODY_BYTES} label="Markdown editor" className="os-notes-code" />
            {preview && <MarkdownPreview body={body} noteId={scope.noteId} />}
        </div>
        <p id={descriptionId} className="os-notes-hint">Markdown · saved on this device as you type, unencrypted · nothing is published until you press Publish · 128 KiB maximum</p>
    </section>
}
