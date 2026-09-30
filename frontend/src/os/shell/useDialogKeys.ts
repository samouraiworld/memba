/**
 * The keyboard rules every Memba OS dialog shares. Tab stays in the dialog and
 * in the controls Memba keeps reachable above any dialog (marked
 * data-os-over-dialog: a live meeting's Leave), and Escape pressed on one of
 * those still closes the dialog. Registered on the document: those controls
 * sit outside the dialog, so its own key handler never sees them.
 *
 * @module os/shell/useDialogKeys
 */
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react"

const overDialog = () => Array.from(document.querySelectorAll<HTMLElement>(".memba-os [data-os-over-dialog]"))
    .filter((el) => !el.closest("[inert]") && (el.checkVisibility?.() ?? true))

/**
 * @param stops    selector of the dialog's own Tab stops, in order
 * @param onEscape closes the dialog; called only for Escape on a control above it (inside, the dialog's own handler decides)
 */
export function useDialogKeys(dialog: RefObject<HTMLElement | null>, open: boolean, stops: string, onEscape?: () => void): void {
    const escape = useRef(onEscape)
    useLayoutEffect(() => { escape.current = onEscape })
    useEffect(() => {
        if (!open) return
        const onKey = (e: KeyboardEvent) => {
            const el = dialog.current
            if (!el || (e.key !== "Tab" && e.key !== "Escape")) return
            const over = overDialog()
            const active = document.activeElement as HTMLElement | null
            if (e.key === "Escape") {
                if (active && over.includes(active) && escape.current) { e.preventDefault(); escape.current() }
                return
            }
            const inside = Array.from(el.querySelectorAll<HTMLElement>(stops))
            const own = inside.length ? inside : [el]
            const ring = [...own, ...over]
            let at = active ? ring.indexOf(active) : -1
            if (at < 0) {
                // On the dialog itself, which holds focus when it opens: Shift+Tab goes to the end;
                // Tab reaches the first stop by itself.
                if (active !== el || !e.shiftKey) return
                at = 0
            }
            // Between the dialog's own controls the browser's order is already right.
            if (e.shiftKey ? at > 0 && at < own.length : at < own.length - 1) return
            e.preventDefault()
            ring[(at + (e.shiftKey ? ring.length - 1 : 1)) % ring.length].focus()
        }
        document.addEventListener("keydown", onKey)
        return () => document.removeEventListener("keydown", onKey)
    }, [dialog, open, stops])
}
