/**
 * MockUI — Reusable miniature Memba UI frame for Remotion compositions.
 *
 * Renders a dark-themed app shell matching the real Memba design system
 * (same colors, radii, fonts) so compositions look like real screenshots.
 */
import type { CSSProperties, ReactNode } from "react"
import { COLORS, fontSans, fontMono } from "./tokens"

/** Shared container that looks like the Memba app shell. */
export function MockUI({ children, title = "Memba" }: { children: ReactNode; title?: string }) {
    return (
        <div style={shell}>
            {/* Mini topbar */}
            <div style={topbar}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={logoDot} />
                    <span style={{ fontSize: 11, fontWeight: 600, fontFamily: fontSans, color: COLORS.text }}>{title}</span>
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                    <span style={badge}>Alpha</span>
                    <span style={{ ...badge, background: "rgba(0,212,170,0.08)", color: COLORS.accent, border: `1px solid rgba(0,212,170,0.2)` }}>v2</span>
                </div>
            </div>
            {/* Content area */}
            <div style={content}>{children}</div>
        </div>
    )
}

/** Animated card that fades in and slides up. */
export function MockCard({ children, style, delay = 0 }: { children: ReactNode; style?: CSSProperties; delay?: number }) {
    return (
        <div
            style={{
                background: COLORS.panel,
                border: `1px solid ${COLORS.edge}`,
                borderRadius: 8,
                padding: "10px 12px",
                animationDelay: `${delay}ms`,
                ...style,
            }}
        >
            {children}
        </div>
    )
}

/** Small accent-colored label. */
export function MockLabel({ children }: { children: ReactNode }) {
    return (
        <span style={{ fontSize: 8, fontFamily: fontMono, textTransform: "uppercase", letterSpacing: "0.08em", color: COLORS.muted }}>
            {children}
        </span>
    )
}

/** Mock accent button. */
export function MockButton({ children, variant = "primary" }: { children: ReactNode; variant?: "primary" | "ghost" }) {
    const isPrimary = variant === "primary"
    return (
        <div
            style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                height: 24,
                padding: "0 12px",
                borderRadius: 5,
                background: isPrimary ? COLORS.accent : "transparent",
                color: isPrimary ? "#000" : COLORS.accent,
                fontSize: 9,
                fontWeight: 600,
                fontFamily: fontSans,
                border: isPrimary ? "none" : `1px solid rgba(0,212,170,0.25)`,
            }}
        >
            {children}
        </div>
    )
}

/** Mock progress bar. */
export function MockProgress({ value, color = COLORS.accent }: { value: number; color?: string }) {
    return (
        <div style={{ height: 4, borderRadius: 2, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.min(100, Math.max(0, value))}%`, background: color, borderRadius: 2, transition: "width 0.3s" }} />
        </div>
    )
}


// ── Styles ──────────────────────────────────────────────────────────────
const shell: CSSProperties = {
    width: "100%",
    height: "100%",
    background: COLORS.bg,
    borderRadius: 8,
    overflow: "hidden",
    fontFamily: fontSans,
    display: "flex",
    flexDirection: "column",
}

const topbar: CSSProperties = {
    height: 28,
    background: "rgba(0,0,0,0.85)",
    borderBottom: `1px solid ${COLORS.edge}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 10px",
    flexShrink: 0,
}

const logoDot: CSSProperties = {
    width: 14,
    height: 14,
    borderRadius: 3,
    background: `linear-gradient(135deg, ${COLORS.accent}, #009977)`,
}

const badge: CSSProperties = {
    fontSize: 7,
    fontFamily: fontMono,
    padding: "1px 5px",
    borderRadius: 3,
    background: "rgba(255,165,2,0.12)",
    color: "var(--color-warning)",
    border: "1px solid rgba(255,165,2,0.2)",
}

const content: CSSProperties = {
    flex: 1,
    padding: 12,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    overflow: "hidden",
}
