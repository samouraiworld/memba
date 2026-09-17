import { useState, useCallback, useRef } from "react"
import { Link, useLocation } from "react-router-dom"
import { BottomSheet } from "./BottomSheet"
import { ActFab } from "./ActFab"
import { useNetworkKey } from "../../hooks/useNetworkNav"
import { PRO_NAV_GROUPS, PRO_PRIMARY_IDS, proEntries, proRouteActive } from "../../lib/proNavigation"
import { selectableNetworksFor, PRO_SHELL_ENABLED } from "../../lib/config"
import { ThemeSelect } from "../ui/ThemeSelect"
import { mobilePrimaryTabs, mobileMoreNav, mobileMoreAccount, type NavEntry } from "../../lib/navManifest"
import { navFlagOn } from "../../lib/navFlags"
import type { LayoutContext } from "../../types/layout"
import { DotsThree, MagnifyingGlass } from "@phosphor-icons/react"

// Member relabels the Alerts destination "Activity" in the primary tab row.
const TAB_LABEL_OVERRIDE: Record<string, string> = { alerts: "Activity" }

interface MobileTabBarProps {
    connected: boolean
    address: string | null
    auth: LayoutContext["auth"]
    network: {
        networkKey: string
        networks: Record<string, { label: string }>
        switchNetwork: (key: string) => void
    }
    feedReplyUnread?: number
}

export function MobileTabBar({ connected, address, auth, network, feedReplyUnread = 0 }: MobileTabBarProps) {
    const location = useLocation()
    const nk = useNetworkKey()
    const [sheetOpen, setSheetOpen] = useState(false)
    const moreButtonRef = useRef<HTMLButtonElement>(null)
    const np = (path: string) => `/${nk}${path}`

    const isTabActive = useCallback((to: string) => {
        if (PRO_SHELL_ENABLED) return proRouteActive(location.pathname, nk, to)
        const full = `/${nk}${to}`
        if (to === "/") return location.pathname === full
        return location.pathname.startsWith(full)
    }, [location.pathname, nk])

    const legacyMoreActive = location.pathname.startsWith(np("/profile"))
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
    const activeTabs = PRO_SHELL_ENABLED ? proEntries(PRO_PRIMARY_IDS, connected) : mobilePrimaryTabs(connected)
    const isMoreActive = PRO_SHELL_ENABLED ? !activeTabs.some(tab => isTabActive(tab.to)) : legacyMoreActive

    // Render a "More"-sheet nav row from a manifest entry. Profile is the one
    // entry whose path needs the connected address appended.
    const renderMoreLink = (entry: NavEntry) => {
        if (entry.id === "profile" && !address) return null
        const to = entry.id === "profile" ? `${entry.to}/${address}` : entry.to
        const Icon = entry.Icon
        // A flagged-but-off entry stays discoverable (like the desktop sidebar)
        // but is badged "soon" so mobile matches desktop; tapping it lands on
        // the route's Coming-Soon gate.
        const soon = entry.flag ? !navFlagOn(entry.flag) : false
        return (
            <Link key={entry.id} to={np(to)} className={`k-sidebar-link${PRO_SHELL_ENABLED && isTabActive(to) ? " active" : ""}`} aria-current={PRO_SHELL_ENABLED && isTabActive(to) ? "page" : undefined} aria-label={PRO_SHELL_ENABLED ? `${entry.label}${soon ? ", coming soon" : ""}${entry.id === "feed" && feedReplyUnread > 0 ? `, ${feedReplyUnread} new replies` : ""}` : undefined} onClick={() => setSheetOpen(false)}>
                <span className="k-sidebar-icon"><Icon size={18} /></span>
                <span className="k-sidebar-label">{entry.label}</span>
                {PRO_SHELL_ENABLED && entry.id === "feed" && feedReplyUnread > 0 && <span className="k-sidebar-badge" aria-label={`${feedReplyUnread} new replies`}>{feedReplyUnread > 9 ? "9+" : feedReplyUnread}</span>}
                {soon && <span className="k-sidebar-badge inactive">soon</span>}
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
                        <span className="k-mobile-tab-icon">
                            <tab.Icon size={20} />
                            {tab.id === "feed" && feedReplyUnread > 0 && (
                                <span className="k-mobile-tab-dot" aria-label={`${feedReplyUnread} new replies`} />
                            )}
                        </span>
                        <span>{TAB_LABEL_OVERRIDE[tab.id] ?? tab.label}</span>
                    </Link>
                ))}
                <button
                    className={`k-mobile-tab${isMoreActive || sheetOpen ? " active" : ""}`}
                    onClick={() => setSheetOpen(v => !v)}
                    aria-expanded={sheetOpen}
                    aria-controls="mobile-more-sheet"
                    ref={moreButtonRef}
                >
                    <span className="k-mobile-tab-icon"><DotsThree size={20} weight="bold" /></span>
                    <span>More</span>
                    {PRO_SHELL_ENABLED && feedReplyUnread > 0 && <span className="pro-more-dot" aria-label={`${feedReplyUnread} new replies`} />}
                </button>
            </nav>

            {/* ⊕ "Act" — floating quick-action button (connected members only) */}
            <ActFab connected={connected} auth={auth} />

            <BottomSheet open={sheetOpen} containFocus={PRO_SHELL_ENABLED} returnFocusRef={PRO_SHELL_ENABLED ? moreButtonRef : undefined} onClose={() => setSheetOpen(false)}>
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

                    {PRO_SHELL_ENABLED ? PRO_NAV_GROUPS.map(group => {
                        const entries = proEntries(group.ids, connected).filter(e => !PRO_PRIMARY_IDS.includes(e.id) && e.showOn !== "desktop")
                        return entries.length ? <div className="k-sidebar-section" key={group.label}><div className="k-sidebar-section-label">{group.label}</div>{entries.map(renderMoreLink)}</div> : null
                    }) : <>
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

                    </>}
                    {/* Theme section */}
                    <div className="k-sidebar-section">
                        <div className="k-sidebar-section-label">Theme</div>
                        <div style={{ padding: "4px 16px" }}><ThemeSelect onSelect={() => setSheetOpen(false)} /></div>
                    </div>

                    {/* Network section */}
                    <div className="k-sidebar-section">
                        <div className="k-sidebar-section-label">{PRO_SHELL_ENABLED ? <label htmlFor="pro-mobile-network">Switch network</label> : "Network"}</div>
                        <div style={{ padding: "4px 16px" }}>
                            <select
                                id={PRO_SHELL_ENABLED ? "pro-mobile-network" : undefined}
                                value={network.networkKey}
                                onChange={(e) => { network.switchNetwork(e.target.value); setSheetOpen(false) }}
                                title="Switch network"
                                style={{
                                    width: "100%",
                                    background: "var(--color-k-accent-subtle)", border: "1px solid var(--color-k-edge)",
                                    color: "var(--color-text-secondary)", fontSize: "var(--pro-small, 12px)", fontFamily: "var(--font-ui, JetBrains Mono, monospace)",
                                    padding: "8px 12px", borderRadius: 6, cursor: "pointer",
                                    outline: "none",
                                }}
                            >
                                {Object.entries(selectableNetworksFor(network.networkKey)).map(([key, net]) => (
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
