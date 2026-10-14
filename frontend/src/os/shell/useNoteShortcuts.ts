import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { notesDeployment } from "../../lib/notes/config"
import { onNoteChange, readFresh } from "../../lib/notes/freshness"
import { getRpcUrlsInOrder } from "../../lib/rpcFallback"
import { forgetNoteShortcut, readNoteShortcuts, shortcutFromChain, writeNoteShortcuts, type NoteShortcut } from "./noteShortcuts"

type Options = { chainId: string; owner: string | null | undefined; ids: readonly string[]; enabled: boolean }
/** Per desk: notes read once, notes with an announced change still to read, and the newest revision seen of each. */
type Reads = { scope: string; done: Set<string>; pending: Set<string>; newest: Map<string, bigint> }
const reads = (scope: string): Reads => ({ scope, done: new Set(), pending: new Set(), newest: new Map() })
function revision(value: string | null | undefined): bigint | null {
    try { return value && /^\d{1,20}$/.test(value) ? BigInt(value) : null } catch { return null }
}

/**
 * Labels for the note shortcuts on this desk: cached titles at once, then each
 * shortcut's metadata read once from the chain per desk, and again when a
 * confirmed change to that note is announced (a publication, a rename). Private
 * notes get a lock and no title; unknown or deleted notes keep their last known label.
 */
export function useNoteShortcuts({ chainId, owner, ids, enabled }: Options) {
    const scope = JSON.stringify([chainId, owner])
    const idsKey = [...new Set(ids)].sort().join(",")
    const [state, setState] = useState(() => ({ scope, facts: owner === undefined ? {} : readNoteShortcuts(chainId, owner) }))
    if (state.scope !== scope) setState({ scope, facts: owner === undefined ? {} : readNoteShortcuts(chainId, owner) })
    const read = useRef<Reads>(reads(scope))
    const [changes, setChanges] = useState(0)
    useEffect(() => onNoteChange((change) => {
        if (owner === undefined || change.chainId !== chainId || !idsKey.split(",").includes(change.noteId)) return
        if (read.current.scope !== scope) read.current = reads(scope)
        const { pending, newest } = read.current, id = change.noteId, announced = revision(change.stateRevision)
        if (announced !== null && announced > (newest.get(id) ?? -1n)) newest.set(id, announced)
        pending.add(id)
        // An announced change comes from a public note flow: the private mark no longer stops a read on the next visit.
        const cached = readNoteShortcuts(chainId, owner)
        if (cached[id]?.private) writeNoteShortcuts(chainId, owner, { ...cached, [id]: { title: null, private: false, missing: cached[id].missing } }, Object.keys(cached))
        setChanges((n) => n + 1)
    }), [chainId, owner, scope, idsKey])
    useEffect(() => {
        if (!enabled || owner === undefined || !idsKey) return
        const deployment = notesDeployment(chainId)
        if (!deployment) return
        if (read.current.scope !== scope) read.current = reads(scope)
        const { done, pending, newest } = read.current
        // A note already known to be private is never read again from here: that would tie this
        // browser to private note ids at the RPC on every desktop load. Only its own announced
        // change (made in this page) reads it again, so a published note takes its public title.
        const cached = readNoteShortcuts(chainId, owner)
        const wanted = idsKey.split(",").filter((id) => pending.has(id) || (!done.has(id) && !cached[id]?.private))
        if (!wanted.length) return
        let alive = true
        void (async () => {
            const { NotesReadClient } = await import("../../lib/notes/chain/client")
            if (!alive) return
            let client
            try {
                client = new NotesReadClient({ chainId, deployment, rpcUrls: getRpcUrlsInOrder(), isCurrent: () => alive })
            } catch { return }
            for (const id of wanted) {
                // Never older than what this desk already saw: an announced revision, or a newer answer, waits
                // out a lagging node, and an answer still older after the retries is not shown or stored.
                const floor = newest.get(id)
                let note
                try { note = await readFresh(() => client.noteMetadata(id), (value) => value?.stateRevision ?? null, floor?.toString(), () => alive) } catch { if (!alive) return; continue }
                if (!alive || note === undefined) return
                const seen = revision(note?.stateRevision)
                if (floor !== undefined && (seen === null || seen < floor)) {
                    // A pending change stays pending, so the next announcement or visit reads it again.
                    if (!pending.has(id)) done.add(id)
                    continue
                }
                done.add(id); pending.delete(id)
                if (seen !== null) newest.set(id, seen)
                const latest = readNoteShortcuts(chainId, owner)
                const info: NoteShortcut = shortcutFromChain(note, latest[id])
                writeNoteShortcuts(chainId, owner, { ...latest, [id]: info }, idsKey.split(","))
                setState((s) => (s.scope === scope ? { scope, facts: { ...s.facts, [id]: info } } : s))
            }
        })()
        return () => { alive = false }
    }, [enabled, chainId, owner, scope, idsKey, changes])
    // A removed shortcut's facts are dropped at once, and again once the desk confirms the removal:
    // a featured desk confirms asynchronously, and a read in flight may have cached the title meanwhile.
    const leaving = useRef({ scope, ids: new Set<string>() })
    const forget = useCallback((id: string) => {
        if (owner === undefined) return
        forgetNoteShortcut(chainId, owner, id)
        if (leaving.current.scope !== scope) leaving.current = { scope, ids: new Set() }
        leaving.current.ids.add(id)
    }, [chainId, owner, scope])
    useEffect(() => {
        if (owner === undefined || leaving.current.scope !== scope || !leaving.current.ids.size) return
        const shown = new Set(idsKey ? idsKey.split(",") : [])
        for (const id of [...leaving.current.ids]) {
            if (shown.has(id)) continue
            forgetNoteShortcut(chainId, owner, id); leaving.current.ids.delete(id)
        }
    }, [chainId, owner, scope, idsKey])
    const shortcuts = useMemo(() => {
        const facts: Readonly<Record<string, NoteShortcut>> = state.scope === scope ? state.facts : {}
        const labels: Record<string, string> = {}
        const privateNotes = new Set<string>()
        for (const id of idsKey ? idsKey.split(",") : []) {
            const info = facts[id]
            if (info?.title) labels[id] = info.title
            if (info?.private) privateNotes.add(id)
        }
        return { labels, privateNotes: privateNotes as ReadonlySet<string> }
    }, [state, scope, idsKey])
    return useMemo(() => ({ ...shortcuts, forget }), [shortcuts, forget])
}
