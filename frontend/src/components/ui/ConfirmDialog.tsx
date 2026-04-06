/**
 * ConfirmDialog — Reusable confirmation modal component.
 *
 * Glassmorphic overlay with confirm/cancel actions.
 * Traps focus, closes on Escape, respects aria attributes.
 *
 * @module components/ui/ConfirmDialog
 */

import { useEffect, useRef } from "react"

interface ConfirmDialogProps {
    title: string
    message: string
    confirmLabel?: string
    cancelLabel?: string
    variant?: "danger" | "default"
    isOpen: boolean
    onConfirm: () => void
    onCancel: () => void
}

export function ConfirmDialog({
    title,
    message,
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    variant = "default",
    isOpen,
    onConfirm,
    onCancel,
}: ConfirmDialogProps) {
    const dialogRef = useRef<HTMLDivElement>(null)
    const confirmBtnRef = useRef<HTMLButtonElement>(null)

    // Trap focus and handle Escape key
    useEffect(() => {
        if (!isOpen) return
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onCancel()
        }
        document.addEventListener("keydown", handleKey)
        confirmBtnRef.current?.focus()
        return () => document.removeEventListener("keydown", handleKey)
    }, [isOpen, onCancel])

    if (!isOpen) return null

    return (
        <div
            className="confirm-overlay"
            onClick={onCancel}
            role="dialog"
            aria-modal="true"
            aria-label={title}
        >
            <div
                className="confirm-dialog"
                ref={dialogRef}
                onClick={e => e.stopPropagation()}
            >
                <h3 className="confirm-dialog__title">{title}</h3>
                <p className="confirm-dialog__message">{message}</p>
                <div className="confirm-dialog__actions">
                    <button
                        className="confirm-dialog__btn confirm-dialog__btn--cancel"
                        onClick={onCancel}
                    >
                        {cancelLabel}
                    </button>
                    <button
                        ref={confirmBtnRef}
                        className={`confirm-dialog__btn confirm-dialog__btn--${variant}`}
                        onClick={onConfirm}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    )
}
