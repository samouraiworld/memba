/**
 * The mockup's warnbox for a feature not live on a network yet (the active
 * network's chain id by default): viewable, but every action stays off (D27).
 *
 * @module os/kit/NotOnMainnet
 */
import { GNO_CHAIN_ID } from "../../lib/config"
import { Pill } from "./Pill"

export function NotOnMainnet({ what, network = GNO_CHAIN_ID }: { what: string; network?: string }) {
    return (
        <div className="os-note os-warn" role="note">
            <Pill tone="neutral">Not on {network} yet</Pill> {what} isn't available yet. You can look around; actions stay off.
        </div>
    )
}
