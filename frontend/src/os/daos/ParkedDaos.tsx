/**
 * DAOs deployed from this browser that gno.land has not enabled yet (kept by
 * Create DAO), re-checked on the chain as the DAOs window opens. An enabled one
 * moves to the saved list; the others say what the network answered.
 *
 * @module os/daos/ParkedDaos
 */
import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { GNO_CHAIN_ID, GNO_RPC_URL } from "../../lib/config"
import { checkPendingDAOs, listPendingDAOs, type PendingCheck } from "../../lib/dao/packageStatus"
import { saveDAOForRecovery } from "../../lib/daoSlug"
import { getRpcUrlsInOrder } from "../../lib/rpcFallback"
import { ThingTile } from "../shell/icons"

const DAO_TINT = ["#2FC08E", "#12A07A"] as const

const STATUS: Record<PendingCheck["check"], string> = {
    waiting: "Submitted · waiting for network approval",
    "not-found": "Not on chain yet: check the transaction before deploying again",
    unknown: "Status couldn't be read",
    "live-unsaved": "Live, but this browser couldn't save it: open it by its address below",
}

/** `onEnabled` runs when a parked DAO turns out live and is saved, so the saved list re-reads. */
export function ParkedDaos({ onEnabled }: { onEnabled: () => void }) {
    const [rev, setRev] = useState(0)
    // Read on every render: a deploy parked or settled elsewhere shows here as it is now.
    // Deploys without an organisation, as the DAOs window lists getSavedDAOsForOrg(null).
    const parked = listPendingDAOs(GNO_CHAIN_ID).filter((p) => (p.orgId ?? null) === null)
    const paths = parked.map((p) => p.path).join("|")
    const checked = useQuery({
        queryKey: ["dao", "pending", "os", GNO_CHAIN_ID, paths, rev],
        enabled: parked.length > 0,
        retry: false,
        staleTime: 0,
        gcTime: 0,
        queryFn: ({ signal }) => checkPendingDAOs({ rpcUrl: GNO_RPC_URL, chainId: GNO_CHAIN_ID, rpcUrls: getRpcUrlsInOrder() }, (entry) => {
            saveDAOForRecovery(entry.orgId ?? null, entry.path, entry.name)
            onEnabled()
        }, signal),
    })
    if (parked.length === 0) return null
    const answer = (path: string) => checked.data?.find((c) => c.path === path)?.check
    const busy = checked.isFetching
    return (
        <section>
            <div className="os-row">
                <h3 className="os-h os-grow">Deployed from this browser, not live yet</h3>
                <button type="button" className="os-btn os-quiet os-inline" aria-disabled={busy} onClick={() => { if (!busy) setRev((r) => r + 1) }}>Check again</button>
            </div>
            <p className="os-sub" role="status">{busy ? "Checking the network…" : checked.isError ? "Couldn't read the network. Check again in a moment." : ""}</p>
            <ul className="os-list">{parked.map((p) => {
                const check = answer(p.path)
                return (
                    <li key={p.path} className="os-it">
                        <ThingTile icon="folder" tint={DAO_TINT} size={30} />
                        <span className="os-grow">
                            <b>{p.name || p.path}</b>
                            <span className="os-sub os-block os-mono">{p.path}</span>
                            <span className="os-sub os-block">{check ? STATUS[check] : busy ? "Checking…" : STATUS.unknown}</span>
                        </span>
                    </li>
                )
            })}</ul>
        </section>
    )
}
