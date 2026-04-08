import { useState } from "react"
import { Link, useLocation } from "react-router-dom"
import {
    House, ChartBar, Buildings, Coins, FolderOpen,
    Briefcase, User, Gear, Megaphone, PuzzlePiece,
    LinkSimpleHorizontal, Bell, Heart, UsersThree, Robot,
    Handshake, ImageSquare, Bank, GameController, Trophy,
} from "@phosphor-icons/react"
import { useOrg } from "../../contexts/OrgContext"
import { useNetworkKey } from "../../hooks/useNetworkNav"
import { canApplyForMembership } from "../../lib/quests"

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

// ── Sidebar Extensions (collapsible) ──────────────────────────────────

const SIDEBAR_EXT_KEY = "memba_sidebar_ext"

function SidebarExtensions({ connected, collapsed }: { connected: boolean; collapsed: boolean }) {
    const [expanded, setExpanded] = useState(() => {
        try { return localStorage.getItem(SIDEBAR_EXT_KEY) === "1" } catch { return false }
    })

    const toggle = () => {
        const next = !expanded
        setExpanded(next)
        try { localStorage.setItem(SIDEBAR_EXT_KEY, next ? "1" : "0") } catch { /* */ }
    }

    return (
        <nav className="k-sidebar-section" aria-label="Extensions">
            <SidebarLink to="/extensions" icon={<PuzzlePiece size={18} />} label="Extensions" connected={connected} collapsed={collapsed} />
            {!collapsed && (
                <button
                    className="k-sidebar-expand-btn"
                    onClick={toggle}
                    aria-expanded={expanded}
                    title={expanded ? "Hide upcoming features" : "Show upcoming features"}
                >
                    <span className="k-sidebar-expand-caret" data-open={expanded}>▸</span>
                    <span>Upcoming</span>
                </button>
            )}
            {expanded && (
                <>
                    <SidebarLink to="/marketplace" icon={<Robot size={18} />} label="Marketplace" badgeText="soon" badgeInactive connected={connected} collapsed={collapsed} />
                    <SidebarLink to="/services" icon={<Handshake size={18} />} label="Services" badgeText="soon" badgeInactive connected={connected} collapsed={collapsed} />
                    <SidebarLink to="/nft" icon={<ImageSquare size={18} />} label="NFT" badgeText="soon" badgeInactive connected={connected} collapsed={collapsed} />
                </>
            )}
        </nav>
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
    const { activeOrgName, isOrgMode } = useOrg()
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

            {/* ── Section 1: Navigation ─────────────────────────── */}
            <nav className="k-sidebar-section" aria-label="Primary navigation">
                {!connected && <SidebarLink to="/" icon={<House size={18} />} label="Home" connected={connected} collapsed={collapsed} />}
                <SidebarLink to="/dashboard" icon={<ChartBar size={18} />} label="Dashboard" auth connected={connected} collapsed={collapsed} />
                <SidebarLink to="/dao" icon={<Buildings size={18} />} label="DAOs" badge={unvotedCount + notifUnreadCount} connected={connected} collapsed={collapsed} />
                <SidebarLink to="/tokens" icon={<Coins size={18} />} label="Tokens" connected={connected} collapsed={collapsed} />
                <SidebarLink to="/directory" icon={<FolderOpen size={18} />} label="Directory" connected={connected} collapsed={collapsed} />
                <SidebarLink to="/validators" icon={<LinkSimpleHorizontal size={18} />} label="Validators" connected={connected} collapsed={collapsed} />
                <SidebarLink to="/alerts" icon={<Bell size={18} />} label="Alerts" connected={connected} collapsed={collapsed} />
                <SidebarLink to="/multisig" icon={<Briefcase size={18} />} label="Multisig" auth connected={connected} collapsed={collapsed} />
                <SidebarLink to="/gnolove" icon={<Heart size={18} />} label="Gnolove" connected={connected} collapsed={collapsed} />
                <SidebarLink to="/quests" icon={<GameController size={18} />} label="Quests" connected={connected} collapsed={collapsed} />
                <SidebarLink to="/leaderboard" icon={<Trophy size={18} />} label="Leaderboard" connected={connected} collapsed={collapsed} />
                {!collapsed && <CmdKHint />}
            </nav>

            {/* ── Section 2: Extensions (collapsible "coming soon" items) ── */}
            <SidebarExtensions connected={connected} collapsed={collapsed} />

            {/* ── Section 3: User (bottom-pinned) ──────────────── */}
            <div className="k-sidebar-user">
                {/* Org indicator — only when in org mode */}
                {connected && isOrgMode && (
                    <div className="k-sidebar-org-badge" title={`Team: ${activeOrgName}`}>
                        <Link to={`/${nk}/organizations`} className="k-sidebar-org-badge-link">
                            <span className="k-sidebar-org-badge-dot" />
                            {!collapsed && <span className="k-sidebar-org-badge-name">{activeOrgName}</span>}
                        </Link>
                    </div>
                )}
                <div className="k-sidebar-section">
                    {connected && address && (
                        <SidebarLink to={`/profile/${address}`} icon={<User size={18} />} label="Profile" connected={connected} collapsed={collapsed} />
                    )}
                    {connected && (
                        <SidebarLink to="/organizations" icon={<UsersThree size={18} />} label="Teams" badgeText="beta" connected={connected} collapsed={collapsed} />
                    )}
                    {connected && (
                        <SidebarLink to="/settings" icon={<Gear size={18} />} label="Settings" connected={connected} collapsed={collapsed} />
                    )}
                    {connected && (
                        <SidebarLink
                            to="/candidature"
                            icon={<Bank size={18} />}
                            label="Candidature"
                            connected={connected}
                            collapsed={collapsed}
                            badge={canApplyForMembership() ? 1 : undefined}
                        />
                    )}
                    <SidebarLink to="/feedback" icon={<Megaphone size={18} />} label="Feedback" connected={connected} collapsed={collapsed} />
                </div>
            </div>
        </aside>
    )
}
