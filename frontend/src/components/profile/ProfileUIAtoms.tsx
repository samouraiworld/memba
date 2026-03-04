/**
 * ProfileUIAtoms — small presentational components used by ProfilePage.
 *
 * Extracted in v1.5.0 to reduce ProfilePage.tsx from 814 to ~460 LOC.
 */
import type React from "react"

export function MetaChip({ icon, text }: { icon: string; text: string }) {
    return (
        <span style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "4px 10px", borderRadius: 6, fontSize: 11,
            fontFamily: "JetBrains Mono, monospace",
            background: "rgba(255,255,255,0.03)", color: "#888",
        }}>
            {icon} {text}
        </span>
    )
}

export function SocialLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
    return (
        <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "8px 14px", borderRadius: 8,
                background: "rgba(255,255,255,0.03)", border: "1px solid #1a1a1a",
                color: "#aaa", fontSize: 12, fontFamily: "JetBrains Mono, monospace",
                textDecoration: "none", transition: "border-color 0.15s, color 0.15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#333"; e.currentTarget.style.color = "#f0f0f0" }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#1a1a1a"; e.currentTarget.style.color = "#aaa" }}
        >
            <span style={{ fontSize: 14 }}>{icon}</span>
            {label}
        </a>
    )
}

export function ContribStat({ label, value, icon, accent }: { label: string; value: string; icon: string; accent?: boolean }) {
    return (
        <div style={{ padding: "12px 14px", borderRadius: 8, background: "rgba(255,255,255,0.02)", border: "1px solid #1a1a1a" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <span style={{ fontSize: 14 }}>{icon}</span>
                <span style={{ fontSize: 9, color: "#666", fontFamily: "JetBrains Mono, monospace", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    {label}
                </span>
            </div>
            <div style={{
                fontSize: 20, fontWeight: 700,
                fontFamily: "JetBrains Mono, monospace",
                color: accent ? "#00d4aa" : "#f0f0f0",
            }}>
                {value}
            </div>
        </div>
    )
}

export function EditField({ label, value, onChange, multiline, maxLen, placeholder, fullWidth }: {
    label: string; value: string; onChange: (v: string) => void
    multiline?: boolean; maxLen?: number; placeholder?: string; fullWidth?: boolean
}) {
    const inputStyle: React.CSSProperties = {
        width: "100%", padding: "8px 10px", borderRadius: 6,
        background: "rgba(255,255,255,0.03)", border: "1px solid #222",
        color: "#f0f0f0", fontSize: 12, fontFamily: "JetBrains Mono, monospace",
        outline: "none", resize: multiline ? "vertical" as const : "none" as const,
        transition: "border-color 0.15s",
    }
    return (
        <div style={{ gridColumn: fullWidth ? "1 / -1" : undefined }}>
            <label style={{ fontSize: 9, color: "#666", fontFamily: "JetBrains Mono, monospace", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4, display: "block" }}>
                {label} {maxLen && <span style={{ color: "#333" }}>({value.length}/{maxLen})</span>}
            </label>
            {multiline ? (
                <textarea
                    value={value}
                    onChange={(e) => onChange(e.target.value.slice(0, maxLen))}
                    placeholder={placeholder}
                    rows={3}
                    style={inputStyle}
                    onFocus={(e) => (e.currentTarget.style.borderColor = "#00d4aa")}
                    onBlur={(e) => (e.currentTarget.style.borderColor = "#222")}
                />
            ) : (
                <input
                    type="text"
                    value={value}
                    onChange={(e) => onChange(e.target.value.slice(0, maxLen))}
                    placeholder={placeholder}
                    style={inputStyle}
                    onFocus={(e) => (e.currentTarget.style.borderColor = "#00d4aa")}
                    onBlur={(e) => (e.currentTarget.style.borderColor = "#222")}
                />
            )}
        </div>
    )
}

