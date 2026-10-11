import { createContext, useContext, useEffect, useId, useLayoutEffect } from 'react'
import { registerCloseGuard } from '../../shell/closeGuards'

/** The single Notes window (windows.ts `appSpec('notes')`): its close guards live under this key. */
export const NOTES_WINDOW_KEY = 'app:notes'

/** What a note pane tells the workspace around it, without threading props through the note components. */
export interface NotesPane {
    /** A part of the pane holds text that exists only in memory: keep the pane mounted while it does. */
    hold(source: string, unsaved: boolean): void
    /** A local draft was stored (the list re-reads it). */
    saved(): void
    /** The local draft was deleted; `published` when a chain note remains. */
    deleted(published: boolean): void
    /** The caret should start in the title (New note or first open, and only while Notes is in front). */
    readonly focusTitle: boolean
    titleFocused(): void
}
/** Hold sources for a publication being verified: the pane stays mounted, but nothing is unsaved. */
export const PUBLISHING = 'publishing:'
export const NotesPaneContext = createContext<NotesPane | null>(null)
export function useNotesPane(): NotesPane | null { return useContext(NotesPaneContext) }

/** Text not stored anywhere: never dropped silently by switching notes, and asked about before the window closes. */
export function useUnsavedText(unsaved: boolean, question: string): void {
    const pane = useNotesPane(), source = useId()
    useEffect(() => { pane?.hold(source, unsaved) }, [pane, source, unsaved])
    useEffect(() => () => pane?.hold(source, false), [pane, source])
    useLayoutEffect(() => unsaved ? registerCloseGuard(NOTES_WINDOW_KEY, () => window.confirm(question)) : undefined, [unsaved, question])
}
