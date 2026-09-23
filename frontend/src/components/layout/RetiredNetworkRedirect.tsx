/**
 * RetiredNetworkRedirect — sends `/<retired>/…` to the same route on the
 * network that replaced it (`NETWORKS[key].retiredTo`), e.g. `/pearl/dao/x` →
 * `/mainnet/dao/x`, preserving search and hash.
 *
 * The retired key travels in router state so the destination can show the
 * one-time RetiredNetworkNotice. It is state, not a query param, so the
 * canonical URL stays clean and a shared link does not carry it. Router state
 * is stored in `history.state` and WOULD survive a reload, so the notice
 * consumes it: it replaces the entry with a state-free copy after capturing it.
 *
 * @module components/layout/RetiredNetworkRedirect
 */
import { Navigate, useLocation } from "react-router-dom"
import { retiredNetworkTarget, type RetiredNetworkState } from "../../lib/retiredNetwork"

export function RetiredNetworkRedirect({ from, to }: { from: string; to: string }) {
    const location = useLocation()
    const state: RetiredNetworkState = { retiredNetwork: from }
    return <Navigate to={retiredNetworkTarget(location, from, to)} replace state={state} />
}
