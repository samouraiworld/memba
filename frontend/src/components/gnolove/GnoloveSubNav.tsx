/**
 * GnoloveSubNav — Section tab navigation for /gnolove routes.
 *
 * Uses `useNetworkPath()` to produce network-prefixed hrefs so clicks land
 * directly on /:network/gnolove/... without going through LegacyRedirect.
 * Plan: docs/planning/GNOLOVE_SHAREABLE_REPORT_URLS_PLAN.md §9 / [BUG-1].
 *
 * @module components/gnolove/GnoloveSubNav
 */

import { NavLink } from "react-router-dom"
import { useNetworkPath } from "../../hooks/useNetworkNav"

interface NavItem {
    path: string
    label: string
    end: boolean
}

const NAV_ITEMS: NavItem[] = [
    { path: "gnolove",            label: "Overview",   end: true  },
    { path: "gnolove/teams",      label: "Teams",      end: false },
    { path: "gnolove/report",     label: "Report",     end: false },
    { path: "gnolove/notable-prs", label: "Notable PRs", end: false },
    { path: "gnolove/analytics",  label: "Analytics",  end: false },
    { path: "gnolove/reports",    label: "AI Reports", end: false },
    { path: "gnolove/milestone",  label: "Milestone",  end: false },
]

export default function GnoloveSubNav() {
    const np = useNetworkPath()
    return (
        <nav className="gl-subnav" aria-label="Gnolove section navigation">
            {NAV_ITEMS.map(({ path, label, end }) => (
                <NavLink
                    key={path}
                    to={np(path)}
                    end={end}
                    className={({ isActive }) => `gl-subnav-link ${isActive ? "gl-subnav-link--active" : ""}`}
                >
                    {label}
                </NavLink>
            ))}
        </nav>
    )
}
