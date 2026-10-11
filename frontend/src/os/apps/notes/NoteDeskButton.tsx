import { NOTE_ID } from "../../../lib/notes/config"
import { useDeskShortcuts } from "../../shell/deskShortcuts"

/**
 * "Add to Desktop" / "Remove from Desktop" for one note, through the shell's desk.
 * Self-contained so the Notes window layout can move it (e.g. into a ⋯ or row menu).
 */
export function NoteDeskButton({ noteId }: { noteId: string }) {
    const desk = useDeskShortcuts()
    if (!desk || !NOTE_ID.test(noteId)) return null
    const item = { ty: "note" as const, ref: noteId }
    const onDesk = desk.isPinned(item)
    return <button type="button" className="os-btn os-quiet" onClick={() => onDesk ? desk.unpin(item) : desk.pin(item)}>
        {onDesk ? "Remove from Desktop" : "Add to Desktop"}
    </button>
}
