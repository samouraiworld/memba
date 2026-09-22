import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { useNetwork } from "./useNetwork"
import { getDirectoryDAOs } from "../lib/directory"
import { directorySeedData, fetchDirectoryDiscovery } from "../lib/directoryDiscovery"

export function useDirectoryDiscovery() {
    const { networkKey } = useNetwork()
    const daos = useMemo(() => getDirectoryDAOs(networkKey), [networkKey])
    const fallback = useMemo(() => directorySeedData(networkKey, daos), [networkKey, daos])
    const query = useQuery({
        queryKey: ["directory", "discovery", networkKey, daos.map(dao => [dao.path, dao.name, dao.isSaved])],
        queryFn: () => fetchDirectoryDiscovery(networkKey, daos),
        staleTime: 300_000, retry: false,
    })
    return { ...query, discovery: query.data ?? fallback }
}
