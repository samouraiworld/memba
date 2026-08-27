/**
 * ChainHaltedBanner — Displays a warning when the selected chain is unreachable.
 *
 * C-02 fix: Probes the active chain on network switch. If all RPC endpoints
 * (primary + fallbacks) are unreachable, shows a dismissible banner with
 * an auto-suggest button to switch to a reachable network. Every network is
 * probed, test13 included — its public RPCs are not guaranteed up.
 *
 * Architecture: This component uses the chainHealth module for RPC probing
 * and integrates with the network switcher for one-click fallback.
 *
 * v3.0: Initial implementation.
 */

import { useState, useCallback } from "react"
import { useQuery } from "@tanstack/react-query"
import { checkChainHealth, getSuggestedFallback } from "../../lib/chainHealth"
import { NETWORKS } from "../../lib/config"

/** Delay before the confirming re-probe. A single point-in-time sample can be a
 *  transient blip (TLS warm-up, a backgrounded tab, the slowest endpoint just
 *  over the timeout); we only conclude "unreachable" after two consecutive
 *  failures so a blip can't latch the banner for the whole session — this
 *  matters because test13 (the default network) is now probed. */
export const PROBE_RETRY_DELAY_MS = 2500

interface ChainHaltedBannerProps {
    /** Active network key (e.g. "gnoland1", "test13") */
    networkKey: string
    /** Callback to switch network */
    onSwitchNetwork: (key: string) => void
}

export function ChainHaltedBanner({ networkKey, onSwitchNetwork }: ChainHaltedBannerProps) {
    const [dismissed, setDismissed] = useState(false)

    const [prevNetworkKey, setPrevNetworkKey] = useState(networkKey)
    const fallbackKey = getSuggestedFallback(networkKey)
    const fallbackLabel = fallbackKey ? NETWORKS[fallbackKey]?.label || fallbackKey : null

    // Reset the dismissal when networkKey changes (React-recommended pattern);
    // the halted verdict resets structurally — a new key is a new query.
    if (prevNetworkKey !== networkKey) {
        setPrevNetworkKey(networkKey)
        setDismissed(false)
    }

    // Probe chain health, keyed by network. Every network is probed — the probe
    // (checkChainHealth) races the primary + all fallbacks and reports
    // unreachable only when ALL fail, so this never fires while the app can
    // still reach the chain through any endpoint. Two-strikes: a first-probe
    // failure is confirmed by a second probe after a short delay before the
    // banner shows — a real outage still surfaces (~PROBE_RETRY_DELAY_MS); a
    // one-off blip does not latch. staleTime 0: health must re-probe on every
    // mount, never serve a cached verdict.
    const healthQuery = useQuery({
        queryKey: ["chain", "health", networkKey],
        staleTime: 0,
        queryFn: async () => {
            try {
                let result = await checkChainHealth(networkKey, 6000)
                if (!result.reachable) {
                    await new Promise((resolve) => setTimeout(resolve, PROBE_RETRY_DELAY_MS))
                    result = await checkChainHealth(networkKey, 6000)
                }
                return !result.reachable
            } catch {
                return true
            }
        },
    })
    const halted = healthQuery.data ?? false
    const checking = healthQuery.isPending

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
                color: "var(--text-primary, var(--color-text-primary))",
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
                            color: "var(--text-primary, var(--color-text-primary))",
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
                        color: "var(--text-secondary, var(--color-text-secondary))",
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
