import { useEffect, useState, useRef, useCallback, useMemo } from "react"
import { mapError, type UserError } from "../../lib/errorMap"

interface ErrorToastProps {
    message: string | null
    duration?: number
    onDismiss?: () => void
    onRetry?: () => void
}

export function ErrorToast({ message, duration = 6000, onDismiss, onRetry }: ErrorToastProps) {
    const [hiding, setHiding] = useState(false)
    const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const lastMessageRef = useRef<string | null>(null)

    // Derive mapped error from message (no side-effect needed)
    const mapped: UserError | null = useMemo(
        () => (message ? mapError(message) : null),
        [message],
    )

    const dismiss = useCallback(() => {
        setHiding(true)
        dismissTimerRef.current = setTimeout(() => {
            setHiding(false)
            onDismiss?.()
        }, 300)
    }, [onDismiss])

    // Auto-dismiss after duration. Skip if same message already being shown.
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
    if (!message || !mapped) return null

    return (
        <div
            role="alert"
            aria-live="assertive"
            style={{
                position: "fixed",
                bottom: 24,
                right: 24,
                zIndex: 1000,
                display: "flex",
                flexDirection: "column",
                gap: 8,
                padding: "14px 20px",
                borderRadius: 10,
                background: "rgba(255,71,87,0.12)",
                border: "1px solid rgba(255,71,87,0.25)",
                color: "#ff4757",
                fontSize: 13,
                fontFamily: "JetBrains Mono, monospace",
                maxWidth: 420,
                backdropFilter: "blur(12px)",
                transition: "opacity 0.3s, transform 0.3s",
                opacity: hiding ? 0 : 1,
                transform: hiding ? "translateY(8px)" : "translateY(0)",
            }}
        >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 16, flexShrink: 0 }}>⚠️</span>
                <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{mapped.title}</div>
                    <div style={{ fontSize: 11, color: "#cc3d4a", marginTop: 2, lineHeight: 1.4 }}>
                        {mapped.message}
                    </div>
                </div>
                <button
                    onClick={dismiss}
                    aria-label="Dismiss error"
                    style={{
                        background: "none", border: "none", color: "#ff4757",
                        fontSize: 16, cursor: "pointer", padding: 0,
                        lineHeight: 1, flexShrink: 0, opacity: 0.6,
                    }}
                >
                    ×
                </button>
            </div>
            {(mapped.action || (mapped.retry && onRetry)) && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 2 }}>
                    {mapped.action && (
                        <span style={{ fontSize: 10, color: "#888", fontStyle: "italic" }}>
                            💡 {mapped.action}
                        </span>
                    )}
                    {mapped.retry && onRetry && (
                        <button
                            onClick={() => { dismiss(); onRetry() }}
                            style={{
                                background: "rgba(255,71,87,0.15)", border: "1px solid rgba(255,71,87,0.3)",
                                color: "#ff4757", fontSize: 10, padding: "3px 10px", borderRadius: 4,
                                cursor: "pointer", fontFamily: "JetBrains Mono, monospace", fontWeight: 600,
                            }}
                        >
                            Retry
                        </button>
                    )}
                </div>
            )}
        </div>
    )
}
