import { useState, useCallback, useEffect } from "react"
import { Link, useLocation } from "react-router-dom"
import { BottomSheet } from "./BottomSheet"
import { getPlugins } from "../../plugins"
import { useNetworkKey } from "../../hooks/useNetworkNav"
import { VISIBLE_NETWORKS } from "../../lib/config"
import { getTheme, setTheme, type Theme } from "../../lib/themeStore"
import { mobilePrimaryTabs, mobileMoreNav, mobileMoreAccount, type NavEntry } from "../../lib/navManifest"
import { DotsThree, PuzzlePiece, SunDim, Moon, MagnifyingGlass } from "@phosphor-icons/react"

// Member relabels the Alerts destination "Activity" in the primary tab row.
const TAB_LABEL_OVERRIDE: Record<string, string> = { alerts: "Activity" }

interface MobileTabBarProps {
    connected: boolean
    address: string | null
    network: {
        networkKey: string
        networks: Record<string, { label: string }>
        switchNetwork: (key: string) => void
    }
}

export function MobileTabBar({ connected, address, network }: MobileTabBarProps) {
    const location = useLocation()
    const nk = useNetworkKey()
    const [sheetOpen, setSheetOpen] = useState(false)
    const plugins = getPlugins()
    const [lastVisitedDAO, setLastVisitedDAO] = useState(() => localStorage.getItem("memba_last_dao_slug"))

    // Refresh when DAO slug changes
    useEffect(() => {
        const handler = () => setLastVisitedDAO(localStorage.getItem("memba_last_dao_slug"))
        window.addEventListener("storage", handler)
        window.addEventListener("memba:daoVisited", handler)
        return () => {
            window.removeEventListener("storage", handler)
            window.removeEventListener("memba:daoVisited", handler)
        }
    }, [])

    const np = (path: string) => `/${nk}${path}`

    const isTabActive = useCallback((to: string) => {
        const full = `/${nk}${to}`
        if (to === "/") return location.pathname === full
        return location.pathname.startsWith(full)
    }, [location.pathname, nk])

    const isMoreActive = location.pathname.startsWith(np("/profile"))
        || location.pathname.startsWith(np("/settings"))
        || location.pathname.startsWith(np("/create"))
        || location.pathname.startsWith(np("/feedback"))
        || location.pathname.startsWith(np("/plugins"))
        // /alerts is a member tab (Activity) — only count it for More in visitor mode
        || (!connected && location.pathname.startsWith(np("/alerts")))
        || location.pathname.startsWith(np("/dashboard"))
        || location.pathname.startsWith(np("/validators"))
        || location.pathname.startsWith(np("/gnolove"))
        || location.pathname.startsWith(np("/extensions"))
        || location.pathname.startsWith(np("/multisig"))
        || location.pathname.startsWith(np("/organizations"))

    // Primary tabs come from the single nav manifest (route-mapped set).
    const activeTabs = mobilePrimaryTabs(connected)

    // Render a "More"-sheet nav row from a manifest entry. Profile is the one
    // entry whose path needs the connected address appended.
    const renderMoreLink = (entry: NavEntry) => {
        if (entry.id === "profile" && !address) return null
        const to = entry.id === "profile" ? `${entry.to}/${address}` : entry.to
        const Icon = entry.Icon
        return (
            <Link key={entry.id} to={np(to)} className="k-sidebar-link" onClick={() => setSheetOpen(false)}>
                <span className="k-sidebar-icon"><Icon size={18} /></span>
                <span className="k-sidebar-label">{entry.label}</span>
            </Link>
        )
    }

    return (
        <div className="k-mobile-only">
            <nav className="k-mobile-tabbar" data-testid="mobile-tabbar" aria-label="Mobile navigation">
                {activeTabs.map(tab => (
                    <Link
                        key={tab.id}
                        to={np(tab.to)}
                        className={`k-mobile-tab${isTabActive(tab.to) ? " active" : ""}`}
                        aria-current={isTabActive(tab.to) ? "page" : undefined}
                    >
                        <span className="k-mobile-tab-icon"><tab.Icon size={20} /></span>
                        <span>{TAB_LABEL_OVERRIDE[tab.id] ?? tab.label}</span>
                    </Link>
                ))}
                <button
                    className={`k-mobile-tab${isMoreActive || sheetOpen ? " active" : ""}`}
                    onClick={() => setSheetOpen(v => !v)}
                    aria-expanded={sheetOpen}
                    aria-controls="mobile-more-sheet"
                >
                    <span className="k-mobile-tab-icon"><DotsThree size={20} weight="bold" /></span>
                    <span>More</span>
                </button>
            </nav>

            <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)}>
                <div id="mobile-more-sheet">
                    {/* Search — the touch entry to the command palette (Cmd+K has no
                        mobile equivalent), dispatched as a decoupled window event. */}
                    <div className="k-sidebar-section">
                        <button
                            type="button"
                            className="k-sidebar-link"
                            onClick={() => {
                                window.dispatchEvent(new CustomEvent("open-command-palette"))
                                setSheetOpen(false)
                            }}
                            style={{ width: "100%", background: "none", border: "none", cursor: "pointer", textAlign: "left", font: "inherit" }}
                        >
                            <span className="k-sidebar-icon"><MagnifyingGlass size={18} /></span>
                            <span className="k-sidebar-label">Search…</span>
                        </button>
                    </div>

                    {/* Navigate section — overflow nav, sourced from the manifest */}
                    <div className="k-sidebar-section">
                        <div className="k-sidebar-section-label">Navigate</div>
                        {mobileMoreNav(connected).map(renderMoreLink)}
                    </div>

                    {/* Account section — sourced from the manifest */}
                    <div className="k-sidebar-section">
                        <div className="k-sidebar-section-label">Account</div>
                        {mobileMoreAccount(connected).map(renderMoreLink)}
                    </div>

                    {/* Plugins section */}
                    <div className="k-sidebar-section">
                        <div className="k-sidebar-section-label">Plugins</div>
                        {plugins.map(p => (
                            lastVisitedDAO ? (
                                <Link
                                    key={p.id}
                                    to={np(`/dao/${lastVisitedDAO}/plugin/${p.id}`)}
                                    className="k-sidebar-link"
                                    onClick={() => setSheetOpen(false)}
                                >
                                    <span className="k-sidebar-icon"><PuzzlePiece size={18} /></span>
                                    <span className="k-sidebar-label">{p.name}</span>
                                </Link>
                            ) : (
                                <span
                                    key={p.id}
                                    className="k-sidebar-link disabled"
                                    aria-disabled="true"
                                    onClick={() => setSheetOpen(false)}
                                >
                                    <span className="k-sidebar-icon"><PuzzlePiece size={18} /></span>
                                    <span className="k-sidebar-label">{p.name}</span>
                                    <small style={{ fontSize: 9, color: 'var(--color-k-muted)', marginLeft: 'auto' }}>Select a DAO</small>
                                </span>
                            )
                        ))}
                    </div>

                    {/* Theme section */}
                    <div className="k-sidebar-section">
                        <div className="k-sidebar-section-label">Theme</div>
                        <MobileThemeToggle onSelect={() => setSheetOpen(false)} />
                    </div>

                    {/* Network section */}
                    <div className="k-sidebar-section">
                        <div className="k-sidebar-section-label">Network</div>
                        <div style={{ padding: "4px 16px" }}>
                            <select
                                value={network.networkKey}
                                onChange={(e) => { network.switchNetwork(e.target.value); setSheetOpen(false) }}
                                title="Switch network"
                                style={{
                                    width: "100%",
                                    background: "var(--color-k-accent-subtle)", border: "1px solid var(--color-k-edge)",
                                    color: "var(--color-text-secondary)", fontSize: 12, fontFamily: "JetBrains Mono, monospace",
                                    padding: "8px 12px", borderRadius: 6, cursor: "pointer",
                                    outline: "none",
                                }}
                            >
                                {Object.entries(VISIBLE_NETWORKS).map(([key, net]) => (
                                    <option key={key} value={key} style={{ background: "var(--color-border)", color: "var(--color-text-secondary)" }}>
                                        {net.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>
            </BottomSheet>
        </div>
    )
}

function MobileThemeToggle({ onSelect }: { onSelect: () => void }) {
    const [current, setCurrent] = useState<Theme>(getTheme)

    return (
        <div style={{ display: "flex", gap: 8, padding: "4px 16px" }}>
            {(["dark", "light"] as const).map(t => (
                <button
                    key={t}
                    onClick={() => { setTheme(t); setCurrent(t); onSelect() }}
                    style={{
                        flex: 1, padding: "8px 12px", borderRadius: 6,
                        fontSize: 12, fontFamily: "JetBrains Mono, monospace",
                        cursor: "pointer", border: "1px solid",
                        transition: "all 0.15s",
                        background: current === t ? "var(--color-k-accent-tint)" : "var(--color-bg-hover)",
                        color: current === t ? "var(--color-primary)" : "var(--color-text-secondary)",
                        borderColor: current === t ? "var(--color-k-accent-border)" : "var(--color-border)",
                        fontWeight: current === t ? 600 : 400,
                    }}
                >
                    {t === "dark" ? <Moon size={14} weight="bold" style={{ marginRight: 4 }} /> : <SunDim size={14} weight="bold" style={{ marginRight: 4 }} />}
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
            ))}
        </div>
    )
}
