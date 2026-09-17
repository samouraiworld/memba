import { useQuery } from "@tanstack/react-query"
import { ACTIVE_NETWORK_KEY, GNO_CHAIN_ID, GNO_RPC_URL, NETWORKS } from "../lib/config"
import { capabilitiesFor, resolveDaoKind, type DaoCapabilities, type DaoKind } from "../lib/dao/kind"

export interface DaoKindState {
    /** Resolved kind; null while resolving or when resolution failed. */
    kind: DaoKind | null
    /** Capabilities for the resolved kind on the active network; read-only until resolved. */
    capabilities: DaoCapabilities
    loading: boolean
    error: string | null
}

/**
 * Resolve which DAO contract family `realmPath` is on the active chain, and
 * the actions the shell may offer for it. Until the kind is known (or if the
 * read fails) the capabilities are those of an unknown contract: read-only.
 */
export function useDaoKind(realmPath: string | undefined): DaoKindState {
    // An unresolvable network key falls back to the most restrictive entry.
    const network = NETWORKS[ACTIVE_NETWORK_KEY] ?? NETWORKS.mainnet
    const query = useQuery({
        queryKey: ["dao", "kind", GNO_CHAIN_ID, realmPath ?? ""],
        enabled: !!realmPath,
        staleTime: Infinity,
        queryFn: ({ signal }) => resolveDaoKind({ rpcUrl: GNO_RPC_URL, chainId: GNO_CHAIN_ID, realmPath: realmPath! }, signal),
    })
    const kind = query.data ?? null
    return {
        kind,
        capabilities: capabilitiesFor(kind ?? "unknown", network),
        loading: !!realmPath && query.isPending,
        error: query.isError ? (query.error instanceof Error ? query.error.message : "Could not identify this DAO contract") : null,
    }
}
