/**
 * NetworkGate — validates the `/:network` param of every network-scoped route.
 *
 *  - not a known network → a legacy URL: LegacyRedirect prefixes the resolved one
 *  - a RETIRED network (pearl since 2026-09-23) → RetiredNetworkRedirect sends
 *    the same route to its successor (`/pearl/x` → `/mainnet/x`)
 *  - otherwise → NetworkSync + the app shell
 *
 * Lives beside LegacyRedirect/RootRedirect rather than inside App.tsx so the
 * wiring is testable: nothing in the suite imports App.tsx.
 *
 * @module components/layout/NetworkGate
 */
import { useParams } from "react-router-dom"
import { NETWORKS, retiredNetworkSuccessor } from "../../lib/config"
import { LegacyRedirect } from "./LegacyRedirect"
import { NetworkSync } from "./NetworkSync"
import { Layout } from "./Layout"
import { RetiredNetworkRedirect } from "./RetiredNetworkRedirect"

export function NetworkGate() {
    const { network } = useParams<{ network: string }>()
    if (!network || !NETWORKS[network]) {
        return <LegacyRedirect />
    }
    const successor = retiredNetworkSuccessor(network)
    if (successor) {
        return <RetiredNetworkRedirect from={network} to={successor} />
    }
    return (
        <>
            <NetworkSync />
            <Layout />
        </>
    )
}
