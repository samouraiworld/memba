import { useQuery } from "@tanstack/react-query"
import { fetchCuratorQueue, FLAG_HIDE_THRESHOLD, isAppStoreV3OrLaterOn } from "../../../lib/appStore"
import { MAX_RESUBMITS } from "../../../lib/appStoreSubmit"
import { TEAM_MULTISIG_ADDRESS } from "../../../lib/reviews"
import { ErrorState, Loading } from "../../kit"
import type { NativeViewProps } from "../../native/types"
import { specForTarget } from "../../shell/windows"

/** The listings waiting for a curator, read-only: curators decide by transactions from their own accounts. */
export function CuratorQueue({ session, open }: Pick<NativeViewProps, "session" | "open">) {
    const available = isAppStoreV3OrLaterOn(session.network.key)
    const queue = useQuery({
        queryKey: ["appStore", "native-curator-queue", session.network.chainId],
        queryFn: () => fetchCuratorQueue(), enabled: available, staleTime: 60_000, retry: 1,
    })
    const data = queue.data
    return <div className="os-store-home">
        <header className="os-store-section-head">
            <p className="os-store-kicker">APP STORE</p>
            <h1>Curator queue</h1>
            <p>Curators approve or reject each new listing and clear reports; the Memba DAO is to take this over later. They act by transactions from their own accounts: this page only shows the queue.</p>
        </header>
        {!available && <p className="os-store-notice" role="status">The App Store registry is not available on this network.</p>}
        {available && queue.isPending && <Loading label="Reading the curator queue…" />}
        {available && queue.isError && <ErrorState message="The curator queue could not be read from the registry." onRetry={() => void queue.refetch()} />}
        {data && <>
            <p className="os-store-queue-curators">Curators on this registry: {data.curators.length ? data.curators.map((curator) => <span key={curator}><code>{curator}</code>{curator === TEAM_MULTISIG_ADDRESS && " (the team's 2-of-3 multisig)"}</span>) : "none"}</p>
            <p className="os-store-notice" role="status">
                Listings with {FLAG_HIDE_THRESHOLD} or more reports are not listed here: the registry has no read that lists them.
                {data.hidden === null ? " The queue is longer than Memba reads, so how many are hidden is not known." : data.hidden > 0 ? ` ${data.hidden} pending ${data.hidden === 1 ? "listing is" : "listings are"} hidden this way now.` : ""}
            </p>
            {data.pending.length === 0
                ? <p className="os-store-empty">{data.hidden ? "No other pending listing can be shown." : "No listings are waiting for review."}</p>
                : <ul className="os-store-queue">{data.pending.map((listing) => <li key={listing.pkgPath}>
                    <button type="button" className="os-store-queue-name" onClick={() => open(specForTarget({ kind: "app", app: "store", section: `apps/${listing.pkgPath.replace(/^gno\.land\//, "")}` })!)}>{listing.name}</button>
                    <code>{listing.pkgPath}</code>
                    <span>Submitted by <code>{listing.publisher}</code></span>
                    <span>Reports: {listing.flagCount}{listing.resubmitCount !== undefined && ` · Edits used: ${listing.resubmitCount} of ${MAX_RESUBMITS}`}</span>
                </li>)}</ul>}
        </>}
    </div>
}
