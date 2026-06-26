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
import { useState } from "react"
import { Coins, Package, Scales, ShieldCheck, ArrowsLeftRight, Play, Cube, ArrowClockwise, Palette, ChatCircle, Vault } from "@phosphor-icons/react"
import { useRecentActivity } from "../../hooks/home/useRecentActivity"
import { formatActivityTime, type ActivityItem, type ActivityKind } from "../../lib/activity"
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
    nft: Palette,
    post: ChatCircle,
    multisig: Vault,
}

/** Short, human chip labels per kind (for the filter row). */
const KIND_LABEL: Record<ActivityKind, string> = {
    token: "Tokens",
    deploy: "Deploys",
    governance: "Governance",
    validator: "Validators",
    transfer: "Transfers",
    run: "Scripts",
    call: "Calls",
    nft: "NFTs",
    post: "Posts",
    multisig: "Multisig",
}

/** Priority order for showing filter chips (most interesting first). */
const KIND_ORDER: ActivityKind[] = ["governance", "token", "nft", "deploy", "transfer", "multisig", "post", "validator", "run", "call"]

/** Realm link on gnoweb for an item with a package path; null otherwise. */
function itemHref(item: ActivityItem): string | null {
    if (!item.pkgPath) return null
    return `${getExplorerBaseUrl()}${item.pkgPath.replace(/^gno\.land/, "")}`
}

function ActivityRow({ item }: { item: ActivityItem }) {
    const Icon = KIND_ICON[item.kind] ?? Cube
    const href = itemHref(item)
    const when = formatActivityTime(item.time)
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
    const [filter, setFilter] = useState<ActivityKind | "all">("all")
    if (!available) return null

    // Distinct kinds present, in priority order — the basis for the filter chips.
    const presentKinds = KIND_ORDER.filter((k) => items.some((it) => it.kind === k))
    const showChips = !loading && !error && items.length > 0 && presentKinds.length > 1
    const activeFilter = filter !== "all" && presentKinds.includes(filter) ? filter : "all"
    const shown = activeFilter === "all" ? items : items.filter((it) => it.kind === activeFilter)

    return (
        <section className="activity-feed" data-testid="activity-feed">
            <div className="below-fold__eyebrow">live across gno.land</div>

            {showChips && (
                <div className="activity-feed__filters" role="group" aria-label="Filter activity by type">
                    <button
                        type="button"
                        className={`activity-feed__chip ${activeFilter === "all" ? "is-active" : ""}`}
                        aria-pressed={activeFilter === "all"}
                        onClick={() => setFilter("all")}
                    >
                        All
                    </button>
                    {presentKinds.map((k) => (
                        <button
                            key={k}
                            type="button"
                            className={`activity-feed__chip ${activeFilter === k ? "is-active" : ""}`}
                            aria-pressed={activeFilter === k}
                            data-testid={`activity-chip-${k}`}
                            onClick={() => setFilter(k)}
                        >
                            {KIND_LABEL[k]}
                        </button>
                    ))}
                </div>
            )}

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
                    {shown.map((item) => (
                        <ActivityRow key={item.txHash} item={item} />
                    ))}
                </ol>
            )}
        </section>
    )
}
