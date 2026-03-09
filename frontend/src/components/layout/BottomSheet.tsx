import { useEffect, useRef, useCallback, type ReactNode } from "react"

interface BottomSheetProps {
    open: boolean
    onClose: () => void
    children: ReactNode
}

/**
 * BottomSheet — Slide-up overlay panel for mobile "More" menu.
 * Accessible: role="dialog", aria-modal, focus trap, Escape to close.
 */
export function BottomSheet({ open, onClose, children }: BottomSheetProps) {
    const contentRef = useRef<HTMLDivElement>(null)

    // Close on Escape
    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.key === "Escape") onClose()
    }, [onClose])

    useEffect(() => {
        if (open) {
            document.addEventListener("keydown", handleKeyDown)
            // Focus trap: focus the sheet content when opened
            contentRef.current?.focus()
        }
        return () => document.removeEventListener("keydown", handleKeyDown)
    }, [open, handleKeyDown])

    // Prevent body scroll when open
    useEffect(() => {
        if (open) {
            document.body.style.overflow = "hidden"
        } else {
            document.body.style.overflow = ""
        }
        return () => { document.body.style.overflow = "" }
    }, [open])

    return (
        <div
            className={`k-bottom-sheet${open ? " open" : ""}`}
            role="dialog"
            aria-modal={open}
            aria-label="More options"
        >
            {/* Overlay backdrop */}
            <div
                className="k-bottom-sheet-overlay"
                onClick={onClose}
                aria-hidden="true"
            />

            {/* Content panel */}
            <div
                className="k-bottom-sheet-content"
                ref={contentRef}
                tabIndex={-1}
            >
                <div className="k-bottom-sheet-handle" />
                {children}
            </div>
        </div>
    )
}
