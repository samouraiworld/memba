/* eslint-disable react-refresh/only-export-components */
import type React from "react"

// ── Types ─────────────────────────────────────────────────

export interface MemberInput {
    address: string
    power: number
    roles: string[]
}

export type Step = 1 | 2 | 3 | 4 | 5

/** Shown wherever the wizard lists roles. */
export const ROLES_ARE_LABELS = "Roles are labels; they grant no special powers."

/** Warning shown when one member can pass proposals without anyone else. */
export function SoloPowerWarning({ addresses }: { addresses: string[] }) {
    if (addresses.length === 0) return null
    return (
        <div role="alert" data-testid="dao-single-member-warning" style={{
            padding: "10px 14px", borderRadius: 8, fontSize: "var(--pro-small, 12px)",
            background: "var(--color-k-amber-subtle)", border: "1px solid var(--color-k-amber-border)", color: "var(--color-k-warning)",
            wordBreak: "break-all",
        }}>
            {addresses.map((a) => <div key={a}>{a} can pass proposals alone.</div>)}
        </div>
    )
}

// ── Role Colors ───────────────────────────────────────────

export const ROLE_COLORS: Record<string, string> = {
    admin: "var(--color-accent-gold)",
    dev: "var(--color-brand)",
    finance: "var(--color-accent-purple)",
    ops: "var(--color-info)",
    member: "var(--color-text-secondary)",
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
    fontSize: "var(--pro-small, 13px)",
    color: "var(--color-text)",
    fontFamily: "var(--font-ui, JetBrains Mono, monospace)",
    outline: "none",
    transition: "border-color 0.15s",
    width: "100%",
}

// ── Shared Components ─────────────────────────────────────

export function FormField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
    return (
        <div>
            <label style={{ fontSize: "var(--pro-small, 12px)", fontWeight: 600, color: "var(--color-text)", display: "block", marginBottom: 6 }}>
                {label}
            </label>
            {hint && (
                <p style={{ fontSize: "var(--pro-caption, 10px)", color: "var(--color-text-secondary)", marginBottom: 8, fontFamily: "var(--font-ui, JetBrains Mono, monospace)" }}>
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
            <div style={{ fontSize: "var(--pro-caption, 9px)", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: "var(--font-ui, JetBrains Mono, monospace)" }}>
                {label}
            </div>
            <div style={{
                fontSize: "var(--pro-small, 13px)", fontWeight: accent ? 700 : 500,
                color: accent ? "var(--color-k-accent-text)" : "var(--color-k-text)",
                fontFamily: "var(--font-ui, JetBrains Mono, monospace)", marginTop: 2,
                wordBreak: "break-all",
            }}>
                {value}
            </div>
        </div>
    )
}
