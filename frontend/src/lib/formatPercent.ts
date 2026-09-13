/**
 * Format a percentage for display.
 *
 * gnomonitoring returns RAW floats — `/uptime` answers `64.36597110754414` — and
 * every roster surface used to interpolate them verbatim (`{v.uptimePercent}%`),
 * so production rendered "99.58071278825996%" in the desktop table and on the
 * mobile card alike. Participation merely *looked* correct because it happens to
 * arrive pre-rounded; that is a property of the current upstream query, not a
 * contract. Route every percentage through here instead of trusting the source.
 *
 * Absent data renders as an em dash, never as 0%: gnomonitoring scores an
 * unmonitored validator 0 (`score.Compute(Inputs{})` -> 0 -> tier "Critical"),
 * so "0%" is a health verdict while "-" is the absence of one. Conflating them
 * is how a monitoring outage reads as a dead validator.
 */
export function formatPercent(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value)) return "\u2014"
    // Sub-0.1 but non-zero would round to "0%" and read as "nothing happened".
    if (value > 0 && value < 0.05) return "<0.1%"
    const rounded = Math.round(value * 10) / 10
    // Integers render bare: "100%", not "100.0%".
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`
}
