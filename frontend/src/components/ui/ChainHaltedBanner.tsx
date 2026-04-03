/**
 * ChainHaltedBanner — Displays a warning when the selected chain is unreachable.
 *
 * C-02 fix: Probes the active chain on network switch. If all RPC endpoints
 * (primary + fallbacks) are unreachable, shows a dismissible banner with
 * an auto-suggest button to switch to a reachable network.
 *
 * Architecture: This component uses the chainHealth module for RPC probing
 * and integrates with the network switcher for one-click fallback.
 *
 * v3.0: Initial implementation.
 */

import { useState, useEffect, useCallback } from "react"
import { checkChainHealth, getSuggestedFallback } from "../../lib/chainHealth"
import { NETWORKS } from "../../lib/config"

interface ChainHaltedBannerProps {
    /** Active network key (e.g. "gnoland1", "test12") */
    networkKey: string
    /** Callback to switch network */
    onSwitchNetwork: (key: string) => void
}

export function ChainHaltedBanner({ networkKey, onSwitchNetwork }: ChainHaltedBannerProps) {
    const [halted, setHalted] = useState(false)
    const [dismissed, setDismissed] = useState(false)
    const [checking, setChecking] = useState(false)

    const [prevNetworkKey, setPrevNetworkKey] = useState(networkKey)
    const fallbackKey = getSuggestedFallback(networkKey)
    const fallbackLabel = fallbackKey ? NETWORKS[fallbackKey]?.label || fallbackKey : null

    // Reset state when networkKey changes (React-recommended pattern)
    if (prevNetworkKey !== networkKey) {
        setPrevNetworkKey(networkKey)
        setDismissed(false)
        setHalted(false)
    }

    // Probe chain health — extracted to callback to satisfy react-hooks/set-state-in-effect
    const probeHealth = useCallback(async (key: string, signal: { cancelled: boolean }) => {
        setChecking(true)
        try {
            const result = await checkChainHealth(key, 6000)
            if (signal.cancelled) return
            setHalted(!result.reachable)
        } catch {
            if (signal.cancelled) return
            setHalted(true)
        } finally {
            if (!signal.cancelled) setChecking(false)
        }
    }, [])

    // Trigger probe on network change
    useEffect(() => {
        // Skip known-good networks (test12 is primary)
        if (networkKey === "test12") return

        const signal = { cancelled: false }
        probeHealth(networkKey, signal)

        return () => { signal.cancelled = true }
    }, [networkKey, probeHealth])

    const handleSwitch = useCallback(() => {
        if (fallbackKey) {
            onSwitchNetwork(fallbackKey)
            setDismissed(true)
        }
    }, [fallbackKey, onSwitchNetwork])

    // Don't render if not halted, dismissed, or still checking
    if (!halted || dismissed || checking) return null

    const chainLabel = NETWORKS[networkKey]?.label || networkKey

    return (
        <div
            role="alert"
            style={{
                background: "linear-gradient(135deg, rgba(255,152,0,0.15), rgba(255,87,34,0.12))",
                border: "1px solid rgba(255,152,0,0.35)",
                borderRadius: "var(--radius-md, 10px)",
                padding: "12px 16px",
                margin: "0 0 16px 0",
                display: "flex",
                alignItems: "center",
                gap: "12px",
                fontSize: "0.875rem",
                color: "var(--text-primary, #fff)",
                animation: "fadeIn 0.3s ease-out",
            }}
        >
            <span style={{ fontSize: "1.2rem", flexShrink: 0 }}>⚠️</span>
            <div style={{ flex: 1 }}>
                <strong>{chainLabel}</strong> is currently unreachable.
                {fallbackLabel && (
                    <> We recommend switching to <strong>{fallbackLabel}</strong>.</>
                )}
            </div>
            <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
                {fallbackKey && (
                    <button
                        onClick={handleSwitch}
                        style={{
                            background: "rgba(255,152,0,0.25)",
                            border: "1px solid rgba(255,152,0,0.5)",
                            borderRadius: "var(--radius-sm, 6px)",
                            padding: "6px 12px",
                            color: "var(--text-primary, #fff)",
                            cursor: "pointer",
                            fontSize: "0.8125rem",
                            fontWeight: 600,
                            whiteSpace: "nowrap",
                        }}
                    >
                        Switch to {fallbackLabel}
                    </button>
                )}
                <button
                    onClick={() => setDismissed(true)}
                    aria-label="Dismiss chain halted warning"
                    style={{
                        background: "transparent",
                        border: "none",
                        color: "var(--text-secondary, #888)",
                        cursor: "pointer",
                        fontSize: "1rem",
                        padding: "4px",
                        lineHeight: 1,
                    }}
                >
                    ✕
                </button>
            </div>
        </div>
    )
}
