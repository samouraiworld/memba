import { useEffect, useRef, useCallback, useState, type ReactNode, type RefObject } from "react"

interface BottomSheetProps {
    open: boolean
    onClose: () => void
    returnFocusRef?: RefObject<HTMLElement | null>
    containFocus?: boolean
    children: ReactNode
}

// Drag further than this (px) down and release → dismiss; otherwise snap back.
const DISMISS_THRESHOLD = 100

/**
 * BottomSheet — Slide-up overlay panel for mobile "More" menu.
 * Dialog semantics and Escape dismissal. Preview callers opt into focus containment.
 */
export function BottomSheet({ open, onClose, children, containFocus = false, returnFocusRef }: BottomSheetProps) {
    const contentRef = useRef<HTMLDivElement>(null)

    const closeRef = useRef(onClose)
    useEffect(() => { closeRef.current = onClose }, [onClose])

    useEffect(() => {
        if (!open || !containFocus) return
        const previous = returnFocusRef?.current ?? document.activeElement as HTMLElement | null
        const panel = contentRef.current
        const trap = (event: KeyboardEvent) => {
            if (event.key !== "Tab" || !panel) return
            const controls = Array.from(panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), select:not([disabled]), [tabindex="0"]')).filter(el => el.getClientRects().length > 0)
            const first = controls[0], last = controls[controls.length - 1]
            if (!first) { event.preventDefault(); panel.focus(); return }
            if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) { event.preventDefault(); last.focus() }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
        }
        panel?.focus()
        document.addEventListener("keydown", trap)
        return () => {
            document.removeEventListener("keydown", trap)
            if (previous?.isConnected && (panel?.contains(document.activeElement) || document.activeElement === document.body)) previous.focus()
        }
    }, [open, containFocus, returnFocusRef])

    // Close on Escape
    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.key === "Escape") closeRef.current()
    }, [])

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
                    role={containFocus ? undefined : "button"}
                    aria-hidden={containFocus || undefined}
                    aria-label={containFocus ? undefined : "Drag to dismiss"}
                    style={{ touchAction: "none" }}
                    onPointerDown={onHandlePointerDown}
                    onPointerMove={onHandlePointerMove}
                    onPointerUp={onHandlePointerUp}
                    onPointerCancel={onHandlePointerUp}
                />
                {containFocus && <button type="button" className="pro-sheet-close" onClick={onClose}>Close menu</button>}
                {children}
            </div>
        </div>
    )
}
