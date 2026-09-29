import { ACTIVE_NETWORK_KEY, GNO_RPC_URL } from "../../lib/config"
import { assertActiveRpcChain } from "../../lib/dao/chainIdentity"
import { getDAOMembers } from "../../lib/dao/members"
import { getDirectoryDAOs } from "../../lib/directory"

export interface ProfileMembership {
    name: string
    path: string
    roles: string[]
    tier: string
    votingPower: number
}

export interface MembershipRead {
    memberships: ProfileMembership[]
    checkedRealms: { name: string; path: string }[]
    checked: number
    failed: number
    omitted: number
}

/** Bounded to known directory entries; this is never a chain-wide DAO claim. */
export async function readProfileMemberships(address: string): Promise<MembershipRead> {
    await assertActiveRpcChain()
    const directory = getDirectoryDAOs(ACTIVE_NETWORK_KEY)
    const selected = directory.slice(0, 12)
    const results = await Promise.allSettled(selected.map(async dao => {
        const members = await getDAOMembers(GNO_RPC_URL, dao.path, undefined, true)
        const member = members.find(item => item.address === address)
        return member ? { name: dao.name, path: dao.path, roles: member.roles, tier: member.tier, votingPower: member.votingPower } : null
    }))
    return {
        memberships: results.flatMap(result => result.status === "fulfilled" && result.value ? [result.value] : []),
        checkedRealms: selected.flatMap((dao, index) => results[index].status === "fulfilled" ? [{ name: dao.name, path: dao.path }] : []),
        checked: results.filter(result => result.status === "fulfilled").length,
        failed: results.filter(result => result.status === "rejected").length,
        omitted: Math.max(0, directory.length - selected.length),
    }
}
