import type { NativeViewProps } from '../../native/types'
import { appSpec } from '../../shell/windows'
import { NOTE_ID } from '../../../lib/notes/config'
import { PublicNotesApp } from './publicNative'
export { NotesSlot as default } from './stageRegistry'

/** The slot follows window chrome; this reader is mounted once by the stable stage. */
export function PublicNotesView(props: NativeViewProps) {
    return <PublicNotesApp session={props.session} section={props.section} fallback={props.fallback}
        onOpenNote={id => { if (NOTE_ID.test(id)) props.push(appSpec('notes', id)) }} />
}
