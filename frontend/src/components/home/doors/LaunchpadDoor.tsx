/**
 * LaunchpadDoor — visitor showcase promo door for the token factory.
 *
 * variant="promo", eyebrow "launchpad".
 * No data fetch — this is a pure capability promo. The token factory (tokenfactory_v2)
 * is deployed and live on test13; no count hook exists that is cheap enough to add
 * here without a new fetch. Per the brief: "pure promo, no fabricated count."
 *
 * The door uses Door's href prop so the entire card is navigable → /${networkKey}/tokens.
 * State is always "ready" (static).
 *
 * @module components/home/doors/LaunchpadDoor
 */

import { Door } from "../Door"
import "../home.css"

export interface LaunchpadDoorProps {
    networkKey: string
}

export function LaunchpadDoor({ networkKey }: LaunchpadDoorProps) {
    const tokensHref = `/${networkKey}/tokens`

    return (
        <Door
            variant="promo"
            state="ready"
            eyebrow="launchpad"
            href={tokensHref}
        >
            <div className="launchpad-door">
                <span className="launchpad-door__headline">
                    Launch a token in minutes
                </span>
                <span className="launchpad-door__sub">
                    Token factory is live on Gno
                </span>
            </div>
        </Door>
    )
}
