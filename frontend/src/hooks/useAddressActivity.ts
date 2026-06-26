/**
 * useAddressActivity — recent on-chain activity for ONE address (a profile's own
 * transactions), read from the official tx-indexer via the `/api/indexer` proxy.
 *
 * Powers the profile Activity tab (ValoperDetail). Honest by construction:
 *   - no indexer configured on the active network → `available: false` (hide);
 *   - empty window → empty list (UI shows "no recent on-chain activity");
 *   - hard indexer error → `error: true` (UI shows retry);
 *   - while loading → `loading: true` (UI shows a skeleton).
 *
 * The indexer exposes no server-side limit/order, and the proxy times out on an
 * unbounded full-history scan, so fetchAddressActivity windows to a recent block
 * range — this is a RECENT activity view, not the address's entire history.
 *
 * @module hooks/useAddressActivity
 */
import { useQuery } from "@tanstack/react-query"
import { fetchAddressActivity, type ActivityItem } from "../lib/activity"
import { getIndexerUrl } from "../lib/config"

export interface AddressActivityResult {
    items: ActivityItem[]
    loading: boolean
    error: boolean
    /** False when the active network has no indexer — the section should not render. */
    available: boolean
    refetch: () => void
}

const LIMIT = 20

export function useAddressActivity(address: string | undefined): AddressActivityResult {
    const indexerUrl = getIndexerUrl()
    const enabled = !!indexerUrl && !!address

    const query = useQuery({
        queryKey: ["useAddressActivity", address, indexerUrl],
        queryFn: ({ signal }) =>
            fetchAddressActivity(indexerUrl as string, address as string, { limit: LIMIT, signal }),
        enabled,
        staleTime: 30_000,
        retry: false,
    })

    if (!indexerUrl) {
        return { items: [], loading: false, error: false, available: false, refetch: () => {} }
    }
    return {
        items: query.data ?? [],
        // Only "loading" once the query is actually enabled — a disabled query is
        // `pending` but idle, which would otherwise show a perpetual skeleton.
        loading: enabled && query.isPending,
        error: query.isError,
        available: true,
        refetch: query.refetch,
    }
}
