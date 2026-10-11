import { useEffect } from 'react'
import type { NativeViewProps } from '../../native/types'
import { appSpec } from '../../shell/windows'
import { NOTE_ID } from '../../../lib/notes/config'
import { announceNotesFocus } from '../../../lib/notes/freshness'
import { PublicNotesApp } from './publicNative'
export { NotesSlot as default } from './stageRegistry'

/** The slot follows window chrome; this reader is mounted once by the stable stage. */
export function PublicNotesView(props: NativeViewProps) {
    const chainId = props.session.network?.chainId, section = props.section
    // Bringing a Notes window to the front re-checks its note on chain (throttled per view).
    useEffect(() => { if (props.active) announceNotesFocus(chainId, section && NOTE_ID.test(section) ? section : undefined) }, [props.active, chainId, section])
    return <PublicNotesApp session={props.session} section={props.section} fallback={props.fallback}
        onOpenNote={id => { if (NOTE_ID.test(id)) props.push(appSpec('notes', id)) }} onShowList={() => props.push(appSpec('notes'))} active={props.active} />
}
