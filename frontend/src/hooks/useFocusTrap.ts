import { useEffect, type RefObject } from "react"

const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function getFocusable(container: HTMLElement): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter(el => el.offsetParent !== null)
}

export function useFocusTrap(
    ref: RefObject<HTMLElement | null>,
    active: boolean,
): void {
    useEffect(() => {
        if (!active || !ref.current) return

        const container = ref.current
        const previousFocus = document.activeElement as HTMLElement | null

        const focusable = getFocusable(container)
        if (focusable.length > 0) focusable[0].focus()

        function handleKeyDown(e: KeyboardEvent) {
            if (e.key !== "Tab") return
            const els = getFocusable(container)
            if (els.length === 0) return
            const first = els[0]
            const last = els[els.length - 1]
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault()
                last.focus()
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault()
                first.focus()
            }
        }

        container.addEventListener("keydown", handleKeyDown)

        return () => {
            container.removeEventListener("keydown", handleKeyDown)
            previousFocus?.focus()
        }
    }, [ref, active])
}
