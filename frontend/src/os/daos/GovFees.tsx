import { useQuery } from "@tanstack/react-query"
import { GNO_CHAIN_ID, GNO_RPC_URL } from "../../lib/config"
import { readGovFees } from "../../lib/dao/govFees"
import { formatUgnotExact } from "../../lib/dao/v2Budget"
import { ErrorState } from "../kit"

const accountUrl = (address: string) => `https://gnoscan.io/account/${address}?chainId=gnoland-1`
const realmUrl = (path: string) => `https://gnoscan.io/realms/details?path=${encodeURIComponent(path)}&chainId=gnoland-1`
const short = (address: string) => `${address.slice(0, 9)}…${address.slice(-6)}`

/** Read-only, available to guests. No transfer, forecast, or inferred revenue. */
export function GovFees() {
    const supported = GNO_CHAIN_ID === "gnoland-1"
    const query = useQuery({
        queryKey: ["dao", "gov", "fees", GNO_CHAIN_ID, GNO_RPC_URL],
        queryFn: ({ signal }) => readGovFees({ chainId: GNO_CHAIN_ID, rpcUrl: GNO_RPC_URL }, signal),
        enabled: supported, staleTime: 30_000, refetchInterval: 60_000, retry: false,
    })
    if (!supported) return null
    const data = query.data
    const partial = data?.sources.some(s => !s.values) || data?.wallets.some(w => w.balanceUgnot === null)
    return <section className="os-gov-fees" aria-label="Fees and transparency">
        <div className="os-row os-between">
            <h3 className="os-h">Fees &amp; transparency</h3>
            <button type="button" className="os-btn os-quiet" onClick={() => void query.refetch()} disabled={query.isFetching}>Refresh fees</button>
        </div>
        <p className="os-sub">See what apps charge and where their fees go. App revenue is not automatically money the DAO can spend. Network fees and storage deposits are excluded.</p>
        {query.isError && <ErrorState message={`Couldn't refresh fees.${data ? " Values below are from the previous read." : ""}`} onRetry={() => void query.refetch()} />}
        {!data && !query.isError && <p className="os-sub" role="status">Reading fees from the network…</p>}
        {data && <>
            <div className="os-note"><b>Total historical app revenue: not available</b><p className="os-flush">Market and App Store forward fees to their receiving wallets. A complete transaction history is needed to calculate their accumulated revenue.</p></div>
            {partial && <p className="os-note os-warn" role="status">Some reads are unavailable. Refresh to try again; missing values do not mean zero.</p>}
            <ul className="os-gov-fee-grid">{data.sources.map(({ source, values }) => <li key={source.id}>
                <div className="os-row os-between"><b>{source.label}</b><a href={realmUrl(source.path)} target="_blank" rel="noreferrer">Source ↗</a></div>
                {!values ? <p className="os-sub">Fee data unavailable</p> : <>
                    <p className="os-sub">{values.rate}</p>
                    {source.mode === "retained" ? <>
                        <p className="os-gov-fee-amount">{values.retainedUgnot === null ? "Unavailable" : formatUgnotExact(values.retainedUgnot)}</p>
                        <p className="os-sub">Collected, not yet withdrawn. Resets after a withdrawal; excludes players’ stakes.</p>
                    </> : <p className="os-sub">{source.mode === "policy" ? "Shared fee policy; not a separate revenue pool." : "Paid directly to the receiving wallet."}</p>}
                    <p className="os-sub">{source.mode === "retained" ? "Withdrawal authority" : "Receiving wallet"}: {values.recipient ? <a className="os-mono" href={accountUrl(values.recipient)} title={values.recipient} target="_blank" rel="noreferrer">{short(values.recipient)} ↗</a> : "Not set"}</p>
                    {source.mode === "retained" && <p className="os-sub">Connect 4 is outside the current DAO bridge. Its owner controls withdrawals.</p>}
                </>}
            </li>)}</ul>
            {data.wallets.length > 0 && <details className="os-gov-details">
                <summary>Receiving wallet balances</summary>
                <p className="os-sub">These balances include all incoming and outgoing funds. They are neither accumulated fee totals nor a DAO treasury balance. Shared wallets appear once.</p>
                <ul className="os-list">{data.wallets.map(w => <li className="os-it os-gov-wallet" key={w.address}>
                    <a className="os-mono os-break" href={accountUrl(w.address)} target="_blank" rel="noreferrer">{w.address} ↗</a>
                    <b>{w.balanceUgnot === null ? "Balance unavailable" : formatUgnotExact(w.balanceUgnot)}</b>
                </li>)}</ul>
            </details>}
            <p className="os-sub os-flush">{query.isError ? "Last successful read" : "Read"} {new Date(query.dataUpdatedAt).toLocaleTimeString()} · gno.land mainnet · refreshes every minute.</p>
        </>}
    </section>
}
