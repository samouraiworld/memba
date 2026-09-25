/**
 * The mockup's card grid (.sgrid .scard): a responsive grid of small cards,
 * e.g. DAOs, apps, collections. A `Card` with `onClick` is a real `<button>`;
 * without it, a plain `<div>`.
 *
 * @module os/kit/Cards
 */
import type { ReactNode } from "react"

export function CardGrid({ children, min = 220 }: { children: ReactNode; min?: number }) {
    return <div className="os-sgrid" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))` }}>{children}</div>
}

export function Card({ onClick, children }: { onClick?: () => void; children: ReactNode }) {
    return onClick
        ? <button type="button" className="os-scard" onClick={onClick}>{children}</button>
        : <div className="os-scard">{children}</div>
}
