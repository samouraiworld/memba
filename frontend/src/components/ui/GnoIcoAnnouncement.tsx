/**
 * GnoIcoAnnouncement — one-time promo popup for the public GNOT token sale.
 *
 * The gno.land public sale (https://sale.gno.land) opens 2026-07-20. This shows
 * a dismissible, centered announcement once per campaign; dismissing (or clicking
 * through to the sale) stores the campaign id so it never re-shows for that
 * campaign. Bump CAMPAIGN_ID to re-announce a later phase.
 *
 * Gated by VITE_ENABLE_ICO_ANNOUNCEMENT (ordinary flag — read-only external link,
 * moves no funds, so NOT a SAFETY_GATED_FLAG). Rendered via AccessibleDialog so it
 * inherits the app's focus trap + restore, body-scroll lock, Esc, and backdrop
 * dismissal. Layout passes `suppressed` while a higher-priority modal (onboarding
 * wizard, activation gate) is up so the promo never stacks on top of one.
 *
 * @module components/ui/GnoIcoAnnouncement
 */

import { useState, useEffect, useCallback, useRef } from "react"
import { AccessibleDialog } from "../AccessibleDialog"
import { isIcoAnnouncementEnabled } from "../../lib/config"

/** Bump to re-announce (e.g. a later sale phase). Old dismissals won't suppress a new id. */
const CAMPAIGN_ID = "gno-ico-2026-07"
const STORAGE_KEY = "memba_gno_ico_seen"
const SALE_URL = "https://sale.gno.land/"
/** Sale opens 2026-07-20 (UTC). Drives the "opens in N days" / "now open" copy. */
const SALE_START_MS = Date.UTC(2026, 6, 20, 0, 0, 0)
const SHOW_DELAY_MS = 1500
const EXIT_MS = 200

function alreadyDismissed(): boolean {
    try {
        return localStorage.getItem(STORAGE_KEY) === CAMPAIGN_ID
    } catch {
        return true // no storage → don't nag
    }
}

function markDismissed(): void {
    try {
        localStorage.setItem(STORAGE_KEY, CAMPAIGN_ID)
    } catch { /* quota / SSR */ }
}

/** Whole days until the sale opens; 0 or negative once it's live. Uses a passed-in
 *  `now` so it's testable (Date.now() is fine at runtime). */
export function daysUntilSale(now: number): number {
    return Math.ceil((SALE_START_MS - now) / 86_400_000)
}

/** The status line shown under the title, based on time-to-open. Copy stays
 *  deliberately non-committal once the window opens: it points to the official
 *  portal for the real status rather than asserting the sale is participatable
 *  this instant (the day boundary here is UTC and the true open time lives on the
 *  sale site). */
export function saleStatusLabel(days: number): string {
    if (days > 1) return `Opens in ${days} days · July 20`
    if (days === 1) return "Opens tomorrow · July 20"
    if (days === 0) return "Opening today · July 20"
    return "Now open — visit the sale"
}

export function GnoIcoAnnouncement({ suppressed = false }: { suppressed?: boolean }) {
    const [visible, setVisible] = useState(false)
    const [exiting, setExiting] = useState(false)
    const cardRef = useRef<HTMLDivElement>(null)
    const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

    useEffect(() => {
        if (suppressed) return
        if (!isIcoAnnouncementEnabled()) return
        if (alreadyDismissed()) return
        const timer = setTimeout(() => setVisible(true), SHOW_DELAY_MS)
        return () => clearTimeout(timer)
    }, [suppressed])

    // Clear a pending exit timer on unmount so a late callback can't fire after
    // the component is gone (e.g. a route change mid-dismiss).
    useEffect(() => () => { if (exitTimer.current) clearTimeout(exitTimer.current) }, [])

    const handleDismiss = useCallback(() => {
        setExiting(true)
        exitTimer.current = setTimeout(() => {
            markDismissed()
            setVisible(false)
            setExiting(false)
        }, EXIT_MS)
    }, [])

    // Clicking the CTA opens the sale in a new tab AND dismisses the promo here,
    // so returning to this tab doesn't leave it covering the app.
    const handleCta = useCallback(() => {
        handleDismiss()
    }, [handleDismiss])

    // Never render while suppressed, even if already visible — a higher-priority
    // modal (wizard / activation gate) must win and this must not stack under it.
    if (!visible || suppressed) return null

    const status = saleStatusLabel(daysUntilSale(Date.now()))

    return (
        <>
            <AccessibleDialog
                open
                onClose={handleDismiss}
                labelledBy="gno-ico-title"
                className="gno-ico-backdrop"
            >
                <div
                    ref={cardRef}
                    className="gno-ico-card"
                    style={{ animation: exiting ? `membaIcoOut ${EXIT_MS}ms ease-in forwards` : "membaIcoIn 300ms cubic-bezier(0.22, 1, 0.36, 1)" }}
                >
                    <button
                        onClick={handleDismiss}
                        aria-label="Close"
                        style={{
                            position: "absolute", top: 14, right: 16,
                            background: "none", border: "none", color: "var(--color-text-muted)",
                            cursor: "pointer", fontSize: 18, padding: 4, lineHeight: 1,
                        }}
                    >
                        ✕
                    </button>

                    <div style={{
                        fontSize: 10, fontWeight: 600, letterSpacing: 1.5, textTransform: "uppercase",
                        color: "var(--color-primary)", marginBottom: 10,
                    }}>
                        gno.land · public sale
                    </div>

                    <div
                        id="gno-ico-title"
                        style={{ fontSize: 22, fontWeight: 700, color: "var(--color-text)", lineHeight: 1.25, marginBottom: 8 }}
                    >
                        The GNOT public sale is coming
                    </div>

                    <div style={{
                        display: "inline-block",
                        fontSize: 11, fontWeight: 600,
                        color: "var(--color-primary)",
                        background: "rgba(0,212,170,0.08)",
                        border: "1px solid rgba(0,212,170,0.2)",
                        borderRadius: 999, padding: "4px 12px", marginBottom: 16,
                    }}>
                        ● {status}
                    </div>

                    <p style={{ fontSize: 12.5, color: "var(--color-text-secondary)", lineHeight: 1.6, marginBottom: 20 }}>
                        gno.land is opening its public token sale. Review eligibility, phases and
                        pricing on the official sale portal — and be ready when it goes live.
                    </p>

                    <a
                        href={SALE_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={handleCta}
                        style={{
                            display: "block", textAlign: "center", textDecoration: "none",
                            width: "100%", padding: "12px 0", borderRadius: 12,
                            border: "1px solid var(--color-primary)",
                            background: "var(--color-primary)",
                            color: "var(--color-on-primary, #04140f)",
                            fontFamily: "JetBrains Mono, monospace",
                            fontSize: 13, fontWeight: 700, marginBottom: 10,
                        }}
                    >
                        View the sale ↗
                    </a>

                    <button
                        onClick={handleDismiss}
                        style={{
                            width: "100%", padding: "9px 0", borderRadius: 12,
                            border: "1px solid var(--color-border, rgba(255,255,255,0.12))",
                            background: "transparent",
                            color: "var(--color-text-muted)",
                            cursor: "pointer",
                            fontFamily: "JetBrains Mono, monospace",
                            fontSize: 12, fontWeight: 600,
                        }}
                    >
                        Maybe later
                    </button>

                    <p style={{ fontSize: 9.5, color: "var(--color-text-muted)", textAlign: "center", marginTop: 12, lineHeight: 1.5 }}>
                        Not financial advice. Memba links to the official gno.land sale; it does not run it.
                    </p>
                </div>
            </AccessibleDialog>

            <style>{`
                .gno-ico-backdrop {
                    position: fixed; inset: 0; z-index: 1100;
                    display: flex; align-items: center; justify-content: center;
                    padding: 16px;
                    background: rgba(0,0,0,0.55);
                    backdrop-filter: blur(4px);
                    animation: membaIcoFade 250ms ease-out;
                }
                .gno-ico-card {
                    position: relative;
                    width: min(440px, calc(100vw - 32px));
                    background: var(--color-bg-card);
                    backdrop-filter: blur(16px);
                    border: 1px solid var(--color-primary-border);
                    border-radius: 18px;
                    padding: 28px 24px 24px;
                    font-family: "JetBrains Mono", monospace;
                    box-shadow: 0 24px 64px var(--color-overlay);
                }
                @keyframes membaIcoFade { from { opacity: 0; } to { opacity: 1; } }
                @keyframes membaIcoIn {
                    from { opacity: 0; transform: translateY(8px) scale(0.96); }
                    to   { opacity: 1; transform: translateY(0) scale(1); }
                }
                @keyframes membaIcoOut {
                    from { opacity: 1; transform: translateY(0) scale(1); }
                    to   { opacity: 0; transform: translateY(6px) scale(0.97); }
                }
                @media (prefers-reduced-motion: reduce) {
                    .gno-ico-backdrop { animation: none; }
                    @keyframes membaIcoIn { from { opacity: 0; } to { opacity: 1; } }
                    @keyframes membaIcoOut { from { opacity: 1; } to { opacity: 0; } }
                }
                @media (max-width: 640px) {
                    .gno-ico-backdrop { align-items: flex-end; padding: 0; }
                    .gno-ico-card {
                        width: 100%;
                        border-radius: 18px 18px 0 0;
                    }
                }
            `}</style>
        </>
    )
}
