/**
 * useMemberStanding — the connected member's XP / rank / candidature standing for
 * the member-hero progress meter.
 *
 * Backend XP is authoritative when reachable (localStorage XP is user-editable and
 * must not, on its own, drive the candidature gate); the hook falls back to the
 * local quest progress when the backend is unreachable or the wallet is
 * disconnected — degrade, never block. Rank + thresholds come from the real
 * gnobuilders tier system, so a brand-new member reads as an honest "Newcomer"
 * starting rung (0 XP is a real value here, not a fabricated one).
 *
 * Local progress renders instantly (initialData); the backend value reconciles in
 * the background, so the hero never flashes a skeleton for a value we already hold.
 *
 * @module hooks/home/useMemberStanding
 */
import { useQuery } from "@tanstack/react-query"
import {
    calculateRank,
    xpToNextRank,
    RANK_TIERS,
    CANDIDATURE_XP_THRESHOLD,
    type RankTier,
} from "../../lib/gnobuilders"
import {
    fetchUserQuests,
    loadQuestProgress,
    isEligibleForCandidature,
    isLegacyEligible,
} from "../../lib/quests"

export interface MemberStanding {
    loading: boolean
    totalXP: number
    /** Current rank tier (Newcomer at 0 XP). */
    rank: RankTier
    /** Next rank tier, or undefined at the top tier. */
    nextRank?: RankTier
    /** XP remaining to the next rank (0 at the top tier). */
    xpToNext: number
    /** XP required for Memba DAO candidature (Gold rank — currently 350). */
    candidatureThreshold: number
    /** XP remaining to candidature, clamped at 0 once eligible. */
    xpToCandidature: number
    /** Progress toward candidature, 0..1 (clamped). */
    candidatureProgress: number
    /** Whether the member can apply for Memba DAO candidature. */
    isEligible: boolean
}

export function useMemberStanding(
    address: string | null,
    isAuthenticated: boolean,
): MemberStanding {
    const query = useQuery({
        queryKey: ["useMemberStanding", address],
        // Local progress is the instant baseline (placeholderData, NOT initialData:
        // initialData would be cached as fresh and suppress the authoritative backend
        // fetch). The backend value reconciles in the background with no loading flash.
        placeholderData: () => ({ totalXP: loadQuestProgress().totalXP }),
        queryFn: async () => {
            const local = loadQuestProgress().totalXP
            if (!address) return { totalXP: local }
            const backend = await fetchUserQuests(address)
            // Backend is authoritative when present; otherwise keep local.
            return { totalXP: backend ? backend.totalXP : local }
        },
        enabled: isAuthenticated && !!address,
        staleTime: 60_000,
        retry: false,
    })

    const totalXP = query.data?.totalXP ?? 0
    const rank = calculateRank(totalXP)
    const nextRank = RANK_TIERS[rank.tier + 1]
    const xpToNext = xpToNextRank(totalXP)
    const xpToCandidature = Math.max(0, CANDIDATURE_XP_THRESHOLD - totalXP)
    const candidatureProgress = Math.min(1, totalXP / CANDIDATURE_XP_THRESHOLD)
    const isEligible = isEligibleForCandidature(totalXP, isLegacyEligible())

    return {
        // We always hold at least the local baseline (placeholderData), so the hero
        // never needs a skeleton; "loading" is true only if even that is absent.
        loading: query.isPending && query.data === undefined,
        totalXP,
        rank,
        nextRank,
        xpToNext,
        candidatureThreshold: CANDIDATURE_XP_THRESHOLD,
        xpToCandidature,
        candidatureProgress,
        isEligible,
    }
}
