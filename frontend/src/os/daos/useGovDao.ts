/**
 * memba_gov reads for the Memba DAO windows (lib/dao/membaGov): each checks
 * the RPC's chain and validates the realm's own JSON, and is repeated each
 * minute while a window shows it; a failed repeat keeps the previous read.
 *
 * @module os/daos/useGovDao
 */
import { useQuery } from "@tanstack/react-query"
import { GNO_CHAIN_ID, GNO_RPC_URL } from "../../lib/config"
import { BRIDGE_ESCROW, readBridgePauses, readGovProposal, readGovRoster, readGovSnapshot, readTargetManifest } from "../../lib/dao/membaGov"
import { readEscrowContract } from "../../lib/marketplace/escrowState"

const ctx = () => ({ rpcUrl: GNO_RPC_URL, chainId: GNO_CHAIN_ID })
const key = (...rest: string[]) => ["dao", "gov", GNO_CHAIN_ID, ...rest]
const REREAD_MS = 60_000

/** Roster, policy and one page of proposals (newest first; `before` is the cursor of an older page). */
export function useGovSnapshot(before = "0") {
    return useQuery({
        queryKey: key("snapshot", before),
        queryFn: ({ signal }) => readGovSnapshot(ctx(), before, signal),
        staleTime: 15_000, refetchInterval: REREAD_MS, retry: false,
    })
}

export function useGovRoster() {
    return useQuery({
        queryKey: key("roster"),
        queryFn: ({ signal }) => readGovRoster(ctx(), signal),
        staleTime: 15_000, refetchInterval: REREAD_MS, retry: false,
    })
}

export function useGovProposal(id: string) {
    return useQuery({
        queryKey: key("proposal", id),
        queryFn: ({ signal }) => readGovProposal(ctx(), id, signal),
        staleTime: 15_000, refetchInterval: REREAD_MS, retry: false,
    })
}

/** Whether a raw proposal's target realm exists on this chain, and whether it is private. */
export function useTargetManifest(target: string, enabled: boolean) {
    return useQuery({
        queryKey: key("manifest", target),
        queryFn: ({ signal }) => readTargetManifest(ctx(), target, signal),
        enabled, staleTime: REREAD_MS, retry: false,
    })
}

/** When the bridge's pause of each pausable app ends (0: none). */
export function useBridgePauses(enabled: boolean) {
    return useQuery({
        queryKey: key("pauses"),
        queryFn: ({ signal }) => readBridgePauses(ctx(), signal),
        enabled, staleTime: 15_000, refetchInterval: REREAD_MS, retry: false,
    })
}

/** The parties of an escrow contract a dispute proposal settles. */
export function useDisputeParties(contractId: string | null) {
    return useQuery({
        queryKey: key("escrow", contractId ?? ""),
        queryFn: async () => {
            const c = await readEscrowContract(BRIDGE_ESCROW, contractId!)
            return c && { client: c.client, freelancer: c.freelancer }
        },
        enabled: contractId !== null, staleTime: REREAD_MS, retry: false,
    })
}
