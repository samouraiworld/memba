import { Link, useLocation } from "react-router-dom"
import { getPlugins } from "../../plugins"

// ── SidebarLink Sub-component ──────────────────────────────────────────
interface SidebarLinkProps {
    to: string
    icon: string
    label: string
    badge?: number
    badgeText?: string
    badgeInactive?: boolean
    auth?: boolean
    /** If true, link is hidden when auth requirement not met */
    connected: boolean
    collapsed: boolean
}

function SidebarLink({ to, icon, label, badge, badgeText, badgeInactive, auth, connected, collapsed }: SidebarLinkProps) {
    const location = useLocation()

    // Hide auth-only links when not connected
    if (auth && !connected) return null

    // Active state: exact match for "/" and "/dashboard", prefix match for others
    const isActive = to === "/" || to === "/dashboard"
        ? location.pathname === to
        : location.pathname.startsWith(to)

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
    collapsed: boolean
    onToggleCollapse: () => void
}

export function Sidebar({ connected, address, unvotedCount, collapsed, onToggleCollapse }: SidebarProps) {
    const plugins = getPlugins()

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
                <SidebarLink to="/" icon="🏠" label="Home" connected={connected} collapsed={collapsed} />
                <SidebarLink to="/dashboard" icon="📊" label="Dashboard" auth connected={connected} collapsed={collapsed} />
                <SidebarLink to="/dao" icon="🏛️" label="DAOs" badge={unvotedCount} connected={connected} collapsed={collapsed} />
                <SidebarLink to="/tokens" icon="🪙" label="Tokens" connected={connected} collapsed={collapsed} />
                <SidebarLink to="/directory" icon="📁" label="Directory" connected={connected} collapsed={collapsed} />
                <SidebarLink to="/create" icon="💼" label="Multisig" auth connected={connected} collapsed={collapsed} />
            </nav>

            {/* ── Section 2: Plugins ────────────────────────────── */}
            <nav className="k-sidebar-section" aria-label="Plugins">
                <div className="k-sidebar-section-label">Plugins</div>
                {plugins.map(p => (
                    <SidebarLink
                        key={p.id}
                        to={`/plugins/${p.id}`}
                        icon={p.icon}
                        label={p.name}
                        connected={connected}
                        collapsed={collapsed}
                    />
                ))}
            </nav>

            {/* ── Section 3: User (bottom-pinned) ──────────────── */}
            <div className="k-sidebar-user">
                <div className="k-sidebar-section">
                    {connected && address && (
                        <SidebarLink to={`/profile/${address}`} icon="👤" label="Profile" connected={connected} collapsed={collapsed} />
                    )}
                    {connected && (
                        <SidebarLink to="/settings" icon="⚙️" label="Settings" connected={connected} collapsed={collapsed} />
                    )}
                    <SidebarLink to="/feedback" icon="📣" label="Feedback" connected={connected} collapsed={collapsed} />
                </div>
            </div>
        </aside>
    )
}
