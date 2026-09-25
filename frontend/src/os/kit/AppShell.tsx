/**
 * The mockup's sidebar window (.fw): a left nav of sections and, on the
 * right, whatever the current section renders. Below 560px window width the
 * nav becomes a horizontal scroll row on top (kit.css, `@container os-window`).
 * The section area has its own Suspense (the kit's Loading) and error
 * boundary, reset when the section changes: a lazy or crashing section never
 * takes the nav down with it.
 *
 * @module os/kit/AppShell
 */
import { Suspense, type ReactNode } from "react"
import { Icon, type IconName } from "../shell/icons"
import { WindowError } from "../shell/WindowError"
import { Loading } from "./States"

export interface ShellSection {
    id: string
    name: string
    icon?: IconName
    badge?: ReactNode
}

export function AppShell({ label, sections, current, onSelect, children }: {
    label: string
    sections: readonly ShellSection[]
    current: string
    onSelect: (id: string) => void
    children: ReactNode
}) {
    return (
        <div className="os-fw">
            <nav aria-label={label}>
                <div className="os-navh">{label}</div>
                {sections.map((s) => (
                    <button key={s.id} type="button" aria-current={s.id === current ? "true" : undefined} onClick={() => onSelect(s.id)}>
                        {s.icon && <Icon name={s.icon} />}
                        <span>{s.name}</span>
                        {s.badge && <span className="os-fw-badge">{s.badge}</span>}
                    </button>
                ))}
            </nav>
            <section>
                <WindowError resetKey={current}>
                    <Suspense fallback={<Loading />}>{children}</Suspense>
                </WindowError>
            </section>
        </div>
    )
}
