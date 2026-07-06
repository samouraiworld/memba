/**
 * ExplorerLink — in-app link into the read-only realm Explorer (`/explorer/*`).
 *
 * Self-gating: renders nothing when `VITE_ENABLE_EXPLORER` is off, so callers can
 * drop it in unconditionally without ever linking users into the coming-soon
 * gate. Distinct from the EXTERNAL block-explorer links (`getExplorerBaseUrl`,
 * gnoweb/gnoscan) — this is Memba's own viewer, so it uses SPA navigation
 * (`<Link>`), never a new-tab `<a>`. The 🔎 label + no external arrow signal
 * "stays in Memba".
 *
 * @module components/directory/ExplorerLink
 */

import type { MouseEventHandler } from "react"
import { Link } from "react-router-dom"
import { isExplorerEnabled } from "../../lib/config"
import { explorerHref } from "../../lib/explorerLink"

interface ExplorerLinkProps {
    realmPath: string
    networkKey: string
    className?: string
    label?: string
    onClick?: MouseEventHandler<HTMLAnchorElement>
}

export function ExplorerLink({
    realmPath,
    networkKey,
    className,
    label = "🔎 Explorer",
    onClick,
}: ExplorerLinkProps) {
    if (!isExplorerEnabled()) return null
    const href = explorerHref(networkKey, realmPath)
    if (!href) return null
    return (
        <Link to={href} className={className} onClick={onClick}>
            {label}
        </Link>
    )
}
