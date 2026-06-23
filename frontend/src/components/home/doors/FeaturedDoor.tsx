/**
 * FeaturedDoor — the full-width hero door for the visitor ShowcaseBoard.
 *
 * Driven by useFeaturedDao(networkKey). State mapping:
 *   - ready:   DAO name (prominent) + members (ONLY if present) + a primary
 *              "View DAO" link → dao.href and a secondary "Explore DAOs" link
 *              → invitationHref. No health (no source). No fabricated metric.
 *   - empty:   Door renders an invitation → { "Explore DAOs", invitationHref }.
 *   - loading: Door skeleton.
 *   - error:   Door retry control.
 *
 * Honesty: members is rendered only when defined (never "0"/"—"); the hook
 * already omits a 0 member count.
 *
 * @module components/home/doors/FeaturedDoor
 */

import { Link } from "react-router-dom"
import { Door } from "../Door"
import { useFeaturedDao } from "../../../hooks/home/useFeaturedDao"

export interface FeaturedDoorProps {
    networkKey: string
}

export function FeaturedDoor({ networkKey }: FeaturedDoorProps) {
    const result = useFeaturedDao(networkKey)

    // empty / loading / error: Door renders invitation / skeleton / retry.
    if (result.state !== "ready" || !result.dao) {
        return (
            <Door
                variant="featured"
                state={result.state}
                eyebrow="featured dao"
                invitation={{ label: "Explore DAOs", href: result.invitationHref }}
                // NOTE: useFeaturedDao does not currently expose a refetch, so the
                // error retry is a no-op for now (the Door still renders a retry
                // control). Wire a real refetch when the hook surfaces one —
                // tracked as a Task 1.2a concern / fast-follow.
                onRetry={() => {}}
            />
        )
    }

    const { dao, invitationHref } = result

    return (
        <Door variant="featured" state="ready" eyebrow="featured dao">
            <div className="featured-door">
                <span className="featured-door__name">{dao.name}</span>
                {dao.members !== undefined && (
                    <span className="featured-door__members">
                        {dao.members} members
                    </span>
                )}
                <div className="featured-door__links">
                    <Link
                        to={dao.href}
                        className="featured-door__link featured-door__link--primary"
                    >
                        View DAO
                    </Link>
                    <Link
                        to={invitationHref}
                        className="featured-door__link featured-door__link--secondary"
                    >
                        Explore DAOs
                    </Link>
                </div>
            </div>
        </Door>
    )
}
