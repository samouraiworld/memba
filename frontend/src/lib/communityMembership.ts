/** Community admission follows the current governance bridge's ownership of
 * the channels realm. The retired weighted DAO cannot admit members in Memba. */
import { useQuery } from "@tanstack/react-query"
import { GNO_CHAIN_ID, GNO_RPC_URL, isFeedWritable } from "./config"
import { BRIDGE_PATH } from "./dao/govActions"
import { bridgePublished } from "./dao/membaGov"
import { assertWeightedChain, qevalText } from "./dao/weighted"
import { AUTHORITY_GETTERS, parseQevalAddress } from "./dao/weightedAcceptance"
import { APPLICATION_TARGETS, packageAddress } from "./dao/weightedApplications"

/**
 * - open: the DAO owns the channels and nothing is staged, so it can vote members in;
 * - closed: someone else owns them, so the DAO cannot;
 * - unknown: not read, unreadable, no owner, or a return is staged. Nothing is claimed.
 */
export type CommunityMembership = "open" | "closed" | "unknown"

export async function fetchCommunityMembership(signal?: AbortSignal): Promise<CommunityMembership> {
    if (!bridgePublished()) return "unknown"
    await assertWeightedChain({ rpcUrl: GNO_RPC_URL, chainId: GNO_CHAIN_ID }, signal)
    const { current, pending, type } = AUTHORITY_GETTERS.channelsPolicy
    const read = (getter: string) => qevalText(GNO_RPC_URL, APPLICATION_TARGETS.channels, `${getter}()`, signal).then(raw => parseQevalAddress(raw, type))
    const [owner, pendingOwner] = await Promise.all([read(current), read(pending)])
    if (owner === packageAddress(BRIDGE_PATH)) return pendingOwner === "" ? "open" : "unknown"
    return owner === "" ? "unknown" : "closed"
}

/** Read only where #join posts exist: the network the Feed is indexed on. */
export function useCommunityMembership(enabled = true): CommunityMembership {
    const { data, isError } = useQuery({
        queryKey: ["community-membership", GNO_CHAIN_ID, BRIDGE_PATH],
        queryFn: ({ signal }) => fetchCommunityMembership(signal),
        staleTime: 5 * 60_000,
        retry: false,
        enabled: enabled && isFeedWritable(),
    })
    return isError ? "unknown" : data ?? "unknown"
}

const NO_GRANT = "Posting does not grant membership or a voting seat, and your post is public and permanent."

export const COMMUNITY_MEMBERSHIP_COPY: Record<CommunityMembership, string> = {
    open: `The Memba DAO owns its community channels and admits members by vote. A #join post in the Feed asks for it. ${NO_GRANT}`,
    closed: `The Memba DAO does not own its community channels yet, so it cannot admit members: their current administrator must nominate the DAO’s bridge, then the bridge must accept the handover. Until then, a #join post in the Feed introduces you. ${NO_GRANT}`,
    unknown: `A #join post in the Feed introduces you to the Memba DAO community. ${NO_GRANT}`,
}
