/** Redirects the legacy /validators/valoper/:operatorAddress route to the unified
 *  canonical profile at /validators/:address, preserving any router-state preset. */
import { Navigate, useLocation, useParams } from "react-router-dom"
import { useNetworkPath } from "../../hooks/useNetworkNav"

export function ValoperRouteRedirect() {
    const { operatorAddress } = useParams<{ operatorAddress: string }>()
    const np = useNetworkPath()
    const location = useLocation()
    return <Navigate to={np(`validators/${operatorAddress ?? ""}`)} replace state={location.state} />
}
