import { NOTE_ID } from "../../../lib/notes/config"
import { useDeskShortcuts } from "../../shell/deskShortcuts"

/**
 * "Add to Desktop" / "Remove from Desktop" for one note, through the shell's desk.
 * Self-contained so the Notes window layout can move it (e.g. into a ⋯ or row menu).
 */
export function NoteDeskButton({ noteId, role, className = "os-btn os-quiet", onDone }: { noteId: string; role?: "menuitem"; className?: string; onDone?(): void }) {
    const desk = useDeskShortcuts()
    if (!desk || !NOTE_ID.test(noteId)) return null
    const item = { ty: "note" as const, ref: noteId }
    const onDesk = desk.isPinned(item)
    return <button type="button" role={role} className={className} onClick={() => { if (onDesk) desk.unpin(item); else desk.pin(item); onDone?.() }}>
        {onDesk ? "Remove from Desktop" : "Add to Desktop"}
    </button>
}
