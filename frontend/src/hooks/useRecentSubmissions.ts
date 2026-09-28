import { useQuery } from "@tanstack/react-query"
import { fetchRecentSubmissions, RECENT_SUBMISSIONS_ENDPOINT } from "../lib/recentSubmissions"

/** Mainnet-only, fixed-endpoint read. No polling or browser GraphQL queries. */
export const supportsRecentSubmissions = (networkKey: string): boolean => networkKey === "mainnet"

export function useRecentSubmissions(networkKey: string, active = true) {
    return useQuery({
        queryKey: ["directory", "recent-submissions", networkKey, RECENT_SUBMISSIONS_ENDPOINT],
        queryFn: ({ signal }) => fetchRecentSubmissions(signal),
        enabled: supportsRecentSubmissions(networkKey) && active,
        staleTime: 60_000,
        retry: false,
        refetchInterval: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
    })
}
