import { useQuery } from "@tanstack/react-query"
import { fetchRecentSubmissions, RECENT_SUBMISSIONS_ENDPOINT } from "../lib/recentSubmissions"

/** Mainnet-only, fixed-endpoint read. No polling or browser GraphQL queries. */
export function useRecentSubmissions(networkKey: string) {
    return useQuery({
        queryKey: ["directory", "recent-submissions", networkKey, RECENT_SUBMISSIONS_ENDPOINT],
        queryFn: ({ signal }) => fetchRecentSubmissions(signal),
        enabled: networkKey === "mainnet",
        staleTime: 60_000,
        retry: false,
        refetchInterval: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
    })
}
