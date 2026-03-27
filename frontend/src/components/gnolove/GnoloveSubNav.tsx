/**
 * GnoloveSubNav — Section tab navigation for /gnolove routes.
 *
 * @module components/gnolove/GnoloveSubNav
 */

import { NavLink } from "react-router-dom"

const NAV_ITEMS = [
    { to: "/gnolove", label: "Scoreboard", end: true },
    { to: "/gnolove/report", label: "Report", end: false },
    { to: "/gnolove/analytics", label: "Analytics", end: false },
]

export default function GnoloveSubNav() {
    return (
        <nav className="gl-subnav" aria-label="Gnolove section navigation">
            {NAV_ITEMS.map(({ to, label, end }) => (
                <NavLink
                    key={to}
                    to={to}
                    end={end}
                    className={({ isActive }) => `gl-subnav-link ${isActive ? "gl-subnav-link--active" : ""}`}
                >
                    {label}
                </NavLink>
            ))}
        </nav>
    )
}
