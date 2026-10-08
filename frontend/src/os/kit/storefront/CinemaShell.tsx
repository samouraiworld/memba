/** Cinema storefront window: always dark, a top tab bar, then the content. */
import type { ReactNode } from "react"
import type { ShellSection } from "../AppShell"
import "./cinema.css"

type Tone = "arcade" | "store"

export function CinemaScope({ tone, children }: { tone: Tone; children: ReactNode }) {
    return <div className={`os-cinema os-cinema--${tone}`}>{children}</div>
}

export function CinemaShell({ tone, label, brand, sections, current, onSelect, children }: {
    tone: Tone; label: string; brand: string; sections: readonly ShellSection[]; current: string; onSelect: (id: string) => void; children: ReactNode
}) {
    return <div className={`os-cinema os-cinema--${tone} os-cin-shell`}>
        <nav className="os-cin-tabs" aria-label={label}>
            <span className="os-cin-brand" aria-hidden="true">{brand}</span>
            {sections.map((section) => <button key={section.id} type="button" className="os-cin-tab" aria-current={section.id === current ? "page" : undefined} onClick={() => onSelect(section.id)}>{section.name}</button>)}
        </nav>
        <div className="os-cin-body">{children}</div>
    </div>
}
