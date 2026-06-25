/**
 * useEcosystemTokens — the real token list for the home Ecosystem band (R2-H7).
 *
 * The home snapshot only carries a token *count* (counts.tokens), not the rows,
 * so the band's inline listing needs the actual items. This hook is the single
 * honest source: it calls fetchTokens() (the same Directory-page token source,
 * sessionStorage-cached for 5 min) and returns the list.
 *
 * HONESTY: never fabricates rows — on any failure fetchTokens() resolves to [],
 * so this hook returns an empty list and the band omits the tokens section.
 *
 * @module hooks/home/useEcosystemTokens
 */

import { useQuery } from "@tanstack/react-query"
import { useNetwork } from "../useNetwork"
import { fetchTokens, type DirectoryToken } from "../../lib/directory"

const STALE_TIME = 300_000 // 5 minutes (matches the directory token cache TTL)

export interface EcosystemTokens {
    /** Real tokens from the on-chain tokenfactory (registry order). */
    tokens: DirectoryToken[]
    loading: boolean
}

/**
 * useEcosystemTokens — React Query hook for the band's token listing.
 *
 * Never rejects: fetchTokens() degrades to [] on error, so callers get an empty
 * list (and the section is omitted) rather than an exception.
 */
export function useEcosystemTokens(): EcosystemTokens {
    // networkKey scopes the cache key so a network switch can't show stale rows.
    const { networkKey } = useNetwork()

    const query = useQuery({
        queryKey: ["home", "ecosystem-tokens", networkKey],
        queryFn: () => fetchTokens(),
        staleTime: STALE_TIME,
    })

    return {
        tokens: query.data ?? [],
        loading: query.isLoading,
    }
}
