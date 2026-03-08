/**
 * NewMessagesToast — "New messages" indicator for channel polling (v2.5b).
 *
 * Teal-themed inline toast positioned at top of content area.
 * Click to scroll down and dismiss, auto-dismiss after 8s.
 *
 * @module components/ui/NewMessagesToast
 */

import { useEffect, useRef, useState } from "react"

interface NewMessagesToastProps {
    /** Whether the toast is visible. */
    visible: boolean
    /** Called when user clicks or toast auto-dismisses. */
    onDismiss: () => void
}

const AUTO_DISMISS_MS = 8_000

export function NewMessagesToast({ visible, onDismiss }: NewMessagesToastProps) {
    const [hiding, setHiding] = useState(false)
    const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    // C3 fix: ref for onDismiss to prevent stale closure in setTimeout
    const onDismissRef = useRef(onDismiss)
    onDismissRef.current = onDismiss

    const startDismiss = () => {
        setHiding(true)
        dismissTimerRef.current = setTimeout(() => onDismissRef.current(), 300)
    }

    // Auto-dismiss after 8s
    useEffect(() => {
        if (!visible) { setHiding(false); return }
        autoTimerRef.current = setTimeout(startDismiss, AUTO_DISMISS_MS)
        return () => {
            if (autoTimerRef.current) clearTimeout(autoTimerRef.current)
            if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible])

    if (!visible && !hiding) return null

    const handleClick = () => {
        if (autoTimerRef.current) clearTimeout(autoTimerRef.current)
        startDismiss()
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
                transition: "opacity 0.3s, transform 0.3s",
                opacity: hiding ? 0 : 1,
                transform: hiding ? "translateY(-8px)" : "translateY(0)",
                marginBottom: 12,
            }}
        >
            <span>↓</span>
            <span>New messages</span>
        </button>
    )
}
