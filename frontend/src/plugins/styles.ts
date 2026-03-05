/**
 * Shared Plugin Styles — reusable style objects for all plugin UIs.
 *
 * Consolidates the repeated card, button, input, and label styles
 * used across Board, GnoSwap, Leaderboard, and Settings.
 *
 * @module plugins/styles
 */

// ── Cards ─────────────────────────────────────────────────────

export const cardStyle: React.CSSProperties = {
    padding: "16px 20px",
    borderRadius: 10,
    background: "rgba(255,255,255,0.02)",
    border: "1px solid rgba(255,255,255,0.06)",
    transition: "all 0.2s",
}

export const cardClickable: React.CSSProperties = {
    ...cardStyle,
    cursor: "pointer",
}

// ── Buttons ───────────────────────────────────────────────────

const btnBase: React.CSSProperties = {
    padding: "8px 16px",
    borderRadius: 8,
    border: "none",
    cursor: "pointer",
    fontFamily: "JetBrains Mono, monospace",
    fontSize: 12,
    fontWeight: 600,
}

export const primaryBtn: React.CSSProperties = {
    ...btnBase,
    background: "linear-gradient(135deg, #00d4aa, #00b894)",
    color: "#000",
}

export const ghostBtn: React.CSSProperties = {
    ...btnBase,
    background: "none",
    color: "#00d4aa",
    border: "1px solid rgba(0,212,170,0.2)",
}

export const dangerBtn: React.CSSProperties = {
    ...btnBase,
    background: "rgba(255,59,48,0.08)",
    color: "#ff3b30",
}

// ── Inputs ────────────────────────────────────────────────────

export const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(0,0,0,0.3)",
    color: "#f0f0f0",
    fontFamily: "JetBrains Mono, monospace",
    fontSize: 13,
    boxSizing: "border-box",
}

export const labelStyle: React.CSSProperties = {
    fontSize: 11,
    color: "#888",
    fontFamily: "JetBrains Mono, monospace",
    display: "block",
    marginBottom: 4,
}

// ── Layout ────────────────────────────────────────────────────

export const sectionStyle: React.CSSProperties = {
    padding: "20px 24px",
    borderRadius: 12,
    background: "rgba(255,255,255,0.02)",
    border: "1px solid rgba(255,255,255,0.06)",
    display: "flex",
    flexDirection: "column",
    gap: 12,
}

// ── Shimmer ───────────────────────────────────────────────────

export const shimmerRow: React.CSSProperties = {
    height: 60,
    borderRadius: 8,
    background: "#111",
}
