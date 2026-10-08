import type { ReactNode } from "react"

export function Shelf({ id, title, note, action, children }: { id: string; title: string; note?: string; action?: { label: string; onClick: () => void }; children: ReactNode }) {
    return <section className="os-cin-shelf" aria-labelledby={id}>
        <div className="os-cin-shelf-head">
            <h2 id={id}>{title}</h2>
            {note && <span className="os-cin-sub">{note}</span>}
            {action && <button type="button" className="os-cin-link" onClick={action.onClick}>{action.label}</button>}
        </div>
        {children}
    </section>
}
