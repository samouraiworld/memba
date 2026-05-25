import { useRef, useEffect, useCallback, type ReactNode } from "react"
import { useFocusTrap } from "../hooks/useFocusTrap"

interface Props {
    open: boolean
    onClose: () => void
    labelledBy: string
    children: ReactNode
    className?: string
}

export function AccessibleDialog({ open, onClose, labelledBy, children, className }: Props) {
    const dialogRef = useRef<HTMLDivElement>(null)
    useFocusTrap(dialogRef, open)

    useEffect(() => {
        if (!open) return
        const prev = document.body.style.overflow
        document.body.style.overflow = "hidden"
        return () => { document.body.style.overflow = prev }
    }, [open])

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === "Escape") {
            e.stopPropagation()
            onClose()
        }
    }, [onClose])

    const handleBackdropClick = useCallback((e: React.MouseEvent) => {
        if (e.target === e.currentTarget) onClose()
    }, [onClose])

    if (!open) return null

    return (
        <div
            className={className}
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            ref={dialogRef}
            onKeyDown={handleKeyDown}
            onClick={handleBackdropClick}
        >
            {children}
        </div>
    )
}
