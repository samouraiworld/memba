import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../lib/dao/kind", async original => ({ ...(await original<typeof import("../lib/dao/kind")>()), resolveDaoKind: vi.fn() }))
const { resolveDaoKind } = await import("../lib/dao/kind")
const { daoKindKey, useDaoKind } = await import("./useDaoKind")

const REALM = "gno.land/r/alice/team"
function setup() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    return { client, ...renderHook(() => useDaoKind(REALM), { wrapper }) }
}

beforeEach(() => { vi.clearAllMocks() })

describe("the DAO contract kind", () => {
    it("is read-only and loading until the probe answers, then carries the kind's capabilities", async () => {
        vi.mocked(resolveDaoKind).mockResolvedValue("memba-v2")
        const { result } = setup()
        expect(result.current).toMatchObject({ kind: null, loading: true, error: null })
        expect(result.current.capabilities.vote).toBe(false)
        await waitFor(() => expect(result.current.kind).toBe("memba-v2"))
        expect(result.current).toMatchObject({ loading: false, error: null })
        expect(result.current.capabilities.vote).toBe(true)
    })

    it("reports a probe that never answered as an error", async () => {
        vi.mocked(resolveDaoKind).mockRejectedValue(new Error("RPC unavailable"))
        const { result } = setup()
        await waitFor(() => expect(result.current.error).toBe("RPC unavailable"))
        expect(result.current).toMatchObject({ kind: null, loading: false })
    })

    it("keeps a kind it already resolved when a later re-read fails", async () => {
        vi.mocked(resolveDaoKind).mockResolvedValueOnce("weighted")
        const { client, result } = setup()
        await waitFor(() => expect(result.current.kind).toBe("weighted"))
        vi.mocked(resolveDaoKind).mockRejectedValueOnce(new Error("RPC unavailable"))
        await act(async () => { await client.invalidateQueries({ queryKey: daoKindKey(REALM), exact: true }) })
        expect(resolveDaoKind).toHaveBeenCalledTimes(2)
        expect(client.getQueryState(daoKindKey(REALM))?.status).toBe("error")
        // Observers hear of the failed re-read on the next tick: let the hook render it before judging.
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
        expect(result.current).toMatchObject({ kind: "weighted", loading: false, error: null })
    })
})
