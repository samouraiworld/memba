import { useQuery } from "@tanstack/react-query"
import { GNO_CHAIN_ID } from "../../lib/config"
import { fetchModerator, REVIEWS_PKG_PATH } from "../../lib/reviews"

/**
 * The reviews realm's moderator, read from chain: `undefined` while the read is
 * pending or switched off, `null` when the realm returned none.
 */
export function useReviewsModerator(realmPath: string = REVIEWS_PKG_PATH, enabled = true): string | null | undefined {
    const { data, isError } = useQuery({
        queryKey: ["reviews", "moderator", GNO_CHAIN_ID, realmPath],
        queryFn: () => fetchModerator(realmPath),
        enabled,
        staleTime: 60_000,
        retry: false,
    })
    // A switched-off read must not answer from the cache another page filled.
    if (!enabled) return undefined
    return isError ? null : data
}
