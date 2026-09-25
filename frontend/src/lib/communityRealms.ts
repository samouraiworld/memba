/**
 * communityRealms.ts — which of Memba's community features have no usable realm
 * on a network, for the realms-not-deployed notice.
 */
import { isRealmValidOn, MEMBA_DAO } from "./config"

// Memba's community features and the realm each one needs. The realms-not-deployed
// notice names only those not usable on the active network. On gno.land mainnet
// (checked on chain 2026-09-25):
//   - feed: memba_feed_v1, live and allowlisted: usable;
//   - quests: memba_quest_attestation_v1, live and allowlisted, signer set: usable;
//   - channels: memba_dao_channels_v2 is live on chain but NOT allowlisted. It keeps
//     its own member list (only the publisher multisig) and does not read memba_dao
//     membership, so nobody else can post: not usable yet;
//   - candidature: memba_dao_candidature_v3 is not deployed: not usable.
// Allowlist a path only once Memba's feature for it works on that network, never
// to silence this notice.
const COMMUNITY_REALMS: readonly (readonly [string, string])[] = [
    ["channels", MEMBA_DAO.channelsPath],
    ["candidature", MEMBA_DAO.candidaturePath],
    ["feed", MEMBA_DAO.feedPath],
    ["quests", "gno.land/r/samcrew/memba_quest_attestation_v1"],
]

export function missingCommunityRealms(networkKey: string): string[] {
    return COMMUNITY_REALMS.filter(([, path]) => !isRealmValidOn(networkKey, path)).map(([name]) => name)
}
