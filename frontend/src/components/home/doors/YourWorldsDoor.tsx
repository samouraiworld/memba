/**
 * YourWorldsDoor — renders one saved world (DAO) as a Door card.
 *
 * Body shows the DAO name plus a compact signal row: member count and either
 * the open-proposal count (teal) or an honest "no open proposals". The role
 * eyebrow shows the connected wallet's role when known, else "dao".
 *
 * Degraded worlds (per-DAO RPC failure) keep their name and still link to the
 * DAO, showing a "couldn't reach chain" note instead of metrics — so the card
 * never collapses to a bare error.
 *
 * Honesty: members/openCount rendered only when present (never "0").
 *
 * @module components/home/doors/YourWorldsDoor
 */

import { Door } from "../Door"
import type { YourWorld } from "../../../hooks/home/useYourWorlds"

export interface YourWorldsDoorProps {
    world: YourWorld
}

export function YourWorldsDoor({ world }: YourWorldsDoorProps) {
    const { name, role, members, openCount, href, degraded } = world
    const eyebrow = role ?? "dao"

    if (degraded) {
        return (
            <Door variant="list" state="ready" eyebrow={eyebrow} href={href}>
                <div className="your-worlds-door__body">
                    <span className="your-worlds-door__name">{name}</span>
                    <span className="your-worlds-door__stats your-worlds-door__stats--degraded">
                        couldn&apos;t reach chain
                    </span>
                </div>
            </Door>
        )
    }

    return (
        <Door variant="list" state="ready" eyebrow={eyebrow} href={href}>
            <div className="your-worlds-door__body">
                <span className="your-worlds-door__name">{name}</span>
                <span className="your-worlds-door__stats">
                    {members !== undefined && (
                        <span className="your-worlds-door__members">
                            {members} {members === 1 ? "member" : "members"}
                        </span>
                    )}
                    {openCount !== undefined ? (
                        <span className="your-worlds-door__open">{openCount} open</span>
                    ) : (
                        <span className="your-worlds-door__open your-worlds-door__open--none">
                            no open proposals
                        </span>
                    )}
                </span>
            </div>
        </Door>
    )
}
