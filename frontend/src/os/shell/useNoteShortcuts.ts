import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { notesDeployment } from "../../lib/notes/config"
import { getRpcUrlsInOrder } from "../../lib/rpcFallback"
import { forgetNoteShortcut, readNoteShortcuts, shortcutFromChain, writeNoteShortcuts, type NoteShortcut } from "./noteShortcuts"

type Options = { chainId: string; owner: string | null | undefined; ids: readonly string[]; enabled: boolean }

/**
 * Labels for the note shortcuts on this desk: cached titles at once, then each
 * shortcut's metadata read once from the chain per desk. Private notes get a
 * lock and no title; unknown or deleted notes keep their last known label.
 */
export function useNoteShortcuts({ chainId, owner, ids, enabled }: Options) {
    const scope = JSON.stringify([chainId, owner])
    const idsKey = [...new Set(ids)].sort().join(",")
    const [state, setState] = useState(() => ({ scope, facts: owner === undefined ? {} : readNoteShortcuts(chainId, owner) }))
    if (state.scope !== scope) setState({ scope, facts: owner === undefined ? {} : readNoteShortcuts(chainId, owner) })
    const read = useRef({ scope, done: new Set<string>() })
    useEffect(() => {
        if (!enabled || owner === undefined || !idsKey) return
        const deployment = notesDeployment(chainId)
        if (!deployment) return
        if (read.current.scope !== scope) read.current = { scope, done: new Set() }
        const done = read.current.done
        // A note already known to be private is never read again from here: that would tie this
        // browser to private note ids at the RPC on every desktop load.
        const cached = readNoteShortcuts(chainId, owner)
        const wanted = idsKey.split(",").filter((id) => !done.has(id) && !cached[id]?.private)
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
                let note
                try { note = await client.noteMetadata(id) } catch { if (!alive) return; continue }
                if (!alive) return
                done.add(id)
                const latest = readNoteShortcuts(chainId, owner)
                const info: NoteShortcut = shortcutFromChain(note, latest[id])
                writeNoteShortcuts(chainId, owner, { ...latest, [id]: info }, idsKey.split(","))
                setState((s) => (s.scope === scope ? { scope, facts: { ...s.facts, [id]: info } } : s))
            }
        })()
        return () => { alive = false }
    }, [enabled, chainId, owner, scope, idsKey])
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
