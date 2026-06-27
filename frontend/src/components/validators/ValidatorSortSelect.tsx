/** The sortable validator fields (shared by the desktop table headers and the
 *  mobile sort control). */
export type SortKey = "rank" | "votingPower" | "powerPercent" | "participationRate" | "uptimePercent" | "missedBlocks" | "txContrib"

interface SortOption {
    /** "key:dir" — round-trips the select value to (key, asc). */
    value: string
    label: string
    key: SortKey
    asc: boolean
}

// Each option carries the natural direction (rank low→high; everything else
// high→low) so a single tap picks both field and order.
const BASE_OPTIONS: SortOption[] = [
    { value: "rank:asc", label: "Rank", key: "rank", asc: true },
    { value: "votingPower:desc", label: "Power", key: "votingPower", asc: false },
    { value: "powerPercent:desc", label: "Share", key: "powerPercent", asc: false },
]

const MONITORING_OPTIONS: SortOption[] = [
    { value: "uptimePercent:desc", label: "Uptime", key: "uptimePercent", asc: false },
    { value: "participationRate:desc", label: "Participation", key: "participationRate", asc: false },
]

interface ValidatorSortSelectProps {
    sortKey: SortKey
    sortAsc: boolean
    hasMonitoring: boolean
    onChange: (key: SortKey, asc: boolean) => void
}

/**
 * ValidatorSortSelect — the mobile sort control for the validator roster. The
 * desktop table sorts via clickable column headers; the mobile card list has no
 * headers, so this select restores sort parity (it replaces the page-size
 * dropdown on mobile, where the roster is clamped to 25 anyway).
 */
export function ValidatorSortSelect({ sortKey, sortAsc, hasMonitoring, onChange }: ValidatorSortSelectProps) {
    const options = hasMonitoring ? [...BASE_OPTIONS, ...MONITORING_OPTIONS] : BASE_OPTIONS
    const current = `${sortKey}:${sortAsc ? "asc" : "desc"}`

    return (
        <select
            className="val-page-size"
            data-testid="validator-sort"
            aria-label="Sort validators"
            value={current}
            onChange={e => {
                const opt = options.find(o => o.value === e.target.value)
                if (opt) onChange(opt.key, opt.asc)
            }}
        >
            {options.map(o => (
                <option key={o.value} value={o.value}>Sort: {o.label}</option>
            ))}
        </select>
    )
}
