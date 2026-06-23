/**
 * YourWorldsDoor — renders one saved world (DAO) as a Door card.
 *
 * Shows name + openCount (only when > 0) + a link to the DAO page.
 * If the world is degraded (RPC failed), renders the Door in "error" state
 * with the name/href still visible via the eyebrow.
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
    const { name, openCount, href, degraded } = world

    if (degraded) {
        return (
            <Door
                variant="list"
                state="error"
                eyebrow={name}
                href={href}
            />
        )
    }

    return (
        <Door variant="list" state="ready" eyebrow={name} href={href}>
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
