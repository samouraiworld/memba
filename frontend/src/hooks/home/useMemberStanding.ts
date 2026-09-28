/**
 * useMemberStanding — the connected member's XP / rank / candidature standing for
 * the member-hero progress meter.
 *
 * Backend XP is authoritative when reachable. Local XP can still display a
 * provisional rank during an outage, but only backend verified XP can unlock
 * candidature. Rank + thresholds come from the real
 * gnobuilders tier system, so a brand-new member reads as an honest "Newcomer"
 * starting rung (0 XP is a real value here, not a fabricated one).
 *
 * Local progress renders instantly (placeholderData); the backend value reconciles
 * in the background, so the hero never flashes a skeleton for a value we already
 * hold. The local placeholder is only surfaced for an authenticated member — an
 * unauthenticated render shows the honest Newcomer (0 XP) baseline, never another
 * session's leftover localStorage XP.
 *
 * @module hooks/home/useMemberStanding
 */
import { useEffect } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
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
    const queryClient = useQueryClient()
    const query = useQuery({
        queryKey: ["useMemberStanding", address],
        // Local progress is the instant baseline (placeholderData, NOT initialData:
        // initialData would be cached as fresh and suppress the authoritative backend
        // fetch). The backend value reconciles in the background with no loading flash.
        placeholderData: () => ({ totalXP: loadQuestProgress(address).totalXP, verifiedXP: null as number | null }),
        queryFn: async () => {
            const local = loadQuestProgress(address).totalXP
            if (!address) return { totalXP: local, verifiedXP: null }
            const backend = await fetchUserQuests(address)
            // Rank can show provisional local XP; candidature cannot.
            return { totalXP: backend ? backend.totalXP : local, verifiedXP: backend?.verifiedXP ?? null }
        },
        enabled: isAuthenticated && !!address,
        staleTime: 60_000,
        retry: false,
    })

    useEffect(() => {
        if (!address || !isAuthenticated) return
        const refresh = () => { void queryClient.invalidateQueries({ queryKey: ["useMemberStanding", address] }) }
        window.addEventListener("quest-completed", refresh)
        window.addEventListener("focus", refresh)
        return () => {
            window.removeEventListener("quest-completed", refresh)
            window.removeEventListener("focus", refresh)
        }
    }, [address, isAuthenticated, queryClient])

    // Only trust the query value (backend-authoritative, with the local placeholder)
    // for a genuinely connected member — react-query still evaluates placeholderData
    // for a disabled query, so without this gate a disconnected render would surface
    // another session's leftover localStorage XP. Unauthenticated → honest 0.
    const totalXP = isAuthenticated && address ? (query.data?.totalXP ?? 0) : 0
    const verifiedXP = isAuthenticated && address ? query.data?.verifiedXP ?? null : null
    const rank = calculateRank(totalXP)
    const nextRank = RANK_TIERS[rank.tier + 1]
    const xpToNext = xpToNextRank(totalXP)
    const xpToCandidature = Math.max(0, CANDIDATURE_XP_THRESHOLD - (verifiedXP ?? 0))
    const candidatureProgress = Math.min(1, (verifiedXP ?? 0) / CANDIDATURE_XP_THRESHOLD)
    const isEligible = verifiedXP !== null && isEligibleForCandidature(verifiedXP, false)

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
