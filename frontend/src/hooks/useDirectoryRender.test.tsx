import { act, renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { expect, it, vi } from "vitest"
import { useState, type ReactNode } from "react"
vi.mock("./useNetwork", () => ({ useNetwork: () => ({ networkKey: "mainnet", rpcUrl: "https://rpc.gno.land" }) }))
vi.mock("../lib/dao/shared", () => ({ queryRender: vi.fn() }))
import { queryRender } from "../lib/dao/shared"
import { useDirectoryRender } from "./useDirectoryRender"
function Wrapper({ children }: { children: ReactNode }) { const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } })); return <QueryClientProvider client={client}>{children}</QueryClientProvider> }
it("distinguishes failed reads from successful empty output and retries on demand", async () => {
    vi.mocked(queryRender).mockReset().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce("")
    const { result } = renderHook(() => useDirectoryRender("gno.land/r/demo/a"), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(queryRender).toHaveBeenCalledTimes(1)
    await act(async () => { await result.current.refetch() })
    await waitFor(() => expect(result.current.isError).toBe(false))
    expect(result.current.data).toBe("")
    expect(queryRender).toHaveBeenLastCalledWith("https://rpc.gno.land", "gno.land/r/demo/a", "", true)
})
it("clears the view when a pending realm read is collapsed", async () => {
    let resolve!: (value: string) => void
    vi.mocked(queryRender).mockReset().mockReturnValue(new Promise(r => { resolve = r }))
    const { result, rerender } = renderHook(({ path }: { path: string | null }) => useDirectoryRender(path), { initialProps: { path: "gno.land/r/demo/a" as string | null }, wrapper: Wrapper })
    expect(result.current.loading).toBe(true)
    rerender({ path: null })
    await act(async () => { resolve("Late collapsed content") })
    expect(result.current.loading).toBe(false)
    expect(result.current.data).toBeUndefined()
})
