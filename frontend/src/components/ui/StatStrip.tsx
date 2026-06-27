/**
 * StatStrip — a row of labelled stats with built-in loading + missing-value handling.
 *
 * Why it exists: marketplace pages hand-rolled their stat strips and rendered a bare
 * "—" while data loaded, so a still-loading strip read as four broken em-dashes. This
 * primitive distinguishes the three real states so that never happens again:
 *   - loading           → a skeleton shimmer (never a dash)
 *   - value is 0        → renders "0" (zero is real data, not missing)
 *   - value is null     → a quiet, accessible "unavailable" marker (a read genuinely failed)
 *
 * @module components/ui/StatStrip
 */

import "./StatStrip.css"

export interface Stat {
    label: string
    /** A formatted value (string/number), or null when the read is genuinely unavailable. */
    value: string | number | null
}

export function StatStrip({
    stats,
    loading = false,
    className,
}: {
    stats: Stat[]
    loading?: boolean
    className?: string
}) {
    return (
        <div className={"statstrip" + (className ? " " + className : "")} role="group" aria-label="Statistics">
            {stats.map((s) => (
                <div className="statstrip__cell" key={s.label}>
                    <span className="statstrip__label">{s.label}</span>
                    {loading ? (
                        <span className="statstrip__skeleton" data-testid="statstrip-skeleton" aria-hidden="true" />
                    ) : s.value === null || s.value === undefined ? (
                        <span className="statstrip__unavailable" aria-label="unavailable" title="Unavailable">
                            —
                        </span>
                    ) : (
                        <span className="statstrip__value">{s.value}</span>
                    )}
                </div>
            ))}
        </div>
    )
}
