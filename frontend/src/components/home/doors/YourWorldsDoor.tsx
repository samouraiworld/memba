/**
 * YourWorldsDoor — renders one saved world (DAO) as a Door card.
 *
 * Shows role label as eyebrow (matching FeaturedDoor pattern) and the
 * prominent DAO name in the body — name appears exactly once.
 * If the world is degraded (RPC failed), renders the Door in "error" state.
 *
 * Honesty: openCount rendered only when defined (never "0").
 *
 * @module components/home/doors/YourWorldsDoor
 */

import { Door } from "../Door"
import type { YourWorld } from "../../../hooks/home/useYourWorlds"

export interface YourWorldsDoorProps {
    world: YourWorld
}

export function YourWorldsDoor({ world }: YourWorldsDoorProps) {
    const { name, role, openCount, href, degraded } = world
    const eyebrow = role ?? "dao"

    if (degraded) {
        return (
            <Door
                variant="list"
                state="error"
                eyebrow={eyebrow}
                href={href}
            />
        )
    }

    return (
        <Door variant="list" state="ready" eyebrow={eyebrow} href={href}>
            <div className="your-worlds-door__body">
                <span className="your-worlds-door__name">{name}</span>
                {openCount !== undefined && (
                    <span className="your-worlds-door__count">
                        {openCount} open
                    </span>
                )}
            </div>
        </Door>
    )
}
