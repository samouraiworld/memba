import { useState } from "react"
import { useNetwork } from "../../hooks/useNetwork"
import { useRecentSubmissions } from "../../hooks/useRecentSubmissions"
import {
    mainnetSubmissionBlockUrl, mainnetSubmissionTxUrl, recentSubmissionsCheckedAt,
    RecentSubmissionsError, type RecentSubmissionKind,
} from "../../lib/recentSubmissions"
import { ExplorerLink } from "./ExplorerLink"
import { RealmDetailDrawer } from "./RealmDetailDrawer"

const ERROR_TEXT = {
    timeout: "The indexer read timed out.",
    "wrong-source": "The submission source could not be verified for gno.land.",
    "invalid-response": "The submission response could not be verified.",
    unavailable: "Recent submissions are unavailable.",
} as const

export function RecentSubmissionsSection({ kind }: { kind: RecentSubmissionKind }) {
    const { networkKey } = useNetwork()
    const query = useRecentSubmissions(networkKey)
    const [sourcePath, setSourcePath] = useState<string | null>(null)
    if (networkKey !== "mainnet") return null

    const data = query.data
    const rows = data?.rows.filter(row => row.kind === kind) ?? []
    const errorText = query.error instanceof RecentSubmissionsError ? ERROR_TEXT[query.error.kind] : ERROR_TEXT.unavailable
    const stateText = query.isError
        ? data ? `Stale · Showing previously checked submissions. ${errorText}` : errorText
        : query.isPending ? "Checking recent submissions…"
            : query.isFetching ? "Refreshing recent submissions…"
                : ""
    const headingId = `dir-recent-${kind}`

    return (
        <section className="dir-recent" aria-labelledby={headingId}>
            <div className="dir-recent__heading">
                <h2 id={headingId}>Recent package submissions · gno.land</h2>
                <p>Added on chain; activation not checked.</p>
            </div>
            {data && <p className="dir-recent__coverage">Indexed through block {data.indexedHeight.toLocaleString()} · checked at {recentSubmissionsCheckedAt(data.checkedAt)} · window only ({data.windowStart.toLocaleString()}–{data.windowEnd.toLocaleString()})</p>}
            {stateText && <p className={`dir-recent__status${query.isError ? " dir-recent__status--error" : ""}`} role="status" aria-live="polite">{stateText}</p>}
            {data && rows.length === 0 && <p className="dir-recent__empty" role="status">No submissions in the checked window.</p>}
            {rows.length > 0 && (
                <ul className="dir-recent__list">
                    {rows.map(row => {
                        const txUrl = mainnetSubmissionTxUrl(row.txHash)
                        const blockUrl = mainnetSubmissionBlockUrl(row.blockHeight)
                        return <li key={row.path} className="dir-recent__row">
                            <div className="dir-recent__identity">
                                <code className="dir-recent__path">{row.path}</code>
                                <span>Creator <code>{row.creator}</code></span>
                                <span>Indexed at block {row.blockHeight.toLocaleString()}</span>
                            </div>
                            <div className="dir-recent__actions">
                                <button type="button" onClick={() => setSourcePath(row.path)} aria-label={`View source for ${row.path}`}>View source</button>
                                <ExplorerLink realmPath={row.path} networkKey={networkKey} label="In-app Explorer" />
                                {txUrl && <a href={txUrl} target="_blank" rel="noopener noreferrer" aria-label={`Transaction for ${row.path} (opens official RPC)`}>Transaction ↗</a>}
                                {blockUrl && <a href={blockUrl} target="_blank" rel="noopener noreferrer" aria-label={`Block ${row.blockHeight} for ${row.path} (opens official RPC)`}>Block ↗</a>}
                            </div>
                        </li>
                    })}
                </ul>
            )}
            <button className="dir-recent__retry" type="button" onClick={() => void query.refetch()} disabled={query.isFetching}>{query.isError ? "Retry" : "Refresh"}</button>
            {sourcePath && <RealmDetailDrawer path={sourcePath} isPackage onClose={() => setSourcePath(null)} />}
        </section>
    )
}
