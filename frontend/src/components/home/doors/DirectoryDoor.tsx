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
 *       - Always show: "find anyone by address or username" affordance + link
 *         → /${networkKey}/directory. The directory is always useful as a search
 *         tool even when the count is absent, so this door is rarely a hard-empty.
 *   - The hook does not surface an error state — on error it returns count=0 and
 *     members=[]; the door degrades gracefully by omitting the count while still
 *     rendering the search affordance and link.
 *
 * Refetch: useDirectoryHighlights does not expose a refetch in its interface.
 * The hook uses react-query defaults for auto-retry. No onRetry is wired.
 *
 * @module components/home/doors/DirectoryDoor
 */

import { Link } from "react-router-dom"
import { Door } from "../Door"
import { useDirectoryHighlights } from "../../../hooks/home/useDirectoryHighlights"
import "../home.css"

export interface DirectoryDoorProps {
    networkKey: string
}

export function DirectoryDoor({ networkKey }: DirectoryDoorProps) {
    const { memberCount, loading } = useDirectoryHighlights()

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

    return (
        <Door variant="search" state="ready" eyebrow="directory">
            <div className="directory-door">
                {memberCount > 0 && (
                    <span className="directory-door__count">{memberCount} members</span>
                )}
                <span className="directory-door__hint">
                    find anyone by address or username
                </span>
                <Link to={directoryHref} className="directory-door__link">
                    Open directory
                </Link>
            </div>
        </Door>
    )
}
