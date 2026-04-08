/**
 * Settings Page — user preferences and app configuration.
 *
 * Sections (collapsible accordion):
 * - Network: active chain selector
 * - Gas Defaults: custom gas fee/wanted
 * - Profile: link to profile page
 * - Advanced: clear cache, version info
 *
 * All settings stored in localStorage.
 * Profile editing is on /profile/:addr (linked from here).
 *
 * @module pages/Settings
 */

import { useNetworkNav } from "../hooks/useNetworkNav"
import { useState, useEffect } from "react"
import { NETWORKS, GNO_CHAIN_ID, APP_VERSION } from "../lib/config"
import { Globe, FolderOpen, GasPump, User, Wrench, Gear } from "@phosphor-icons/react"

const SETTINGS_KEY = "memba_settings"

interface UserSettings {
    gasWanted: number
    gasFee: number
}

function loadSettings(): UserSettings {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY)
        if (raw) return { ...defaults(), ...JSON.parse(raw) }
    } catch { /* ignore */ }
    return defaults()
}

function defaults(): UserSettings {
    return { gasWanted: 10000000, gasFee: 1000000 }
}

function saveSettings(s: UserSettings) {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
    } catch { /* quota */ }
}

// ── UX-L2: Collapsible section component ──────────────────────

function Section({ title, icon, defaultOpen = false, children }: {
    title: string; icon: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode
}) {
    const [open, setOpen] = useState(defaultOpen)

    return (
        <div style={{
            borderRadius: 12,
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.06)",
            overflow: "hidden",
        }}>
            <button
                onClick={() => setOpen(!open)}
                style={{
                    width: "100%",
                    padding: "16px 20px",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                }}
            >
                <span style={{ fontSize: 14, fontWeight: 600, color: "#f0f0f0" }}>
                    {icon} {title}
                </span>
                <span style={{ fontSize: 12, color: "#555", transition: "transform 0.2s", transform: open ? "rotate(180deg)" : "rotate(0)" }}>
                    ▼
                </span>
            </button>
            {open && (
                <div style={{
                    padding: "0 20px 16px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                    borderTop: "1px solid rgba(255,255,255,0.04)",
                }}>
                    {children}
                </div>
            )}
        </div>
    )
}

export function Settings() {
    const navigate = useNetworkNav()
    const [settings, setSettings] = useState(loadSettings)
    const [network, setNetwork] = useState(GNO_CHAIN_ID)
    const [saved, setSaved] = useState(false)

    useEffect(() => {
        saveSettings(settings)
    }, [settings])

    const handleNetworkChange = (key: string) => {
        setNetwork(key)
        localStorage.setItem("memba_network", key)
        setSaved(true)
        // Need page reload for network change to take effect
        setTimeout(() => window.location.reload(), 500)
    }

    const handleClearCache = () => {
        if (!window.confirm("Clear all Memba cached data? This will reset network preferences and cached usernames.")) return
        const keys = ["memba_usernames", "memba_settings", "memba_network", "memba_board_visits"]
        keys.forEach(k => localStorage.removeItem(k))
        setSaved(true)
        setTimeout(() => window.location.reload(), 300)
    }

    const labelStyle: React.CSSProperties = {
        fontSize: 11, color: "#888",
        fontFamily: "JetBrains Mono, monospace",
        display: "block", marginBottom: 4,
    }

    const inputStyle: React.CSSProperties = {
        width: "100%", padding: "8px 12px", borderRadius: 8,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(0,0,0,0.3)", color: "#f0f0f0",
        fontFamily: "JetBrains Mono, monospace", fontSize: 12,
        boxSizing: "border-box",
    }

    const btnStyle: React.CSSProperties = {
        padding: "8px 16px", borderRadius: 8, border: "none",
        cursor: "pointer", fontFamily: "JetBrains Mono, monospace",
        fontSize: 12, fontWeight: 600,
    }

    return (
        <div id="settings-page" style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 600 }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: "#f0f0f0", margin: 0, display: "flex", alignItems: "center", gap: 8 }}><Gear size={22} /> Settings</h2>

            {saved && (
                <div style={{ padding: "8px 14px", borderRadius: 8, background: "rgba(0,212,170,0.08)", color: "#00d4aa", fontSize: 12 }}>
                    ✓ Settings saved
                </div>
            )}

            {/* Network — open by default */}
            <Section title="Network" icon={<Globe size={18} />} defaultOpen>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingTop: 8 }}>
                    {Object.entries(NETWORKS).map(([key, net]) => (
                        <button
                            key={key}
                            id={`network-${key}`}
                            onClick={() => handleNetworkChange(key)}
                            style={{
                                ...btnStyle,
                                background: network === key ? "rgba(0,212,170,0.15)" : "rgba(255,255,255,0.03)",
                                color: network === key ? "#00d4aa" : "#888",
                                border: `1px solid ${network === key ? "rgba(0,212,170,0.3)" : "rgba(255,255,255,0.06)"}`,
                            }}
                        >
                            {net.label}
                        </button>
                    ))}
                </div>
            </Section>

            {/* Directory — moved from main nav */}
            <Section title="Directory" icon={<FolderOpen size={18} />}>
                <div style={{ paddingTop: 8 }}>
                    <p style={{ fontSize: 11, color: "#888", fontFamily: "JetBrains Mono, monospace", margin: "0 0 10px", lineHeight: 1.5 }}>
                        Browse on-chain packages, realms, and user profiles deployed on gno.land.
                    </p>
                    <button
                        id="settings-directory-btn"
                        className="k-btn-primary"
                        style={{ fontSize: 11, padding: "8px 16px" }}
                        onClick={() => navigate("/directory")}
                    >
                        📂 Open Directory →
                    </button>
                </div>
            </Section>

            {/* Gas Defaults */}
            <Section title="Gas Defaults" icon={<GasPump size={18} />}>
                <div style={{ paddingTop: 8 }}>
                    <label style={labelStyle}>Gas Wanted</label>
                    <input
                        id="settings-gas-wanted"
                        type="number"
                        value={settings.gasWanted}
                        onChange={e => setSettings(s => ({ ...s, gasWanted: parseInt(e.target.value, 10) || 10000000 }))}
                        style={inputStyle}
                    />
                </div>
                <div>
                    <label style={labelStyle}>Gas Fee (ugnot)</label>
                    <input
                        id="settings-gas-fee"
                        type="number"
                        value={settings.gasFee}
                        onChange={e => setSettings(s => ({ ...s, gasFee: parseInt(e.target.value, 10) || 1000000 }))}
                        style={inputStyle}
                    />
                </div>
            </Section>

            {/* Profile */}
            <Section title="Profile" icon={<User size={18} />}>
                <p style={{ fontSize: 12, color: "#888", margin: 0, paddingTop: 8 }}>
                    Edit your profile, connect GitHub, and manage social links.
                </p>
                <button
                    id="settings-profile-link"
                    onClick={() => navigate("/profile")}
                    style={{ ...btnStyle, background: "rgba(0,212,170,0.1)", color: "#00d4aa", alignSelf: "flex-start" }}
                >
                    Go to Profile →
                </button>
            </Section>

            {/* Advanced */}
            <Section title="Advanced" icon={<Wrench size={18} />}>
                <button
                    id="settings-clear-cache"
                    onClick={handleClearCache}
                    style={{ ...btnStyle, background: "rgba(255,59,48,0.08)", color: "#ff3b30", alignSelf: "flex-start", marginTop: 8 }}
                >
                    Clear Cache
                </button>
                <div style={{ fontSize: 10, color: "#444", fontFamily: "JetBrains Mono, monospace" }}>
                    Memba v{APP_VERSION} · Chain: {GNO_CHAIN_ID}
                </div>
            </Section>
        </div>
    )
}
