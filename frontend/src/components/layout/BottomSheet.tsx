import { useEffect, useRef, useCallback, useState, type ReactNode } from "react"

interface BottomSheetProps {
    open: boolean
    onClose: () => void
    children: ReactNode
}

// Drag further than this (px) down and release → dismiss; otherwise snap back.
const DISMISS_THRESHOLD = 100

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

    // ── Swipe-to-dismiss ──────────────────────────────────
    // Drag the grabber down: the panel follows the finger; release past the
    // threshold to dismiss, otherwise it snaps back to rest. The decision reads
    // a ref (not the dragY state) so pointerup is never stale. Every drag both
    // starts and ends at 0 (pointerdown resets, pointerup/cancel resets), so no
    // reset effect is needed — and the transform is gated on `open` so a stale
    // offset can never bleed into the closed (CSS-driven) slide-out.
    const [dragY, setDragY] = useState(0)
    const dragStartRef = useRef<number | null>(null)
    const dragOffsetRef = useRef(0)

    const onHandlePointerDown = useCallback((e: React.PointerEvent) => {
        dragStartRef.current = e.clientY
        dragOffsetRef.current = 0
        setDragY(0)
        e.currentTarget.setPointerCapture?.(e.pointerId)
    }, [])

    const onHandlePointerMove = useCallback((e: React.PointerEvent) => {
        if (dragStartRef.current === null) return
        const offset = Math.max(0, e.clientY - dragStartRef.current)
        dragOffsetRef.current = offset
        setDragY(offset)
    }, [])

    const onHandlePointerUp = useCallback(() => {
        if (dragStartRef.current === null) return
        dragStartRef.current = null
        const shouldDismiss = dragOffsetRef.current > DISMISS_THRESHOLD
        dragOffsetRef.current = 0
        setDragY(0)
        if (shouldDismiss) onClose()
    }, [onClose])

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
                style={open && dragY ? { transform: `translateY(${dragY}px)`, transition: "none" } : undefined}
            >
                {/* Grabber — drag down to dismiss. `touch-action: none` keeps the
                    gesture from scrolling the page underneath. */}
                <div
                    className="k-bottom-sheet-handle"
                    data-testid="bottom-sheet-handle"
                    role="button"
                    aria-label="Drag to dismiss"
                    style={{ touchAction: "none" }}
                    onPointerDown={onHandlePointerDown}
                    onPointerMove={onHandlePointerMove}
                    onPointerUp={onHandlePointerUp}
                    onPointerCancel={onHandlePointerUp}
                />
                {children}
            </div>
        </div>
    )
}
