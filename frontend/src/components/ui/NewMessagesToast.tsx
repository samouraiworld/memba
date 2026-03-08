/**
 * NewMessagesToast — "New messages" indicator for channel polling (v2.5b).
 *
 * Teal-themed inline toast positioned at top of content area.
 * Click to dismiss, auto-dismiss after 8s.
 * Uses CSS animation-only approach to avoid setState-in-effect lint issues.
 *
 * @module components/ui/NewMessagesToast
 */

import { useEffect, useRef } from "react"

interface NewMessagesToastProps {
    /** Whether the toast is visible. */
    visible: boolean
    /** Called when user clicks or toast auto-dismisses. */
    onDismiss: () => void
}

const AUTO_DISMISS_MS = 8_000

export function NewMessagesToast({ visible, onDismiss }: NewMessagesToastProps) {
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    // C3 fix: ref for onDismiss to prevent stale closure in setTimeout
    const onDismissRef = useRef(onDismiss)
    useEffect(() => { onDismissRef.current = onDismiss }, [onDismiss])

    // Auto-dismiss after 8s — only calls onDismiss (no local setState)
    useEffect(() => {
        if (!visible) return
        timerRef.current = setTimeout(() => onDismissRef.current(), AUTO_DISMISS_MS)
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current)
        }
    }, [visible])

    if (!visible) return null

    const handleClick = () => {
        if (timerRef.current) clearTimeout(timerRef.current)
        onDismiss()
    }

    return (
        <button
            id="new-messages-toast"
            onClick={handleClick}
            aria-label="New messages available, click to scroll"
            style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                width: "100%",
                padding: "8px 16px",
                borderRadius: 8,
                border: "1px solid rgba(0, 212, 170, 0.2)",
                background: "rgba(0, 212, 170, 0.06)",
                color: "#00d4aa",
                fontSize: 12,
                fontWeight: 600,
                fontFamily: "JetBrains Mono, monospace",
                cursor: "pointer",
                marginBottom: 12,
                animation: "fade-in 0.3s ease",
            }}
        >
            <span>↓</span>
            <span>New messages</span>
        </button>
    )
}
