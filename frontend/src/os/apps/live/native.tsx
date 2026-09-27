import { useRecentActivity } from "../../../hooks/home/useRecentActivity"
import { useNow } from "../../../hooks/home/useNow"
import { relativeActivityTime, type ActivityItem } from "../../../lib/activity"
import { INDEXER_PROXIED_NETWORK } from "../../../lib/config"
import { txExplorerUrl } from "../../../lib/txExplorerUrl"
import { Empty, ErrorState, Loading } from "../../kit"
import type { NativeViewProps } from "../../native/types"
import "./live.css"

function shortHash(hash: string): string {
    return hash.length > 18 ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : hash
}

function ActivityRow({ item, chainId, now }: { item: ActivityItem; chainId: string; now: number }) {
    const txUrl = txExplorerUrl(item.txHash, chainId)
    const time = relativeActivityTime(item.time, now)
    return (
        <li className="os-live-row">
            <div className="os-live-row-main">
                <span className="os-live-kind">{item.kind}</span>
                <strong>{item.title}</strong>
                {item.extraCount > 0 && <span className="os-sub">+{item.extraCount} more messages</span>}
            </div>
            <div className="os-live-row-meta os-sub">
                {item.actor && <span title={item.actor}>{item.actor}</span>}
                <span>Block {item.blockHeight}</span>
                {time && <span>{time === "just now" ? time : `${time} ago`}</span>}
                {txUrl
                    ? <a href={txUrl} target="_blank" rel="noopener noreferrer" title={item.txHash}>Transaction {shortHash(item.txHash)} ↗</a>
                    : <span title={item.txHash}>Transaction {shortHash(item.txHash)}</span>}
            </div>
        </li>
    )
}

function LiveContent({ session }: Pick<NativeViewProps, "session">) {
    const { items, loading, error, available, updatedAt, refetch } = useRecentActivity(session.network.key)
    const now = useNow(15_000)

    const updated = updatedAt ? relativeActivityTime(new Date(updatedAt).toISOString(), now) : ""
    return (
        <section className="os-live-window" aria-label="Recent on-chain activity">
            <header className="os-live-head">
                <div>
                    <h2>Recent on-chain activity</h2>
                    <p className="os-sub">A read-only sample from roughly 400 recent indexed blocks on {session.network.chainId}. Refreshes about every 30 seconds while this tab is visible.</p>
                </div>
                {available && <button type="button" className="os-btn os-quiet" onClick={() => refetch()} disabled={loading}>Refresh</button>}
            </header>
            {!available && <div className="os-note os-warn" role="status">Activity is unavailable on this network. The guarded indexer relay serves {INDEXER_PROXIED_NETWORK} only.</div>}
            {available && loading && <Loading label="Loading recent indexed transactions…" />}
            {available && !loading && error && <ErrorState message="Could not load recent activity from the indexer." onRetry={refetch} />}
            {available && !loading && !error && items.length === 0 && <Empty title="No transactions appeared in the recent indexed sample. Check back after new blocks arrive." />}
            {available && !loading && !error && items.length > 0 && (
                <>
                    <p className="os-live-update os-sub">{updated ? updated === "just now" ? "Updated just now" : `Updated ${updated} ago` : "Recent indexed sample"} · newest blocks first · up to 12 transactions</p>
                    <ol className="os-live-list">{items.map((item) => <ActivityRow key={item.txHash} item={item} chainId={session.network.chainId} now={now} />)}</ol>
                </>
            )}
        </section>
    )
}

export default function LiveWindow({ section, session, fallback }: NativeViewProps) {
    return section === null ? <LiveContent session={session} /> : <>{fallback}</>
}
