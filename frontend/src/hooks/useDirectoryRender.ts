import { useQuery } from "@tanstack/react-query"
import { useNetwork } from "./useNetwork"
import { queryRender } from "../lib/dao/shared"
import { isValidRealmPath } from "../lib/gnowebSource"

/** A read belongs to a network and path. Consuming the query's AbortSignal
 * cancels debounce on clear/unmount and prevents late responses from winning.
 * The transport retains its existing timeout/fallback policy.
 */
export function useDirectoryRender(path: string | null, delay = 0) {
    const { networkKey, rpcUrl } = useNetwork()
    const relative = path?.replace(/^gno\.land/, "") ?? ""
    const enabled = relative.startsWith("/r/") && isValidRealmPath(relative)
    const query = useQuery({
        queryKey: ["directory", "render", networkKey, path],
        enabled,
        queryFn: async ({ signal }) => {
            if (delay) await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve() }, delay)
                const abort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")) }
                if (signal.aborted) abort()
                else signal.addEventListener("abort", abort, { once: true })
            })
            if (signal.aborted) throw new DOMException("Aborted", "AbortError")
            return await queryRender(rpcUrl, path!, "", true)
        },
        retry: false, staleTime: 30_000, refetchOnWindowFocus: false,
    })
    return { ...query, loading: enabled && query.isFetching }
}
