/**
 * Weighted DAO reads for the Memba OS DAO windows, through the versioned
 * contract reader (lib/dao/weighted): each read checks the RPC's chain and
 * validates the contract's own JSON. Nothing comes from Render text or from
 * the equal-headcount loaders of the other DAO kinds.
 *
 * @module os/daos/useWeightedDao
 */
import { useQuery } from "@tanstack/react-query"
import { GNO_CHAIN_ID, GNO_RPC_URL } from "../../lib/config"
import { readWeightedBallot, readWeightedBallots, readWeightedSnapshot, weightedApplicationPolicies, type WeightedContext, type WeightedV12Config } from "../../lib/dao/weighted"
import { readAcceptanceStates } from "../../lib/dao/weightedAcceptance"
import { readFeeDestinations, readHeldUgnot } from "../../lib/dao/weightedTreasury"

const contextOf = (realmPath: string): WeightedContext => ({ rpcUrl: GNO_RPC_URL, chainId: GNO_CHAIN_ID, realmPath })

/** One key prefix for everything read from one weighted DAO on the active chain. */
const key = (realmPath: string, ...rest: string[]) => ["dao", "weighted", GNO_CHAIN_ID, realmPath, ...rest]

/**
 * Votes, delays and other members' actions change a DAO while it is on screen:
 * every read here is repeated each minute while a window shows it (never in a
 * hidden browser tab, see queryClient), and a failed repeat keeps the previous
 * read, which the window then says it is.
 */
const REREAD_MS = 60_000

/** Config, the seven seats and one page of proposals (newest first; `before` is the cursor of an older page). */
export function useWeightedSnapshot(realmPath: string, before = "0", enabled = true) {
    return useQuery({
        queryKey: key(realmPath, "snapshot", before),
        queryFn: ({ signal }) => readWeightedSnapshot(contextOf(realmPath), before, signal),
        enabled, staleTime: 15_000, refetchInterval: REREAD_MS, retry: false,
    })
}

/**
 * One proposal, read as its list reads it (so it gets the same checks against
 * the roster and the adapter policies): from the newest page when it is there,
 * otherwise from the page that starts at it.
 */
export function useWeightedProposalEntry(realmPath: string, id: string) {
    const newest = useWeightedSnapshot(realmPath)
    const onNewest = newest.data?.page.proposals.some((p) => p.id === id) ?? false
    const exists = !!newest.data && BigInt(id) >= 1n && BigInt(id) <= BigInt(newest.data.page.total)
    const needsOlder = exists && !onNewest
    const older = useWeightedSnapshot(realmPath, needsOlder ? String(BigInt(id) + 1n) : "0", needsOlder)
    const source = needsOlder ? older : newest
    const entry = source.data?.page.proposals.find((p) => p.id === id)
    return {
        /** Undefined until the first read answers; null when the DAO has no proposal with this number. */
        data: source.data ? (entry ? { snapshot: source.data, entry } : null) : undefined,
        /** The read that failed, if the last one did: with `data`, what is shown is the previous read. */
        error: source.error,
        refetch: () => void source.refetch(),
    }
}

/** Who controls each application the DAO governs. */
export function useAcceptanceStates(realmPath: string, config: WeightedV12Config) {
    return useQuery({
        queryKey: key(realmPath, "acceptance"),
        queryFn: ({ signal }) => readAcceptanceStates(contextOf(realmPath), weightedApplicationPolicies(config), signal),
        staleTime: 30_000, refetchInterval: REREAD_MS, retry: false,
    })
}

/** One address's ballot on one proposal (the application version publishes ballots). */
export function useWeightedBallot(realmPath: string, id: string, voter: string, enabled: boolean) {
    return useQuery({
        queryKey: key(realmPath, "ballot", id, voter),
        queryFn: ({ signal }) => readWeightedBallot(contextOf(realmPath), id, voter, signal),
        enabled, staleTime: 10_000, refetchInterval: REREAD_MS, retry: false,
    })
}

/** Every seat's ballot on one proposal, in roster order. */
export function useWeightedBallots(realmPath: string, id: string, voters: readonly string[], enabled: boolean) {
    return useQuery({
        queryKey: key(realmPath, "ballots", id, ...voters),
        queryFn: ({ signal }) => readWeightedBallots(contextOf(realmPath), id, voters, signal),
        enabled, staleTime: 10_000, refetchInterval: REREAD_MS, retry: false,
    })
}

/** Where each fee-collecting application pays its fees today. */
export function useFeeDestinations(realmPath: string, config: WeightedV12Config) {
    return useQuery({
        queryKey: key(realmPath, "fees"),
        queryFn: ({ signal }) => readFeeDestinations(contextOf(realmPath), config, signal),
        staleTime: 30_000, refetchInterval: REREAD_MS, retry: false,
    })
}

/** What an address related to this DAO holds, in ugnot. */
export function useWeightedBalance(realmPath: string, address: string) {
    return useQuery({
        queryKey: key(realmPath, "balance", address),
        queryFn: ({ signal }) => readHeldUgnot(contextOf(realmPath), address, signal),
        staleTime: 30_000, refetchInterval: REREAD_MS, retry: false,
    })
}
