import { Link, useLocation } from "react-router-dom"
import {
    House, ChartBar, Buildings, Coins, FolderOpen,
    Briefcase, User, Gear, Megaphone, PuzzlePiece,
    LinkSimpleHorizontal,
} from "@phosphor-icons/react"

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

    // Hide auth-only links when not connected
    if (auth && !connected) return null

    // Active state: exact match for "/" and "/dashboard", prefix match for others
    const isActive = to === "/" || to === "/dashboard"
        ? location.pathname === to
        : location.pathname.startsWith(to)

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
            to={to}
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

    return (
        <aside
            className={`k-sidebar${collapsed ? " collapsed" : ""}`}
            data-testid="sidebar"
            role="navigation"
            aria-label="Main"
        >
            {/* ── Header: Logo ──────────────────────────────────── */}
            <div className="k-sidebar-header">
                <Link to={connected ? "/dashboard" : "/"} aria-label="Memba home">
                    <img src="/memba-icon.png" alt="Memba" />
                    <span className="k-sidebar-logo-text">Memba</span>
                </Link>
                <button
                    className="k-sidebar-toggle"
                    onClick={onToggleCollapse}
                    aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                >
                    {collapsed ? "→" : "←"}
                </button>
            </div>

            {/* ── Section 1: Navigation ─────────────────────────── */}
            <nav className="k-sidebar-section" aria-label="Primary navigation">
                <SidebarLink to="/" icon={<House size={18} />} label="Home" connected={connected} collapsed={collapsed} />
                <SidebarLink to="/dashboard" icon={<ChartBar size={18} />} label="Dashboard" auth connected={connected} collapsed={collapsed} />
                <SidebarLink to="/dao" icon={<Buildings size={18} />} label="DAOs" badge={unvotedCount + notifUnreadCount} connected={connected} collapsed={collapsed} />
                <SidebarLink to="/tokens" icon={<Coins size={18} />} label="Tokens" connected={connected} collapsed={collapsed} />
                <SidebarLink to="/directory" icon={<FolderOpen size={18} />} label="Directory" connected={connected} collapsed={collapsed} />
                <SidebarLink to="/validators" icon={<LinkSimpleHorizontal size={18} />} label="Validators" connected={connected} collapsed={collapsed} />
                <SidebarLink to="/create" icon={<Briefcase size={18} />} label="Multisig" auth connected={connected} collapsed={collapsed} />
            </nav>

            {/* ── Section 2: Extensions ─────────────────────────── */}
            <nav className="k-sidebar-section" aria-label="Extensions">
                <SidebarLink to="/extensions" icon={<PuzzlePiece size={18} />} label="Extensions" connected={connected} collapsed={collapsed} />
            </nav>

            {/* ── Section 3: User (bottom-pinned) ──────────────── */}
            <div className="k-sidebar-user">
                <div className="k-sidebar-section">
                    {connected && address && (
                        <SidebarLink to={`/profile/${address}`} icon={<User size={18} />} label="Profile" connected={connected} collapsed={collapsed} />
                    )}
                    {connected && (
                        <SidebarLink to="/settings" icon={<Gear size={18} />} label="Settings" connected={connected} collapsed={collapsed} />
                    )}
                    <SidebarLink to="/feedback" icon={<Megaphone size={18} />} label="Feedback" connected={connected} collapsed={collapsed} />
                </div>
            </div>
        </aside>
    )
}
