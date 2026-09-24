/**
 * communityRealms.ts — which of Memba's community features have no usable realm
 * on a network, for the realms-not-deployed notice.
 */
import { isRealmValidOn, MEMBA_DAO } from "./config"

// Memba's community features and the realm each one needs. The realms-not-deployed
// notice names only those not usable on the active network (partial rollouts:
// on gno.land mainnet the feed and quests are live, channels and candidature not).
const COMMUNITY_REALMS: readonly (readonly [string, string])[] = [
    ["channels", MEMBA_DAO.channelsPath],
    ["candidature", MEMBA_DAO.candidaturePath],
    ["feed", MEMBA_DAO.feedPath],
    ["quests", "gno.land/r/samcrew/memba_quest_attestation_v1"],
]

export function missingCommunityRealms(networkKey: string): string[] {
    return COMMUNITY_REALMS.filter(([, path]) => !isRealmValidOn(networkKey, path)).map(([name]) => name)
}
