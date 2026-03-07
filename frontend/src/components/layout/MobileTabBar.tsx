import { useState, useCallback, useEffect } from "react"
import { Link, useLocation } from "react-router-dom"
import { BottomSheet } from "./BottomSheet"
import { getPlugins } from "../../plugins"
import {
    House, Buildings, Coins, FolderOpen,
    DotsThree, User, Gear, Briefcase, Megaphone, PuzzlePiece,
} from "@phosphor-icons/react"

interface MobileTabBarProps {
    connected: boolean
    address: string | null
    network: {
        networkKey: string
        networks: Record<string, { label: string }>
        switchNetwork: (key: string) => void
    }
}

// ── Tab definition ─────────────────────────────────────────────────────
const TABS = [
    { to: "/", icon: <House size={20} />, label: "Home" },
    { to: "/dao", icon: <Buildings size={20} />, label: "DAOs" },
    { to: "/tokens", icon: <Coins size={20} />, label: "Tokens" },
    { to: "/directory", icon: <FolderOpen size={20} />, label: "Directory" },
] as const

export function MobileTabBar({ connected, address, network }: MobileTabBarProps) {
    const location = useLocation()
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

    const isTabActive = useCallback((to: string) => {
        if (to === "/") return location.pathname === "/"
        return location.pathname.startsWith(to)
    }, [location.pathname])

    const isMoreActive = location.pathname.startsWith("/profile")
        || location.pathname.startsWith("/settings")
        || location.pathname.startsWith("/create")
        || location.pathname.startsWith("/feedback")
        || location.pathname.startsWith("/plugins")

    return (
        <>
            <nav className="k-mobile-tabbar" data-testid="mobile-tabbar" aria-label="Mobile navigation">
                {TABS.map(tab => (
                    <Link
                        key={tab.to}
                        to={tab.to}
                        className={`k-mobile-tab${isTabActive(tab.to) ? " active" : ""}`}
                        aria-current={isTabActive(tab.to) ? "page" : undefined}
                    >
                        <span className="k-mobile-tab-icon">{tab.icon}</span>
                        <span>{tab.label}</span>
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
                    {/* User section */}
                    <div className="k-sidebar-section">
                        <div className="k-sidebar-section-label">Account</div>
                        {connected && address && (
                            <Link to={`/profile/${address}`} className="k-sidebar-link" onClick={() => setSheetOpen(false)}>
                                <span className="k-sidebar-icon"><User size={18} /></span>
                                <span className="k-sidebar-label">Profile</span>
                            </Link>
                        )}
                        {connected && (
                            <Link to="/settings" className="k-sidebar-link" onClick={() => setSheetOpen(false)}>
                                <span className="k-sidebar-icon"><Gear size={18} /></span>
                                <span className="k-sidebar-label">Settings</span>
                            </Link>
                        )}
                        {connected && (
                            <Link to="/create" className="k-sidebar-link" onClick={() => setSheetOpen(false)}>
                                <span className="k-sidebar-icon"><Briefcase size={18} /></span>
                                <span className="k-sidebar-label">Multisig</span>
                            </Link>
                        )}
                        <Link to="/feedback" className="k-sidebar-link" onClick={() => setSheetOpen(false)}>
                            <span className="k-sidebar-icon"><Megaphone size={18} /></span>
                            <span className="k-sidebar-label">Feedback</span>
                        </Link>
                    </div>

                    {/* Plugins section */}
                    <div className="k-sidebar-section">
                        <div className="k-sidebar-section-label">Plugins</div>
                        {plugins.map(p => (
                            lastVisitedDAO ? (
                                <Link
                                    key={p.id}
                                    to={`/dao/${lastVisitedDAO}/plugin/${p.id}`}
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
                                    title="Select a DAO first"
                                    aria-disabled="true"
                                >
                                    <span className="k-sidebar-icon"><PuzzlePiece size={18} /></span>
                                    <span className="k-sidebar-label">{p.name}</span>
                                </span>
                            )
                        ))}
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
                                    background: "rgba(0,212,170,0.06)", border: "1px solid #1a1a1a",
                                    color: "#888", fontSize: 12, fontFamily: "JetBrains Mono, monospace",
                                    padding: "8px 12px", borderRadius: 6, cursor: "pointer",
                                    outline: "none",
                                }}
                            >
                                {Object.entries(network.networks).map(([key, net]) => (
                                    <option key={key} value={key} style={{ background: "#111", color: "#ccc" }}>
                                        {net.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>
            </BottomSheet>
        </>
    )
}
