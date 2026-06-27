/**
 * useActorUsernames — best-effort resolution of activity-feed actor addresses to
 * their on-chain `@username` (r/sys/users), for the "live across gno.land" rows.
 *
 * Honesty / cost: resolves only the DISTINCT actor addresses (one cached qrender
 * each via `resolveOnChainUsername`), best-effort — a failed or unregistered
 * address is simply absent from the map and the feed falls back to the truncated
 * address. Cached 5 min (usernames change rarely); the feed renders addresses
 * immediately and upgrades to `@username` when the map resolves.
 *
 * @module hooks/home/useActorUsernames
 */
import { useQuery } from "@tanstack/react-query"
import { resolveOnChainUsername } from "../../lib/profile"

const EMPTY = new Map<string, string>()

export function useActorUsernames(actors: string[]): Map<string, string> {
    // Stable, deduped key so the query only re-runs when the actor SET changes.
    const distinct = Array.from(new Set(actors.filter(Boolean))).sort()

    const query = useQuery({
        queryKey: ["actorUsernames", distinct],
        queryFn: async () => {
            const map = new Map<string, string>()
            await Promise.all(
                distinct.map(async (addr) => {
                    try {
                        const name = await resolveOnChainUsername(addr)
                        if (name) map.set(addr, name)
                    } catch {
                        /* best-effort: leave this actor as a truncated address */
                    }
                }),
            )
            return map
        },
        enabled: distinct.length > 0,
        staleTime: 300_000,
        retry: false,
    })

    return query.data ?? EMPTY
}
