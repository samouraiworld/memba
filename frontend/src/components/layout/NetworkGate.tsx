/**
 * NetworkGate — validates the `/:network` param of every network-scoped route.
 *
 *  - a RETIRED network (RETIRED_NETWORKS in config.ts) → RetiredNetworkRedirect
 *    sends the same route to its successor (`/pearl/x` → `/mainnet/x`)
 *  - not a known network → a legacy URL: LegacyRedirect prefixes the resolved one
 *  - otherwise → NetworkSync + the app shell
 *
 * Lives beside LegacyRedirect/RootRedirect rather than inside App.tsx so the
 * wiring is testable: nothing in the suite imports App.tsx.
 *
 * @module components/layout/NetworkGate
 */
import { useParams } from "react-router-dom"
import { isNetworkKey, retiredNetworkSuccessor } from "../../lib/config"
import { LegacyRedirect } from "./LegacyRedirect"
import { NetworkSync } from "./NetworkSync"
import { Layout } from "./Layout"
import { RetiredNetworkRedirect } from "./RetiredNetworkRedirect"

export function NetworkGate() {
    const { network } = useParams<{ network: string }>()
    // Retired first: a retired key redirects to its successor whether or not the registry still lists it.
    const successor = retiredNetworkSuccessor(network)
    if (successor && network) {
        return <RetiredNetworkRedirect from={network} to={successor} />
    }
    if (!isNetworkKey(network)) {
        return <LegacyRedirect />
    }
    return (
        <>
            <NetworkSync />
            <Layout />
        </>
    )
}
