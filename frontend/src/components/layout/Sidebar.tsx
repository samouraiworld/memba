import { useState } from "react"
import { Link, useLocation } from "react-router-dom"
import { Gear } from "@phosphor-icons/react"
import { useNetworkKey } from "../../hooks/useNetworkNav"
import { canApplyForMembership } from "../../lib/quests"
import { ZOOMA_ADDRESS } from "../../lib/membaDAO"
import { NAV, MODE_SECTIONS, navForGroup } from "../../lib/navManifest"
import { navFlagOn } from "../../lib/navFlags"

// ── SidebarLink Sub-component ──────────────────────────────────────────
interface SidebarLinkProps {
    to: string
    icon: React.ReactNode
    label: string
    badge?: number
    badgeText?: string
    badgeInactive?: boolean
    auth?: boolean
    /** If true, link is hidden when auth requirement not met */
    connected: boolean
    collapsed: boolean
    disabled?: boolean
    disabledTooltip?: string
}

function SidebarLink({ to, icon, label, badge, badgeText, badgeInactive, auth, connected, collapsed, disabled, disabledTooltip }: SidebarLinkProps) {
    const location = useLocation()
    const networkKey = useNetworkKey()
    const networkTo = `/${networkKey}${to}`

    // Hide auth-only links when not connected
    if (auth && !connected) return null

    // Active state: exact match for home/dashboard, prefix match for others
    const isActive = to === "/" || to === "/dashboard"
        ? location.pathname === networkTo
        : location.pathname.startsWith(networkTo)

    if (disabled) {
        return (
            <span
                className="k-sidebar-link disabled"
                title={disabledTooltip || "Not available"}
                aria-disabled="true"
            >
                <span className="k-sidebar-icon">{icon}</span>
                <span className="k-sidebar-label">{label}</span>
            </span>
        )
    }

    return (
        <Link
            to={networkTo}
            className={`k-sidebar-link${isActive ? " active" : ""}`}
            aria-current={isActive ? "page" : undefined}
            title={collapsed ? label : undefined}
        >
            <span className="k-sidebar-icon">{icon}</span>
            <span className="k-sidebar-label">{label}</span>
            {badge != null && badge > 0 && (
                <span className="k-sidebar-badge">{badge}</span>
            )}
            {badgeText && (
                <span className={`k-sidebar-badge${badgeInactive ? " inactive" : ""}`}>{badgeText}</span>
            )}
            {badge != null && badge > 0 && (
                <span className="k-notif-dot" />
            )}
        </Link>
    )
}

// ── Manifest-sourced link ─────────────────────────────────────────────
// Route + label + icon come from the single nav manifest (no duplication
// with the mobile tab bar); per-link chrome (badges, auth, env-flag pills)
// stays here as props.
function navById(id: string) {
    const e = NAV.find(n => n.id === id)
    if (!e) throw new Error(`Sidebar: navManifest is missing id "${id}"`)
    return e
}

function ManifestLink({ id, ...rest }: { id: string } & Omit<SidebarLinkProps, "to" | "icon" | "label">) {
    const e = navById(id)
    const Icon = e.Icon
    return <SidebarLink to={e.to} icon={<Icon size={18} />} label={e.label} {...rest} />
}

// ── Cmd+K Discovery Hint ──────────────────────────────────────────────

const CMDK_HINT_KEY = "memba_cmdk_seen"

function CmdKHint() {
    const [visible, setVisible] = useState(() => {
        try {
            return !localStorage.getItem(CMDK_HINT_KEY)
        } catch {
            return false
        }
    })

    if (!visible) return null

    const dismiss = () => {
        setVisible(false)
        try { localStorage.setItem(CMDK_HINT_KEY, "1") } catch { /* */ }
    }

    return (
        <button
            className="k-sidebar-cmdk-hint"
            onClick={dismiss}
            title="Press ⌘K to open the command palette"
        >
            <span className="k-sidebar-cmdk-hint__key">⌘K</span>
            <span className="k-sidebar-cmdk-hint__text">Quick actions</span>
        </button>
    )
}

// ── Sidebar Component ──────────────────────────────────────────────────
interface SidebarProps {
    connected: boolean
    address: string | null
    unvotedCount: number
    notifUnreadCount: number
    collapsed: boolean
    onToggleCollapse: () => void
}

export function Sidebar({ connected, address, unvotedCount, notifUnreadCount, collapsed, onToggleCollapse }: SidebarProps) {
    const nk = useNetworkKey()

    return (
        <aside
            className={`k-sidebar${collapsed ? " collapsed" : ""}`}
            data-testid="sidebar"
            role="navigation"
            aria-label="Main"
        >
            {/* ── Header: Logo ──────────────────────────────────── */}
            <div className="k-sidebar-header">
                <Link to={connected ? `/${nk}/dashboard` : `/${nk}/`} aria-label="Memba home">
                    <img src="/memba-icon.png" alt="Memba" />
                    <span className="k-sidebar-logo-text">Memba</span>
                </Link>
                <button
                    className="k-sidebar-toggle"
                    onClick={onToggleCollapse}
                    aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                >
                    {collapsed ? "\u2192" : "\u2190"}
                </button>
            </div>

            {/* ── W6.2 4-mode IA: Wallet / Govern / Launch / Explore ──────
                Sections are MANIFEST-DRIVEN (navForGroup) — adding an entry to
                navManifest.ts places it; the sidebar no longer hand-curates.
                Per-entry chrome that can't live in the manifest stays in the
                maps below (badges, flag pills, admin gating). */}
            <nav className="k-sidebar-section" aria-label="Primary navigation">
                {!connected && <ManifestLink id="home" connected={connected} collapsed={collapsed} />}
                {MODE_SECTIONS.map(({ key, label }) => {
                    const entries = navForGroup(key).filter(e => e.id !== "home")
                    const visible = entries.filter(e => !e.requiresAuth || connected)
                    if (visible.length === 0) return null
                    return (
                        <div key={key} className="k-sidebar-mode" data-testid={`nav-mode-${key}`}>
                            {!collapsed && <div className="k-sidebar-mode-label">{label}</div>}
                            {entries.map(e => {
                                // Flag-gated entries: live flag → "new" pill; off → "soon" pill (inactive).
                                const flagOn = navFlagOn(e.flag)
                                return (
                                    <ManifestLink
                                        key={e.id}
                                        id={e.id}
                                        auth={e.requiresAuth}
                                        badge={e.id === "dao" ? unvotedCount + notifUnreadCount : undefined}
                                        badgeText={e.flag ? (flagOn ? "new" : "soon") : undefined}
                                        badgeInactive={e.flag ? !flagOn : undefined}
                                        connected={connected}
                                        collapsed={collapsed}
                                    />
                                )
                            })}
                        </div>
                    )
                })}
                {address === ZOOMA_ADDRESS && (
                    <SidebarLink to="/quest-admin" icon={<Gear size={18} />} label="Quest Admin" connected={connected} collapsed={collapsed} />
                )}
                {!collapsed && <CmdKHint />}
            </nav>

            {/* ── Section 3: User (bottom-pinned) ──────────────── */}
            <div className="k-sidebar-user">
                {/* Org indicator — hidden until Teams feature is production-ready */}
                <div className="k-sidebar-section">
                    {connected && address && (() => {
                        const p = navById("profile")
                        const PIcon = p.Icon
                        // Profile is the one entry whose path needs the address appended.
                        return <SidebarLink to={`${p.to}/${address}`} icon={<PIcon size={18} />} label={p.label} connected={connected} collapsed={collapsed} />
                    })()}
                    {/* Teams hidden until production-ready */}
                    {connected && (
                        <ManifestLink id="settings" connected={connected} collapsed={collapsed} />
                    )}
                    {connected && (
                        <ManifestLink
                            id="candidature"
                            connected={connected}
                            collapsed={collapsed}
                            badge={canApplyForMembership() ? 1 : undefined}
                        />
                    )}
                    <ManifestLink id="feedback" connected={connected} collapsed={collapsed} />
                </div>
            </div>
        </aside>
    )
}
