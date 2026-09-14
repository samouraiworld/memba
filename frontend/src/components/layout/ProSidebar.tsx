import { Link, useLocation } from 'react-router-dom'
import { ArrowLeft, ArrowRight, MagnifyingGlass } from '@phosphor-icons/react'
import { useNetworkKey } from '../../hooks/useNetworkNav'
import { canApplyForMembership } from '../../lib/quests'
import { ZOOMA_ADDRESS } from '../../lib/membaDAO'
import { proEntries, PRO_NAV_GROUPS, proRouteActive } from '../../lib/proNavigation'
import { navFlagOn } from '../../lib/navFlags'
import type { NavEntry } from '../../lib/navManifest'
import type { SidebarProps } from './Sidebar'

export function ProSidebar({ connected, address, unvotedCount, notifUnreadCount, feedReplyUnread = 0, collapsed, onToggleCollapse }: SidebarProps) {
    const nk = useNetworkKey()
    const { pathname } = useLocation()
    const renderLink = (entry: NavEntry) => {
        if (entry.id === 'profile' && !address) return null
        const to = entry.id === 'profile' ? `${entry.to}/${address}` : entry.to
        const active = proRouteActive(pathname, nk, to)
        const count = entry.id === 'dao' ? unvotedCount + notifUnreadCount : entry.id === 'feed' ? feedReplyUnread : entry.id === 'candidature' && canApplyForMembership() ? 1 : 0
        const soon = entry.flag && !navFlagOn(entry.flag)
        return <Link key={entry.id} to={`/${nk}${to}`} className={`k-sidebar-link${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined} aria-label={`${entry.label}${soon ? ', coming soon' : ''}${count > 0 ? `, ${count} notifications` : ''}`} title={collapsed ? entry.label : undefined}>
            <span className="k-sidebar-icon"><entry.Icon size={20} aria-hidden="true" /></span>
            <span className="k-sidebar-label">{entry.label}</span>
            {count > 0 && <span className="k-sidebar-badge" aria-label={`${count} notifications`}>{count > 99 ? '99+' : count}</span>}
            {soon && <span className="k-sidebar-badge inactive">soon</span>}
        </Link>
    }
    return <nav className={`k-sidebar pro-sidebar${collapsed ? ' collapsed' : ''}`} data-testid="sidebar" aria-label="Main">
        <div className="k-sidebar-header">
            <Link to={`/${nk}/`} aria-label="Memba home"><img src="/brand/folded-m/mark.svg" alt="" /><span className="k-sidebar-logo-text">Memba</span></Link>
            <button className="k-sidebar-toggle" onClick={onToggleCollapse} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>{collapsed ? <ArrowRight size={16} /> : <ArrowLeft size={16} />}</button>
        </div>
        <div className="pro-nav-scroll">
            <div className="k-sidebar-section">
                <button className="k-sidebar-link pro-search" aria-label="Search and quick actions" title={collapsed ? 'Search and quick actions' : undefined} onClick={() => window.dispatchEvent(new CustomEvent('open-command-palette'))}>
                    <span className="k-sidebar-icon"><MagnifyingGlass size={20} aria-hidden="true" /></span><span className="k-sidebar-label">Search</span>
                </button>
                {proEntries(['home'], connected).map(renderLink)}
            </div>
            {PRO_NAV_GROUPS.map(group => {
                const entries = proEntries(group.ids, connected, address === ZOOMA_ADDRESS)
                const links = entries.map(renderLink)
                const active = entries.some(e => proRouteActive(pathname, nk, e.to))
                // Native disclosures remain keyboard operable. Route changes reveal the active group.
                return group.label === 'Community' || group.label === 'Account & help'
                    ? <details key={`${group.label}-${pathname}-${collapsed}`} className="pro-nav-group" open={active || collapsed}>
                        <summary aria-label={group.label} title={collapsed ? group.label : undefined}>{collapsed ? '•••' : group.label}</summary>{links}
                    </details>
                    : <div key={group.label} className="pro-nav-group"><div className="pro-nav-heading">{group.label}</div>{links}</div>
            })}
        </div>
    </nav>
}
