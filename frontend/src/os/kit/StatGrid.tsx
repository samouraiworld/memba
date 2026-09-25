/**
 * The mockup's stat cards (.grid2 .card): a responsive grid of small metrics.
 *
 * @module os/kit/StatGrid
 */
import type { ReactNode } from "react"

export interface Stat {
    label: string
    value: ReactNode
    hint?: ReactNode
}

export function StatGrid({ stats }: { stats: readonly Stat[] }) {
    return (
        <div className="os-grid2">
            {stats.map((s, i) => (
                <div key={`${i}:${s.label}`} className="os-card os-stat">
                    <div className="os-stat-l">{s.label}</div>
                    <div className="os-stat-v">{s.value}</div>
                    {s.hint != null && <div className="os-sub">{s.hint}</div>}
                </div>
            ))}
        </div>
    )
}
