/**
 * Settings Page — user preferences and app configuration.
 *
 * Sections:
 * - Network: active chain selector
 * - Appearance: theme toggle (future)
 * - Gas Defaults: custom gas fee/wanted
 * - Data Export: export wallet activity
 * - Advanced: clear cache, developer mode
 *
 * All settings stored in localStorage.
 * Profile editing is on /profile/:addr (linked from here).
 *
 * @module pages/Settings
 */

import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { NETWORKS, GNO_CHAIN_ID, APP_VERSION } from "../lib/config"

const SETTINGS_KEY = "memba_settings"

interface UserSettings {
    gasWanted: number
    gasFee: number
    devMode: boolean
}

function loadSettings(): UserSettings {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY)
        if (raw) return { ...defaults(), ...JSON.parse(raw) }
    } catch { /* ignore */ }
    return defaults()
}

function defaults(): UserSettings {
    return { gasWanted: 10000000, gasFee: 1000000, devMode: false }
}

function saveSettings(s: UserSettings) {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
    } catch { /* quota */ }
}

export function Settings() {
    const navigate = useNavigate()
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
        const keys = ["memba_usernames", "memba_settings", "memba_network"]
        keys.forEach(k => localStorage.removeItem(k))
        setSaved(true)
        setTimeout(() => window.location.reload(), 300)
    }

    // ── Styles ────────────────────────────────────────────────

    const sectionStyle: React.CSSProperties = {
        padding: "20px 24px",
        borderRadius: 12,
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.06)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
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
        <div id="settings-page" style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 600 }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: "#f0f0f0", margin: 0 }}>⚙️ Settings</h2>

            {saved && (
                <div style={{ padding: "8px 14px", borderRadius: 8, background: "rgba(0,212,170,0.08)", color: "#00d4aa", fontSize: 12 }}>
                    ✓ Settings saved
                </div>
            )}

            {/* Network */}
            <div style={sectionStyle}>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: "#f0f0f0", margin: 0 }}>🌐 Network</h3>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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
            </div>

            {/* Gas Defaults */}
            <div style={sectionStyle}>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: "#f0f0f0", margin: 0 }}>⛽ Gas Defaults</h3>
                <div>
                    <label style={labelStyle}>Gas Wanted</label>
                    <input
                        id="settings-gas-wanted"
                        type="number"
                        value={settings.gasWanted}
                        onChange={e => setSettings(s => ({ ...s, gasWanted: parseInt(e.target.value) || 10000000 }))}
                        style={inputStyle}
                    />
                </div>
                <div>
                    <label style={labelStyle}>Gas Fee (ugnot)</label>
                    <input
                        id="settings-gas-fee"
                        type="number"
                        value={settings.gasFee}
                        onChange={e => setSettings(s => ({ ...s, gasFee: parseInt(e.target.value) || 1000000 }))}
                        style={inputStyle}
                    />
                </div>
            </div>

            {/* Profile */}
            <div style={sectionStyle}>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: "#f0f0f0", margin: 0 }}>👤 Profile</h3>
                <p style={{ fontSize: 12, color: "#888", margin: 0 }}>
                    Edit your profile, connect GitHub, and manage social links.
                </p>
                <button
                    id="settings-profile-link"
                    onClick={() => navigate("/profile/me")}
                    style={{ ...btnStyle, background: "rgba(0,212,170,0.1)", color: "#00d4aa", alignSelf: "flex-start" }}
                >
                    Go to Profile →
                </button>
            </div>

            {/* Advanced */}
            <div style={sectionStyle}>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: "#f0f0f0", margin: 0 }}>🔧 Advanced</h3>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <input
                        id="settings-dev-mode"
                        type="checkbox"
                        checked={settings.devMode}
                        onChange={e => setSettings(s => ({ ...s, devMode: e.target.checked }))}
                    />
                    <label style={{ fontSize: 12, color: "#ccc" }}>Developer Mode</label>
                </div>
                <button
                    id="settings-clear-cache"
                    onClick={handleClearCache}
                    style={{ ...btnStyle, background: "rgba(255,59,48,0.08)", color: "#ff3b30", alignSelf: "flex-start" }}
                >
                    Clear Cache
                </button>
                <div style={{ fontSize: 10, color: "#444", fontFamily: "JetBrains Mono, monospace" }}>
                    Memba v{APP_VERSION} · Chain: {GNO_CHAIN_ID}
                </div>
            </div>
        </div>
    )
}
