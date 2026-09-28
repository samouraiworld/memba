import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { useNetwork } from "./useNetwork"
import { getDirectoryDAOs } from "../lib/directory"
import { directorySeedData, fetchDirectoryDiscovery } from "../lib/directoryDiscovery"

export function useDirectoryDiscovery(refreshKey = 0) {
    const { networkKey } = useNetwork()
    // A saved DAO changes browser storage, not a React value; refreshKey is an
    // explicit invalidation token supplied by the Directory save action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const daos = useMemo(() => getDirectoryDAOs(networkKey), [networkKey, refreshKey])
    const fallback = useMemo(() => directorySeedData(networkKey, daos), [networkKey, daos])
    const query = useQuery({
        queryKey: ["directory", "discovery", networkKey, daos.map(dao => [dao.path, dao.name, dao.isSaved])],
        queryFn: () => fetchDirectoryDiscovery(networkKey, daos),
        staleTime: 300_000, retry: false,
    })
    return { ...query, discovery: query.data ?? fallback }
}
