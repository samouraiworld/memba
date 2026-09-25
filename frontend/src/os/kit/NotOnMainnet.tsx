/**
 * The mockup's warnbox for a feature not live on a network yet (gnoland-1 by
 * default): viewable, but every action stays off (D27).
 *
 * @module os/kit/NotOnMainnet
 */
import { Pill } from "./Pill"

export function NotOnMainnet({ what, network = "gnoland-1" }: { what: string; network?: string }) {
    return (
        <div className="os-note os-warn" role="note">
            <Pill tone="warn">Not on {network} yet</Pill> {what} isn't available on {network} yet. You can look around; actions stay off.
        </div>
    )
}
