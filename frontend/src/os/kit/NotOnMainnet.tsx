/**
 * The mockup's warnbox for a feature not live on gnoland-1 yet: viewable, but
 * every action stays off (D27).
 *
 * @module os/kit/NotOnMainnet
 */
export function NotOnMainnet({ what }: { what: string }) {
    return (
        <div className="os-note os-warn" role="note">
            <span className="os-tgt">Not on gnoland-1 yet</span> {what} isn't on gnoland-1 yet. You can look around; actions stay off.
        </div>
    )
}
