/**
 * DirectoryPanel — member count + registry preview for the StateBoard.
 *
 * Per-panel graceful-degradation contract (same as NetworkPulsePanel):
 *   - NEVER throw during render — degrade to "—" on error or no data
 *   - NEVER blank — always show the card structure (skeleton while loading)
 *   - Loading: show skeleton ActionCards
 *   - Error / no data: show "—" as title
 *
 * HONESTY: members are labelled "members" (registry order). They are NOT
 * labelled "newest" or "recent" — true newest ordering needs a backend
 * ListProfiles endpoint (Phase 2, Task 2.4).
 *
 * @module components/home/panels/DirectoryPanel
 */

import { useDirectoryHighlights } from "../../../hooks/home/useDirectoryHighlights"
import { useNetwork } from "../../../hooks/useNetwork"
import { ActionCard } from "../ActionCard"
import "../home.css"

/** Truncate a Gno address for compact display: g1abcd…xyz789 */
function truncateAddr(address: string): string {
    if (address.length <= 16) return address
    return `${address.slice(0, 10)}…${address.slice(-6)}`
}

/** Format a member count for display — 0 or falsy -> "—". */
function fmtCount(n: number): string {
    return n > 0 ? String(n) : "—"
}

/**
 * DirectoryPanel — state-board panel for everyone (member + visitor).
 * Shows the member count, a few registry members (by registry order),
 * a search hint, and a CTA to /directory.
 */
export function DirectoryPanel() {
    const { memberCount, members, loading } = useDirectoryHighlights()
    const { networkKey } = useNetwork()

    const directoryHref = `/${networkKey}/directory`

    // Loading: skeleton cards
    if (loading) {
        return (
            <div className="directory-panel" data-testid="directory-panel">
                <ActionCard title="…" loading={true} />
                <ActionCard title="…" loading={true} />
                <ActionCard title="…" loading={true} />
            </div>
        )
    }

    // Member chips — degrade to a single "—" placeholder when empty
    const rows =
        members.length > 0
            ? members
            : [{ name: "—", address: "" }]

    return (
        <div className="directory-panel" data-testid="directory-panel">
            {/* Member count tile */}
            <ActionCard
                accent="teal"
                icon="users"
                eyebrow="members"
                title={fmtCount(memberCount)}
            />

            {/* Member chips (registry order — not "newest") */}
            {rows.map((m, i) => (
                <ActionCard
                    key={m.address || `dash-${i}`}
                    accent="neutral"
                    icon="user"
                    eyebrow="member"
                    title={m.name}
                    meta={m.address ? truncateAddr(m.address) : undefined}
                />
            ))}

            {/* Search hint + CTA */}
            <ActionCard
                accent="neutral"
                icon="search"
                eyebrow="find anyone by address or username"
                title="Open directory"
                href={directoryHref}
                actionLabel="Open directory ->"
            />
        </div>
    )
}
