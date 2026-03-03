/* eslint-disable react-refresh/only-export-components */
import type React from "react"

// ── Types ─────────────────────────────────────────────────

export interface MemberInput {
    address: string
    power: number
    roles: string[]
}

export type Step = 1 | 2 | 3 | 4

// ── Role Colors ───────────────────────────────────────────

export const ROLE_COLORS: Record<string, string> = {
    admin: "#f5a623",
    dev: "#00d4aa",
    finance: "#7b61ff",
    ops: "#3b82f6",
    member: "#888",
}

export const ROLE_ICONS: Record<string, string> = {
    admin: "🔑",
    dev: "💻",
    finance: "💰",
    ops: "⚙️",
    member: "👤",
}

// ── Shared Styles ─────────────────────────────────────────

export const inputStyle: React.CSSProperties = {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 8,
    padding: "10px 14px",
    fontSize: 13,
    color: "#f0f0f0",
    fontFamily: "JetBrains Mono, monospace",
    outline: "none",
    transition: "border-color 0.15s",
    width: "100%",
}

// ── Shared Components ─────────────────────────────────────

export function FormField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
    return (
        <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#f0f0f0", display: "block", marginBottom: 6 }}>
                {label}
            </label>
            {hint && (
                <p style={{ fontSize: 10, color: "#666", marginBottom: 8, fontFamily: "JetBrains Mono, monospace" }}>
                    {hint}
                </p>
            )}
            {children}
        </div>
    )
}

export function SummaryItem({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
    return (
        <div>
            <div style={{ fontSize: 9, color: "#555", textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: "JetBrains Mono, monospace" }}>
                {label}
            </div>
            <div style={{
                fontSize: 13, fontWeight: accent ? 700 : 500,
                color: accent ? "#00d4aa" : "#f0f0f0",
                fontFamily: "JetBrains Mono, monospace", marginTop: 2,
                wordBreak: "break-all",
            }}>
                {value}
            </div>
        </div>
    )
}
