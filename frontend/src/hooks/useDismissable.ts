import { useEffect, type RefObject } from "react"

/**
 * useDismissable — close an open popover/menu on Escape or a pointer-down outside
 * `ref`. No-op while `open` is false (no listeners attached). Pass a stable
 * `onClose` (e.g. a `useCallback`) so the effect doesn't re-subscribe each render.
 *
 * Uses `pointerdown` (not `click`) so the dismissal fires before a click's focus
 * change, and covers touch + mouse in one listener.
 *
 * @param ref     the element whose bounds define "inside"
 * @param open    whether the dismissable surface is currently open
 * @param onClose called on Escape or an outside pointer-down
 */
export function useDismissable(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void): void {
    useEffect(() => {
        if (!open) return
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose()
        }
        const onDown = (e: PointerEvent) => {
            const el = ref.current
            if (el && !el.contains(e.target as Node)) onClose()
        }
        document.addEventListener("keydown", onKey)
        document.addEventListener("pointerdown", onDown)
        return () => {
            document.removeEventListener("keydown", onKey)
            document.removeEventListener("pointerdown", onDown)
        }
    }, [ref, open, onClose])
}
