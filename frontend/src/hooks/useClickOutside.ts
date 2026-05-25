import { useEffect, type RefObject } from "react"

export function useClickOutside(
    ref: RefObject<HTMLElement | null>,
    onClose: () => void,
): void {
    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                onClose()
            }
        }
        function handleKeyDown(e: KeyboardEvent) {
            if (e.key === "Escape") onClose()
        }
        document.addEventListener("mousedown", handleClick)
        document.addEventListener("keydown", handleKeyDown)
        return () => {
            document.removeEventListener("mousedown", handleClick)
            document.removeEventListener("keydown", handleKeyDown)
        }
    }, [ref, onClose])
}
