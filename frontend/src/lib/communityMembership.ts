/**
 * Community membership of the Memba DAO is membership of its channels realm,
 * which the DAO grants by vote (`ProposeChannelsAddMember`). The host accepts
 * that proposal only while the DAO owns the realm and no ownership return is
 * staged, so those two reads are the on-chain facts behind every statement
 * Memba makes about joining.
 */
import { useQuery } from "@tanstack/react-query"
import { GNO_CHAIN_ID, GNO_RPC_URL, MEMBA_DAO, isFeedWritable } from "./config"
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
    await assertWeightedChain({ rpcUrl: GNO_RPC_URL, chainId: GNO_CHAIN_ID }, signal)
    const { current, pending, type } = AUTHORITY_GETTERS.channelsPolicy
    const read = (getter: string) => qevalText(GNO_RPC_URL, APPLICATION_TARGETS.channels, `${getter}()`, signal).then(raw => parseQevalAddress(raw, type))
    const [owner, pendingOwner] = await Promise.all([read(current), read(pending)])
    if (owner === packageAddress(MEMBA_DAO.realmPath)) return pendingOwner === "" ? "open" : "unknown"
    return owner === "" ? "unknown" : "closed"
}

/** Read only where #join posts exist: the network the Feed is indexed on. */
export function useCommunityMembership(enabled = true): CommunityMembership {
    const { data } = useQuery({
        queryKey: ["community-membership", GNO_CHAIN_ID],
        queryFn: ({ signal }) => fetchCommunityMembership(signal),
        staleTime: 5 * 60_000,
        retry: false,
        enabled: enabled && isFeedWritable(),
    })
    return data ?? "unknown"
}

const NO_GRANT = "Posting does not grant membership or a voting seat, and your post is public and permanent."

export const COMMUNITY_MEMBERSHIP_COPY: Record<CommunityMembership, string> = {
    open: `The Memba DAO owns its community channels and admits members by vote. A #join post in the Feed asks for it. ${NO_GRANT}`,
    closed: `The Memba DAO does not own its community channels yet, so it cannot admit members: that takes a DAO vote to take the channels over. Until then, a #join post in the Feed introduces you. ${NO_GRANT}`,
    unknown: `A #join post in the Feed introduces you to the Memba DAO community. ${NO_GRANT}`,
}
