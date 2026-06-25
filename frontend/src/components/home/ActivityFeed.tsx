/**
 * ActivityFeed — below-the-fold "live across gno.land" feed of recent on-chain
 * activity, read from the official tx-indexer (see hooks/home/useRecentActivity).
 *
 * Honesty contract: every row is a real transaction (links to the realm on
 * gnoweb). Empty window → an invitation (never a fabricated row); indexer error
 * → a retry; while loading → skeletons. Hides entirely on networks without an
 * indexer (useRecentActivity → available:false).
 *
 * @module components/home/ActivityFeed
 */
import { Coins, Package, Scales, ShieldCheck, ArrowsLeftRight, Play, Cube, ArrowClockwise } from "@phosphor-icons/react"
import { useRecentActivity } from "../../hooks/home/useRecentActivity"
import type { ActivityItem, ActivityKind } from "../../lib/activity"
import { getExplorerBaseUrl } from "../../lib/config"
import { truncateValidatorAddr } from "../../lib/validators"
import "./home.css"

const KIND_ICON: Record<ActivityKind, typeof Coins> = {
    token: Coins,
    deploy: Package,
    governance: Scales,
    validator: ShieldCheck,
    transfer: ArrowsLeftRight,
    run: Play,
    call: Cube,
}

/** Compact relative time ("just now" / "5m" / "3h" / "2d") from an ISO string. */
export function relativeActivityTime(iso: string | undefined, now: number): string {
    if (!iso) return ""
    const then = Date.parse(iso)
    if (Number.isNaN(then)) return ""
    const secs = Math.max(0, Math.round((now - then) / 1000))
    if (secs < 45) return "just now"
    const mins = Math.round(secs / 60)
    if (mins < 60) return `${mins}m`
    const hrs = Math.round(mins / 60)
    if (hrs < 24) return `${hrs}h`
    return `${Math.round(hrs / 24)}d`
}

/** Realm link on gnoweb for an item with a package path; null otherwise. */
function itemHref(item: ActivityItem): string | null {
    if (!item.pkgPath) return null
    return `${getExplorerBaseUrl()}${item.pkgPath.replace(/^gno\.land/, "")}`
}

function ActivityRow({ item, now }: { item: ActivityItem; now: number }) {
    const Icon = KIND_ICON[item.kind] ?? Cube
    const href = itemHref(item)
    const when = relativeActivityTime(item.time, now)
    const inner = (
        <>
            <span className={`activity-feed__icon activity-feed__icon--${item.kind}`} aria-hidden="true">
                <Icon size={15} weight="bold" />
            </span>
            <span className="activity-feed__body">
                <span className="activity-feed__title">
                    {item.title}
                    {item.extraCount > 0 && (
                        <span className="activity-feed__more"> · +{item.extraCount} more</span>
                    )}
                </span>
                <span className="activity-feed__meta">
                    {item.actor && <span className="activity-feed__actor val-mono">{truncateValidatorAddr(item.actor)}</span>}
                    {when && <span className="activity-feed__when">{when}</span>}
                </span>
            </span>
        </>
    )
    return (
        <li className="activity-feed__row" data-testid="activity-row">
            {href ? (
                <a className="activity-feed__link" href={href} target="_blank" rel="noopener noreferrer">
                    {inner}
                </a>
            ) : (
                <span className="activity-feed__link activity-feed__link--static">{inner}</span>
            )}
        </li>
    )
}

export interface ActivityFeedProps {
    networkKey: string
}

export function ActivityFeed({ networkKey }: ActivityFeedProps) {
    const { items, loading, error, available, refetch } = useRecentActivity(networkKey)
    if (!available) return null

    const now = Date.now()

    return (
        <section className="activity-feed" data-testid="activity-feed">
            <div className="below-fold__eyebrow">live across gno.land</div>

            {loading && (
                <ol className="activity-feed__list" aria-hidden="true">
                    {[0, 1, 2, 3].map((i) => (
                        <li key={i} className="activity-feed__row activity-feed__row--skeleton" />
                    ))}
                </ol>
            )}

            {!loading && error && (
                <div className="activity-feed__state" data-testid="activity-feed-error">
                    <span>Couldn’t reach the indexer.</span>
                    <button className="activity-feed__retry" onClick={() => refetch()}>
                        <ArrowClockwise size={13} aria-hidden="true" /> Retry
                    </button>
                </div>
            )}

            {!loading && !error && items.length === 0 && (
                <div className="activity-feed__state" data-testid="activity-feed-empty">
                    No recent activity in the latest blocks — check back soon.
                </div>
            )}

            {!loading && !error && items.length > 0 && (
                <ol className="activity-feed__list" data-testid="activity-feed-list">
                    {items.map((item) => (
                        <ActivityRow key={item.txHash} item={item} now={now} />
                    ))}
                </ol>
            )}
        </section>
    )
}
