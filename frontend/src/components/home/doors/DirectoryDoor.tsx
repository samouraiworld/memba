/**
 * DirectoryDoor — visitor showcase door for the member directory.
 *
 * variant="search", eyebrow "directory".
 * Data source: useDirectoryHighlights (reuses DirectoryPanel's hook — no new fetch).
 *
 * State mapping:
 *   - loading: Door skeleton.
 *   - ready (not loading):
 *       - If memberCount > 0: show count as "{n} members".
 *       - If memberCount === 0: omit count entirely (never render "0" or "—").
 *       - Composition (R2-H4b/R2-H5): when ≥2 of {members, realms, packages} are
 *         present, render a token-colored breakdown donut + numeric stat chips.
 *         A single available number is NOT turned into a donut (honesty) — the
 *         door falls back to the plain "{n} members" + search affordance.
 *       - Always show: "find anyone by address or username" affordance + link
 *         → /${networkKey}/directory. The directory is always useful as a search
 *         tool even when counts are absent, so this door is rarely a hard-empty.
 *   - The hook does not surface an error state — on error it returns count=0 and
 *     members=[]; the door degrades gracefully by omitting the count while still
 *     rendering the search affordance and link.
 *
 * Refetch: useDirectoryHighlights does not expose a refetch in its interface.
 * The hook uses react-query defaults for auto-retry. No onRetry is wired.
 *
 * @module components/home/doors/DirectoryDoor
 */

import { Door } from "../Door"
import { useDirectoryHighlights } from "../../../hooks/home/useDirectoryHighlights"
import "../home.css"

export interface DirectoryDoorProps {
    networkKey: string
}

const DONUT_SIZE = 48
const DONUT_STROKE = 8
const DONUT_R = (DONUT_SIZE - DONUT_STROKE) / 2
const DONUT_C = 2 * Math.PI * DONUT_R

/** One composition slice: a label, its value, and its token color variable. */
interface Slice {
    key: string
    label: string
    value: number
    /** A CSS custom-property reference, e.g. "var(--color-k-accent)". */
    color: string
}

/**
 * Token-colored breakdown ring of the directory composition (R2-H4b). Each slice
 * is an arc drawn with stroke-dasharray on a shared circle. Decorative
 * (aria-hidden) — the numeric chips beside it carry the accessible values.
 * Caller guarantees ≥2 non-zero slices; segments sum the real proportions.
 */
function BreakdownDonut({ slices }: { slices: Slice[] }) {
    const total = slices.reduce((sum, s) => sum + s.value, 0)
    // Precompute each segment's arc length + cumulative start offset purely.
    // `reduce` threads the running total through the accumulator so nothing is
    // reassigned during render (satisfies react-hooks/immutability).
    const segs = slices.reduce<{ list: (Slice & { dash: number; start: number })[]; offset: number }>(
        (acc, s) => {
            const dash = (s.value / total) * DONUT_C
            acc.list.push({ ...s, dash, start: acc.offset })
            return { list: acc.list, offset: acc.offset + dash }
        },
        { list: [], offset: 0 },
    ).list
    return (
        <svg
            className="directory-door__donut"
            viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`}
            width={DONUT_SIZE}
            height={DONUT_SIZE}
            aria-hidden="true"
            focusable="false"
            data-testid="directory-donut"
        >
            {/* Track */}
            <circle
                cx={DONUT_SIZE / 2}
                cy={DONUT_SIZE / 2}
                r={DONUT_R}
                fill="none"
                stroke="var(--color-k-edge)"
                strokeWidth={DONUT_STROKE}
            />
            {segs.map((s) => (
                <circle
                    key={s.key}
                    className="directory-door__donut-seg"
                    cx={DONUT_SIZE / 2}
                    cy={DONUT_SIZE / 2}
                    r={DONUT_R}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={DONUT_STROKE}
                    strokeDasharray={`${Math.round(s.dash * 100) / 100} ${Math.round((DONUT_C - s.dash) * 100) / 100}`}
                    // Negative offset advances clockwise; the svg's -90° rotation
                    // puts segment 0's start at 12 o'clock.
                    strokeDashoffset={-Math.round(s.start * 100) / 100}
                />
            ))}
        </svg>
    )
}

export function DirectoryDoor({ networkKey }: DirectoryDoorProps) {
    const { memberCount, realmCount, packageCount, loading } = useDirectoryHighlights()

    const directoryHref = `/${networkKey}/directory`

    if (loading) {
        return (
            <Door
                variant="search"
                state="loading"
                eyebrow="directory"
            />
        )
    }

    // Build the composition slices from whatever counts are reachable. Each is
    // omitted when 0 (honesty — no fabricated segment/chip). A donut needs ≥2
    // slices; a lone number stays a plain "{n} members".
    const slices: Slice[] = [
        { key: "members", label: "members", value: memberCount, color: "var(--color-k-accent)" },
        { key: "realms", label: "realms", value: realmCount, color: "var(--color-k-govdao)" },
        { key: "packages", label: "packages", value: packageCount, color: "var(--color-k-warning)" },
    ].filter((s) => s.value > 0)
    const showDonut = slices.length >= 2

    // The WHOLE card is the link (href on Door) — no inner footer <Link>, which
    // would be an illegal nested <a> inside the card-link.
    return (
        <Door variant="search" state="ready" eyebrow="directory" href={directoryHref}>
            <div className="directory-door">
                {showDonut ? (
                    <div className="directory-door__breakdown">
                        <BreakdownDonut slices={slices} />
                        <ul className="directory-door__chips">
                            {slices.map((s) => (
                                <li
                                    key={s.key}
                                    className="directory-door__chip"
                                    data-testid={`directory-chip-${s.key}`}
                                >
                                    <span
                                        className="directory-door__chip-dot"
                                        style={{ background: s.color }}
                                        aria-hidden="true"
                                    />
                                    <span className="directory-door__chip-num">{s.value.toLocaleString()}</span>
                                    <span className="directory-door__chip-label">{s.label}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                ) : (
                    memberCount > 0 && (
                        <span className="directory-door__count">{memberCount} members</span>
                    )
                )}
                <span className="directory-door__hint">
                    find anyone by address or username
                </span>
            </div>
        </Door>
    )
}
