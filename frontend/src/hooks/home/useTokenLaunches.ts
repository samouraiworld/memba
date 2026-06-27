/**
 * useTokenLaunches — the home's enriched token source for the Ecosystem band's
 * token rows and the Launchpad door.
 *
 * fetchTokens() (the Directory token source, 5-min cached) gives the registry
 * list with only name/symbol/path. This hook additionally enriches the TOP-N
 * shown tokens with their on-chain details — total supply, admin, decimals —
 * via getTokenInfo() (one Render parse per token; bounded to N, so it stays
 * cheap). The full token COUNT comes from the list length, so a top-N slice can
 * still show "view all N".
 *
 * HONESTY:
 *   - Enrichment is best-effort and per-token: if a token's getTokenInfo() fails
 *     or returns nothing, that row simply keeps name/symbol/path (no fabricated
 *     supply/admin). formatSupply() returns null for a 0/unparsable supply, so
 *     the card OMITS supply rather than showing a misleading "0".
 *   - fetchTokens() degrades to [] on error → empty list, total 0 → the band
 *     omits the section and the Launchpad falls back to its promo.
 *   - Launch date and holder/buyer counts are NOT included — they aren't a cheap
 *     realm read (indexer work, tracked separately) and must not be faked here.
 *
 * @module hooks/home/useTokenLaunches
 */

import { useQuery } from "@tanstack/react-query"
import { useNetwork } from "../useNetwork"
import { fetchTokens, type DirectoryToken } from "../../lib/directory"
import { getTokenInfo, formatSupply, fetchTokenLaunchDates } from "../../lib/grc20"

export interface TokenLaunch extends DirectoryToken {
    /** Decimal-scaled, thousands-grouped total supply; omitted when unknown/zero. */
    supplyDisplay?: string
    /** Admin/creator g1 address; omitted when absent. */
    admin?: string
    /** Token decimals (for downstream formatting); omitted when unknown. */
    decimals?: number
    /** Holder count (the token ledger's "Known accounts"); omitted when 0/absent. */
    holders?: number
    /** ISO creation time (server-resolved from the indexer); omitted when unknown. */
    launchedAt?: string
}

export interface TokenLaunchesResult {
    /** The top-N tokens (registry order), enriched with supply/admin where available. */
    tokens: TokenLaunch[]
    /** Full token count (so a top-N slice can show "view all N"). */
    total: number
    loading: boolean
}

/**
 * useTokenLaunches — React Query hook returning the top-N enriched tokens + total.
 * Never rejects: every failure degrades to an empty list / unenriched rows.
 */
export function useTokenLaunches(limit: number): TokenLaunchesResult {
    const { networkKey, rpcUrl } = useNetwork()

    const query = useQuery({
        queryKey: ["home", "token-launches", networkKey, limit],
        queryFn: async () => {
            // The token list (per-token RPC enrichment) and the server-cached
            // launch-date map are fetched together; launch dates are best-effort.
            const [list, launchDates] = await Promise.all([fetchTokens(), fetchTokenLaunchDates()])
            const top = list.slice(0, limit)
            const tokens = await Promise.all(
                top.map(async (t): Promise<TokenLaunch> => {
                    const launchedAt = launchDates[t.symbol] || undefined
                    try {
                        const info = await getTokenInfo(rpcUrl, t.symbol)
                        if (!info) return { ...t, launchedAt }
                        return {
                            ...t,
                            supplyDisplay: formatSupply(info.totalSupply, info.decimals) ?? undefined,
                            admin: info.admin?.trim() || undefined,
                            decimals: info.decimals,
                            holders: info.knownAccounts && info.knownAccounts > 0 ? info.knownAccounts : undefined,
                            launchedAt,
                        }
                    } catch {
                        return { ...t, launchedAt } // best-effort: keep name/symbol/path + date
                    }
                }),
            )
            return { tokens, total: list.length }
        },
        staleTime: 300_000, // 5 minutes (matches the directory token cache TTL)
    })

    return {
        tokens: query.data?.tokens ?? [],
        total: query.data?.total ?? 0,
        loading: query.isLoading,
    }
}
