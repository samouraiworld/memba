/**
 * The mockup's card grid (.sgrid .scard): a responsive grid of small cards,
 * e.g. DAOs, apps, collections. A `Card` with `href` is an external link that
 * opens in a new tab (`label` names it for assistive tech); with `onClick` it
 * is a real `<button>`; otherwise a plain `<div>`.
 *
 * @module os/kit/Cards
 */
import type { ReactNode } from "react"

export function CardGrid({ children, min = 220 }: { children: ReactNode; min?: number }) {
    return <div className="os-sgrid" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))` }}>{children}</div>
}

export function Card({ onClick, href, label, children }: { onClick?: () => void; href?: string; label?: string; children: ReactNode }) {
    if (href) return <a className="os-scard" href={href} target="_blank" rel="noopener noreferrer" aria-label={label}>{children}</a>
    return onClick
        ? <button type="button" className="os-scard" onClick={onClick}>{children}</button>
        : <div className="os-scard">{children}</div>
}
