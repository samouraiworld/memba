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
import { GNO_CHAIN_ID, APP_VERSION, selectableNetworksFor } from "../lib/config"
import { useNetwork } from "../hooks/useNetwork"
import { Globe, FolderOpen, GasPump, User, Wrench, Gear, SunDim } from "@phosphor-icons/react"
import { ThemeSelect } from "../components/ui/ThemeSelect"
import { trackEvent } from "../lib/analytics"
import {
    getGasConfig, MAX_DEFAULT_GAS_WANTED, MAX_DEFAULT_GAS_FEE_UGNOT,
    parseDefaultGasInput,
} from "../lib/gasConfig"

const SETTINGS_KEY = "memba_settings"

interface UserSettings {
    gasWanted: number
    gasFee: number
}

function loadSettings(): UserSettings {
    const gas = getGasConfig()
    return { gasWanted: gas.wanted, gasFee: gas.fee }
}

function saveSettings(s: UserSettings) {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
        return true
    } catch { return false }
}

// ── UX-L2: Collapsible section component ──────────────────────

function Section({ title, icon, defaultOpen = false, children }: {
    title: string; icon: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode
}) {
    const [open, setOpen] = useState(defaultOpen)

    return (
        <div style={{
            borderRadius: 12,
            background: "var(--color-k-hover-surface)",
            border: "1px solid var(--color-k-edge)",
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
                <span style={{ fontSize: "var(--pro-body, 14px)", fontWeight: 600, color: "var(--color-text)" }}>
                    {icon} {title}
                </span>
                <span style={{ fontSize: "var(--pro-small, 12px)", color: "var(--color-text-muted)", transition: "transform 0.2s", transform: open ? "rotate(180deg)" : "rotate(0)" }}>
                    ▼
                </span>
            </button>
            {open && (
                <div style={{
                    padding: "0 20px 16px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                    borderTop: "1px solid var(--color-k-edge)",
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
    const [gasDraft, setGasDraft] = useState(() => ({
        gasWanted: String(settings.gasWanted), gasFee: String(settings.gasFee),
    }))
    const [gasTouched, setGasTouched] = useState({ gasWanted: false, gasFee: false })
    const [gasConflict, setGasConflict] = useState({ gasWanted: false, gasFee: false })
    // The THIRD network picker (after TopBar and MobileTabBar). It listed the full
    // NETWORKS map, so it kept offering Betanet after `hidden` landed — and it
    // compared a network KEY against GNO_CHAIN_ID (a chain ID: "topaz" vs
    // "topaz-1"), so no button ever rendered as active. Both now go through the
    // same helpers as the switcher.
    const { networkKey, switchNetwork } = useNetwork()
    const [saved, setSaved] = useState(false)
    const [saveError, setSaveError] = useState(false)

    useEffect(() => {
        const refreshFromStorage = (event: StorageEvent) => {
            if (event.key !== SETTINGS_KEY && event.key !== null) return
            const latest = loadSettings()
            const wantedDirty = gasDraft.gasWanted !== String(settings.gasWanted)
            const feeDirty = gasDraft.gasFee !== String(settings.gasFee)
            setGasConflict(current => ({
                gasWanted: current.gasWanted || (wantedDirty && latest.gasWanted !== settings.gasWanted),
                gasFee: current.gasFee || (feeDirty && latest.gasFee !== settings.gasFee),
            }))
            setGasDraft(current => ({
                gasWanted: wantedDirty ? current.gasWanted : String(latest.gasWanted),
                gasFee: feeDirty ? current.gasFee : String(latest.gasFee),
            }))
            setSettings(latest)
            setSaved(false)
        }
        window.addEventListener("storage", refreshFromStorage)
        return () => window.removeEventListener("storage", refreshFromStorage)
    }, [gasDraft, settings])

    const commitGasDraft = (field: keyof UserSettings, overrideConflict = false) => {
        setGasTouched(current => ({ ...current, [field]: true }))
        const max = field === "gasWanted" ? MAX_DEFAULT_GAS_WANTED : MAX_DEFAULT_GAS_FEE_UGNOT
        const value = parseDefaultGasInput(gasDraft[field], max)
        if (value === null) return

        // Read again at commit time: another tab may have written since the
        // last storage event. Preserve its other field and refuse to silently
        // replace an edit to this same field.
        const latest = loadSettings()
        const dirty = gasDraft[field] !== String(settings[field])
        const other: keyof UserSettings = field === "gasWanted" ? "gasFee" : "gasWanted"
        if (!dirty && latest[field] !== settings[field]) {
            // The field was untouched locally. A delayed storage event must
            // never turn a blur into a write of the stale displayed value.
            setGasDraft(current => ({
                ...current, [field]: String(latest[field]),
                [other]: current[other] === String(settings[other]) ? String(latest[other]) : current[other],
            }))
            setSettings(latest)
            setSaved(false)
            return
        }
        if (!overrideConflict && (gasConflict[field] || (dirty && latest[field] !== settings[field]))) {
            setGasDraft(current => ({ ...current, [other]: current[other] === String(settings[other]) ? String(latest[other]) : current[other] }))
            setSettings(latest)
            setGasConflict(current => ({ ...current, [field]: true }))
            setSaved(false)
            return
        }

        const next = { ...latest, [field]: value }
        if (value !== latest[field] && !saveSettings(next)) {
            setSaveError(true)
            setSaved(false)
            return
        }
        setGasDraft(current => ({
            ...current, [field]: String(value),
            [other]: current[other] === String(settings[other]) ? String(latest[other]) : current[other],
        }))
        setSettings(next)
        setGasConflict(current => ({ ...current, [field]: false }))
        setSaveError(false)
        setSaved(value !== latest[field])
    }

    const restoreLatestGasValue = (field: keyof UserSettings) => {
        const latest = loadSettings()
        setSettings(latest)
        setGasDraft(current => ({ ...current, [field]: String(latest[field]) }))
        setGasConflict(current => ({ ...current, [field]: false }))
        setGasTouched(current => ({ ...current, [field]: false }))
        setSaved(false)
    }

    const wantedInvalid = gasTouched.gasWanted && parseDefaultGasInput(gasDraft.gasWanted, MAX_DEFAULT_GAS_WANTED) === null
    const feeInvalid = gasTouched.gasFee && parseDefaultGasInput(gasDraft.gasFee, MAX_DEFAULT_GAS_FEE_UGNOT) === null

    const handleNetworkChange = (key: string) => {
        // No local same-network guard: switchNetwork owns that rule now (it was
        // enforced five different ways at five call sites). Analytics still fires
        // only for a real switch because switchNetwork returns early otherwise —
        // so keep this check for the trackEvent, not for the switch itself.
        if (key === networkKey) return
        trackEvent("Network Switched", { to: key })
        // Was: write storage + reload IN PLACE. That could not switch anything —
        // the URL still carried the old /:network, so NetworkSync wrote it straight
        // back and reloaded again. switchNetwork navigates to the new prefix, which
        // is what the TopBar switcher has always done.
        switchNetwork(key)
    }

    const handleClearCache = () => {
        if (!window.confirm("Clear all Memba cached data? This will reset network preferences and cached usernames.")) return
        const keys = ["memba_usernames", "memba_settings", "memba_network", "memba_network_pref", "memba_board_visits"]
        keys.forEach(k => localStorage.removeItem(k))
        setSaved(true)
        setTimeout(() => window.location.reload(), 300)
    }

    const labelStyle: React.CSSProperties = {
        fontSize: "var(--pro-caption, 11px)", color: "var(--color-text-secondary)",
        fontFamily: "var(--font-ui, JetBrains Mono, monospace)",
        display: "block", marginBottom: 4,
    }

    const inputStyle: React.CSSProperties = {
        width: "100%", padding: "8px 12px", borderRadius: 8,
        border: "1px solid var(--color-k-edge)",
        background: "var(--color-k-elevated)", color: "var(--color-text)",
        fontFamily: "var(--font-ui, JetBrains Mono, monospace)", fontSize: "var(--pro-small, 12px)",
        boxSizing: "border-box",
    }

    const btnStyle: React.CSSProperties = {
        padding: "8px 16px", borderRadius: 8, border: "none",
        cursor: "pointer", fontFamily: "var(--font-ui, JetBrains Mono, monospace)",
        fontSize: "var(--pro-small, 12px)", fontWeight: 600,
    }

    return (
        <div id="settings-page" style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 600 }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--color-text)", margin: 0, display: "flex", alignItems: "center", gap: 8 }}><Gear size={22} /> Settings</h2>

            {saved && (
                <div style={{ padding: "8px 14px", borderRadius: 8, background: "rgba(0,212,170,0.08)", color: "var(--color-primary)", fontSize: "var(--pro-small, 12px)" }}>
                    ✓ Settings saved
                </div>
            )}
            {saveError && (
                <div role="alert" style={{ color: "var(--color-danger)" }}>Could not save gas defaults. Check browser storage and try again.</div>
            )}

            {/* Network — open by default */}
            <Section title="Network" icon={<Globe size={18} />} defaultOpen>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingTop: 8 }}>
                    {Object.entries(selectableNetworksFor(networkKey)).map(([key, net]) => (
                        <button
                            key={key}
                            id={`network-${key}`}
                            onClick={() => handleNetworkChange(key)}
                            style={{
                                ...btnStyle,
                                background: networkKey === key ? "var(--color-k-accent-tint)" : "var(--color-k-hover-surface)",
                                color: networkKey === key ? "var(--color-k-accent)" : "var(--color-k-dim)",
                                border: `1px solid ${networkKey === key ? "var(--color-k-accent-border)" : "var(--color-k-edge)"}`,
                            }}
                        >
                            {net.label}
                        </button>
                    ))}
                </div>
            </Section>

            {/* Theme */}
            <Section title="Appearance" icon={<SunDim size={18} />}>
                <div style={{ paddingTop: 8 }}><ThemeSelect onSelect={() => setSaved(true)} /></div>
                <p style={{ fontSize: "var(--pro-small, 13px)", color: "var(--color-text-secondary)", margin: 0 }}>
                    System follows your device appearance. Choose Light or Black to keep a fixed theme.
                </p>
            </Section>

            {/* Directory — moved from main nav */}
            <Section title="Directory" icon={<FolderOpen size={18} />}>
                <div style={{ paddingTop: 8 }}>
                    <p style={{ fontSize: "var(--pro-caption, 11px)", color: "var(--color-text-secondary)", fontFamily: "var(--font-ui, JetBrains Mono, monospace)", margin: "0 0 10px", lineHeight: 1.5 }}>
                        Browse on-chain packages, realms, and user profiles deployed on gno.land.
                    </p>
                    <button
                        id="settings-directory-btn"
                        className="k-btn-primary"
                        style={{ fontSize: "var(--pro-caption, 11px)", padding: "8px 16px" }}
                        onClick={() => navigate("/directory")}
                    >
                        📂 Open Directory →
                    </button>
                </div>
            </Section>

            {/* Gas Defaults */}
            <Section title="Gas Defaults" icon={<GasPump size={18} />}>
                <div style={{ paddingTop: 8 }}>
                    <label htmlFor="settings-gas-wanted" style={labelStyle}>Gas Wanted</label>
                    <input
                        id="settings-gas-wanted"
                        type="text"
                        inputMode="numeric"
                        value={gasDraft.gasWanted}
                        onChange={e => { setGasDraft(s => ({ ...s, gasWanted: e.target.value })); setSaved(false); setSaveError(false) }}
                        onBlur={() => commitGasDraft("gasWanted")}
                        onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur() }}
                        aria-invalid={wantedInvalid}
                        aria-describedby="settings-gas-wanted-help"
                        style={inputStyle}
                    />
                    <small id="settings-gas-wanted-help" style={{ color: wantedInvalid ? "var(--color-danger)" : "var(--color-text-secondary)" }}>
                        {wantedInvalid ? "Enter a whole number from 1 to 100,000,000." : "1–100,000,000 gas; deploys use 5× this limit."}
                    </small>
                    {gasConflict.gasWanted && (
                        <div role="alert" style={{ color: "var(--color-danger)" }}>
                            Gas Wanted changed in another tab. Choose which value to keep.
                            <button type="button" onClick={() => restoreLatestGasValue("gasWanted")}>Use latest value</button>
                            <button type="button" onClick={() => commitGasDraft("gasWanted", true)}>Save my value</button>
                        </div>
                    )}
                </div>
                <div>
                    <label htmlFor="settings-gas-fee" style={labelStyle}>Gas Fee (ugnot)</label>
                    <input
                        id="settings-gas-fee"
                        type="text"
                        inputMode="numeric"
                        value={gasDraft.gasFee}
                        onChange={e => { setGasDraft(s => ({ ...s, gasFee: e.target.value })); setSaved(false); setSaveError(false) }}
                        onBlur={() => commitGasDraft("gasFee")}
                        onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur() }}
                        aria-invalid={feeInvalid}
                        aria-describedby="settings-gas-fee-help"
                        style={inputStyle}
                    />
                    <small id="settings-gas-fee-help" style={{ color: feeInvalid ? "var(--color-danger)" : "var(--color-text-secondary)" }}>
                        {feeInvalid ? "Enter a whole number from 1 to 10,000,000 ugnot." : "1–10,000,000 ugnot (up to 10 GNOT)."}
                    </small>
                    {gasConflict.gasFee && (
                        <div role="alert" style={{ color: "var(--color-danger)" }}>
                            Gas Fee changed in another tab. Choose which value to keep.
                            <button type="button" onClick={() => restoreLatestGasValue("gasFee")}>Use latest value</button>
                            <button type="button" onClick={() => commitGasDraft("gasFee", true)}>Save my value</button>
                        </div>
                    )}
                </div>
            </Section>

            {/* Profile */}
            <Section title="Profile" icon={<User size={18} />}>
                <p style={{ fontSize: "var(--pro-small, 12px)", color: "var(--color-text-secondary)", margin: 0, paddingTop: 8 }}>
                    Edit your profile, connect GitHub, and manage social links.
                </p>
                <button
                    id="settings-profile-link"
                    onClick={() => navigate("/profile")}
                    style={{ ...btnStyle, background: "rgba(0,212,170,0.1)", color: "var(--color-primary)", alignSelf: "flex-start" }}
                >
                    Go to Profile →
                </button>
            </Section>

            {/* Advanced */}
            <Section title="Advanced" icon={<Wrench size={18} />}>
                <button
                    id="settings-clear-cache"
                    onClick={handleClearCache}
                    style={{ ...btnStyle, background: "rgba(255,59,48,0.08)", color: "var(--color-danger)", alignSelf: "flex-start", marginTop: 8 }}
                >
                    Clear Cache
                </button>
                <div style={{ fontSize: "var(--pro-caption, 10px)", color: "var(--color-text-dim)", fontFamily: "var(--font-ui, JetBrains Mono, monospace)" }}>
                    Memba v{APP_VERSION} · Chain: {GNO_CHAIN_ID}
                </div>
            </Section>
        </div>
    )
}
