import { useId, type ReactNode } from "react"

export function Shelf({ id, title, note, action, children }: { id: string; title: string; note?: string; action?: { label: string; onClick: () => void }; children: ReactNode }) {
    // Two windows can show the same shelf at once, so the heading id carries a per-instance suffix.
    const headingId = `${id}-${useId()}`
    return <section className="os-cin-shelf" aria-labelledby={headingId}>
        <div className="os-cin-shelf-head">
            <h2 id={headingId}>{title}</h2>
            {note && <span className="os-cin-sub">{note}</span>}
            {action && <button type="button" className="os-cin-link" onClick={action.onClick}>{action.label}</button>}
        </div>
        {children}
    </section>
}
