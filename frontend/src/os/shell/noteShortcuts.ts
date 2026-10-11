/**
 * What a note shortcut on the desktop shows: the note's public title read from
 * the chain (cached per network and wallet, like the desk), a lock for a
 * private note, and "Note" when nothing is known. A private note's title is
 * never stored here: its plaintext only exists inside an unlocked Notes view.
 *
 * @module os/shell/noteShortcuts
 */
import { NOTE_ID } from "../../lib/notes/config"
import { publicText, type ChainNote } from "../../lib/notes/chain/schema"

export interface NoteShortcut { title: string | null; private: boolean; missing: boolean }
type Cached = { t?: string; p?: 1; m?: 1 }

const MAX_TITLE = 80

export function noteShortcutCacheKey(chainId: string, owner: string | null): string {
    return `memba_os_note_shortcuts:v1:${chainId}:${owner || "guest"}`
}

/** A note's shortcut facts from its chain metadata; an absent or deleted note keeps its last known label. */
export function shortcutFromChain(note: ChainNote | null, previous?: NoteShortcut): NoteShortcut {
    // A note taken down by moderation never shows or keeps its title.
    if (note?.moderatorHidden) return { title: null, private: false, missing: true }
    if (!note || note.deleted) return { title: previous?.title ?? null, private: previous?.private ?? false, missing: true }
    if (note.mode < 3) return { title: null, private: true, missing: false }
    let title = previous?.title ?? null
    try { title = publicText(note.title, true) } catch { /* keep the last readable title */ }
    return { title, private: false, missing: false }
}

/** The shortcut's accessible name says it is a note shortcut, and whether the note is private. */
export function noteShortcutName(title: string | undefined, isPrivate: boolean): string {
    return `${isPrivate ? "Private note shortcut" : "Note shortcut"}${title ? `: ${title}` : ""}`
}

export function noteShortcutLabel(featured: string | undefined, info: NoteShortcut | undefined): string {
    return featured ?? info?.title ?? "Note"
}

export function readNoteShortcuts(chainId: string, owner: string | null): Record<string, NoteShortcut> {
    try {
        const raw = localStorage.getItem(noteShortcutCacheKey(chainId, owner))
        if (raw === null) return {}
        const parsed: unknown = JSON.parse(raw)
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
        const out: Record<string, NoteShortcut> = {}
        for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
            if (!NOTE_ID.test(id) || !value || typeof value !== "object" || Array.isArray(value)) return {}
            const { t, p, m } = value as Cached
            if ((t !== undefined && (typeof t !== "string" || t.length === 0 || [...t].length > MAX_TITLE)) || (p !== undefined && p !== 1) || (m !== undefined && m !== 1)) return {}
            out[id] = { title: p ? null : t ?? null, private: p === 1, missing: m === 1 }
        }
        return out
    } catch {
        return {}
    }
}

/** Drops one shortcut's cached facts: an unpinned note leaves nothing behind. */
export function forgetNoteShortcut(chainId: string, owner: string | null, noteId: string): void {
    const facts = readNoteShortcuts(chainId, owner)
    if (!(noteId in facts)) return
    writeNoteShortcuts(chainId, owner, facts, Object.keys(facts).filter((id) => id !== noteId))
}

/** Keeps the facts for the shortcuts still on the desk; private titles are never written. */
export function writeNoteShortcuts(chainId: string, owner: string | null, facts: Readonly<Record<string, NoteShortcut>>, keep: readonly string[]): void {
    const out: Record<string, Cached> = {}
    for (const id of keep) {
        const info = facts[id]
        if (!info || !NOTE_ID.test(id)) continue
        out[id] = { ...(info.private ? { p: 1 as const } : info.title ? { t: info.title } : {}), ...(info.missing ? { m: 1 as const } : {}) }
    }
    try {
        localStorage.setItem(noteShortcutCacheKey(chainId, owner), JSON.stringify(out))
    } catch {
        // Storage refused: labels are read from the chain again next visit.
    }
}
