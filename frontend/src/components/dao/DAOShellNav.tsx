/**
 * DAOShellNav — the DAO's sections (Overview, Proposals, Members, Settings),
 * each shown only when the DAO's contract supports it.
 */
import { Link } from "react-router-dom"
import type { DaoCapabilities } from "../../lib/dao/kind"
import "./dao-shell.css"

export type DAOSection = "overview" | "proposals" | "members" | "settings" | "proposal"

export function DAOShellNav({ networkKey, realmPath, section, capabilities }: {
    networkKey: string
    realmPath: string
    section: DAOSection
    capabilities: DaoCapabilities
}) {
    const base = `/${networkKey}/dao/${realmPath}`
    const items: { id: DAOSection; label: string; to: string }[] = [
        { id: "overview", label: "Overview", to: base },
        { id: "proposals", label: "Proposals", to: `${base}/proposals` },
        { id: "members", label: "Members", to: `${base}/members` },
    ]
    if (capabilities.settings) items.push({ id: "settings", label: "Settings", to: `${base}/settings` })
    const current = section === "proposal" ? "proposals" : section
    return (
        <nav className="dao-shell-nav" aria-label="DAO sections">
            {items.map((item) => (
                <Link
                    key={item.id}
                    to={item.to}
                    className={`dao-shell-nav__link${item.id === current ? " dao-shell-nav__link--active" : ""}`}
                    aria-current={item.id === current ? "page" : undefined}
                >
                    {item.label}
                </Link>
            ))}
        </nav>
    )
}
