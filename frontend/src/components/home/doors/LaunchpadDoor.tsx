/**
 * LaunchpadDoor — visitor showcase door for the token factory.
 *
 * variant="promo", eyebrow "launchpad". When at least one token exists it shows
 * a live mini token-card for the newest registry token — name, ticker, on-chain
 * total supply and creator — plus the total token count. With no tokens it falls
 * back to the capability promo.
 *
 * HONESTY: supply/creator come from useTokenLaunches (getTokenInfo); each is
 * omitted when unavailable (never a fabricated value), and an empty factory
 * shows the promo rather than a bare "0". Launch date and buyer counts are NOT
 * shown — they aren't a cheap realm read (indexer work, tracked separately).
 *
 * The whole card is navigable via Door's href → /${networkKey}/tokens.
 *
 * @module components/home/doors/LaunchpadDoor
 */

import { GRC20_FACTORY_PATH, isRealmValidOn } from "../../../lib/config"
import { Door } from "../Door"
import { useTokenLaunches } from "../../../hooks/home/useTokenLaunches"
import { truncateAddr } from "../../../lib/format"
import { formatActivityTime } from "../../../lib/activity"
import "../home.css"

export interface LaunchpadDoorProps {
    networkKey: string
}

export function LaunchpadDoor({ networkKey }: LaunchpadDoorProps) {
    const canCreateToken = isRealmValidOn(networkKey, GRC20_FACTORY_PATH)
    const tokensHref = `/${networkKey}/tokens`
    const { tokens, total } = useTokenLaunches(1)
    const featured = tokens[0]

    return (
        <Door variant="promo" state="ready" eyebrow={canCreateToken ? "launchpad" : "tokens"} href={tokensHref}>
            <div className="launchpad-door">
                {featured ? (
                    <>
                        <div className="launchpad-door__token">
                            <span className="launchpad-door__token-name">{featured.name}</span>
                            <span className="launchpad-door__token-ticker">${featured.symbol}</span>
                        </div>
                        {(featured.supplyDisplay || featured.holders || featured.launchedAt || featured.admin) && (
                            <div className="launchpad-door__stats">
                                {featured.supplyDisplay && (
                                    <span className="launchpad-door__stat">{featured.supplyDisplay} supply</span>
                                )}
                                {featured.holders && (
                                    <span className="launchpad-door__stat">
                                        {featured.holders} {featured.holders === 1 ? "holder" : "holders"}
                                    </span>
                                )}
                                {featured.launchedAt && (
                                    <span className="launchpad-door__stat launchpad-door__stat--muted" data-testid="launchpad-launched">
                                        launched {formatActivityTime(featured.launchedAt)} ago
                                    </span>
                                )}
                                {featured.admin && (
                                    <span className="launchpad-door__stat launchpad-door__stat--muted">
                                        by {truncateAddr(featured.admin)}
                                    </span>
                                )}
                            </div>
                        )}
                        <span className="launchpad-door__sub">
                            {total === 1 ? "1 token on the launchpad" : `${total} tokens on the launchpad`}
                        </span>
                    </>
                ) : (
                    <>
                        <span className="launchpad-door__headline">
                            {canCreateToken ? "Launch a token" : "Token launchpad"}
                        </span>
                        <span className="launchpad-door__sub">
                            {canCreateToken ? "Review token creation on this network" : "Memba token creation unavailable here"}
                        </span>
                    </>
                )}
            </div>
        </Door>
    )
}
