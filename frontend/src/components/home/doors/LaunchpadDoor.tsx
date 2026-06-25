/**
 * LaunchpadDoor — visitor showcase door for the token factory.
 *
 * variant="promo", eyebrow "launchpad". Shows the live token count from the home
 * snapshot when available (real once B1 is fixed, #528); otherwise falls back to
 * the capability promo. Honesty: never a fabricated 0 — absent count → promo.
 *
 * The whole card is navigable via Door's href → /${networkKey}/tokens.
 *
 * @module components/home/doors/LaunchpadDoor
 */

import { Door } from "../Door"
import { useHomeSnapshot } from "../../../hooks/home/useHomeSnapshot"
import "../home.css"

export interface LaunchpadDoorProps {
    networkKey: string
}

export function LaunchpadDoor({ networkKey }: LaunchpadDoorProps) {
    const tokensHref = `/${networkKey}/tokens`
    const { snapshot, usable } = useHomeSnapshot()
    const count = usable ? (snapshot?.counts?.tokens ?? 0) : 0

    return (
        <Door variant="promo" state="ready" eyebrow="launchpad" href={tokensHref}>
            <div className="launchpad-door">
                {count > 0 ? (
                    <>
                        <span className="launchpad-door__count">{count}</span>
                        <span className="launchpad-door__sub">
                            {count === 1 ? "token created" : "tokens created"}
                        </span>
                    </>
                ) : (
                    <>
                        <span className="launchpad-door__headline">
                            Launch a token in minutes
                        </span>
                        <span className="launchpad-door__sub">
                            Token factory is live on Gno
                        </span>
                    </>
                )}
            </div>
        </Door>
    )
}
