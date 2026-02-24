import { useEffect, useState, useRef, useCallback } from "react"

interface ErrorToastProps {
    message: string | null
    duration?: number
    onDismiss?: () => void
}

export function ErrorToast({ message, duration = 5000, onDismiss }: ErrorToastProps) {
    const [hiding, setHiding] = useState(false)
    const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const lastMessageRef = useRef<string | null>(null)

    const dismiss = useCallback(() => {
        setHiding(true)
        dismissTimerRef.current = setTimeout(() => {
            setHiding(false)
            onDismiss?.()
        }, 300)
    }, [onDismiss])

    // Auto-dismiss after duration. P2-C: Skip if same message already being shown.
    useEffect(() => {
        if (!message || message === lastMessageRef.current) return
        lastMessageRef.current = message
        autoTimerRef.current = setTimeout(dismiss, duration)
        return () => {
            if (autoTimerRef.current) clearTimeout(autoTimerRef.current)
            if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current)
        }
    }, [message, duration, dismiss])

    // Derive visibility from props — no setState needed.
    if (!message) return null

    return (
        <div
            style={{
                position: "fixed",
                bottom: 24,
                right: 24,
                zIndex: 1000,
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 20px",
                borderRadius: 10,
                background: "rgba(255,71,87,0.12)",
                border: "1px solid rgba(255,71,87,0.25)",
                color: "#ff4757",
                fontSize: 13,
                fontFamily: "JetBrains Mono, monospace",
                fontWeight: 500,
                maxWidth: 420,
                backdropFilter: "blur(12px)",
                transition: "opacity 0.3s, transform 0.3s",
                opacity: hiding ? 0 : 1,
                transform: hiding ? "translateY(8px)" : "translateY(0)",
            }}
        >
            <span style={{ fontSize: 16, flexShrink: 0 }}>⚠️</span>
            <span style={{ flex: 1 }}>{message}</span>
            <button
                onClick={dismiss}
                style={{
                    background: "none",
                    border: "none",
                    color: "#ff4757",
                    fontSize: 16,
                    cursor: "pointer",
                    padding: 0,
                    lineHeight: 1,
                    flexShrink: 0,
                    opacity: 0.6,
                }}
            >
                ×
            </button>
        </div>
    )
}
