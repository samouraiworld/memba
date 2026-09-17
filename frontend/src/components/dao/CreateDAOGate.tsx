/**
 * CreateDAOGate — DAO creation is offered only on networks whose config
 * enables it (`userDaos.create`); every other network gets the unavailable page.
 */
import { lazy, Suspense } from "react"
import { NETWORKS } from "../../lib/config"
import { useNetworkKey } from "../../hooks/useNetworkNav"
import { ConnectingLoader } from "../ui/ConnectingLoader"
import { DAOUnavailable } from "./DAOUnavailable"

const CreateDAO = lazy(() => import("../../pages/CreateDAO").then(m => ({ default: m.CreateDAO })))

export function CreateDAOGate() {
    const network = NETWORKS[useNetworkKey()]
    if (network?.userDaos?.create !== true) {
        return <DAOUnavailable reason={`Creating a DAO from Memba is not available on ${network?.label ?? "this network"} yet. You can still open and read existing DAOs.`} />
    }
    return <Suspense fallback={<ConnectingLoader message="Loading..." minHeight="30vh" />}><CreateDAO /></Suspense>
}
