/**
 * useResolvedDirectoryDaos.test.ts
 *
 * Verifies the Directory DAOs-tab resolve filter (R2-D2): only DAOs that
 * actually render on the active network are shown — and (W3.2) that resolution
 * plus card metadata now derive from a SINGLE Render("") per DAO, not the
 * multi-read getDAOConfig waterfall + a second batch-metadata fan-out.
 *
 *   1. a DAO whose Render("") resolves (non-null) is KEPT
 *   2. a DAO whose Render("") returns null is DROPPED
 *   3. loading is true while any per-DAO query is in flight; daos is []
 *   4. B-9 discrimination: a transport outage (strict render THROWS a plain
 *      Error) KEEPS the DAO as a degraded card; only the chain's own answer —
 *      AbciQueryError or a null render — may drop it (E-F9/R2-D2). The chain's
 *      retained "not here" verdict outranks a later refetch error (no resurrect).
 *   5. resolved DAOs keep their input metadata (name/category/isSaved)
 *   6. empty input → not loading, empty list, zero reads
 *   7. card metadata (member/proposal counts) is parsed from the same render,
 *      and only resolved DAOs appear in the metadata map
 *   8. exactly ONE render is issued per DAO (the W3.2 single-read contract),
 *      and it is the STRICT read (an outage must throw, not return null)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import React from "react"
import type { DirectoryDAO } from "../lib/directory"
import { AbciQueryError } from "../lib/rpcFallback"

// ── Module-level mocks ────────────────────────────────────────
// The hook now resolves via the low-level Render("") helper (single read),
// not getDAOConfig (render + memberstore/IsArchived = 2-4 reads).

vi.mock("../lib/dao/shared", () => ({
    queryRender: vi.fn(),
}))

const shared = await import("../lib/dao/shared")

// ── Wrapper ───────────────────────────────────────────────────

function makeWrapper() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return function Wrapper({ children }: { children: ReactNode }) {
        return React.createElement(QueryClientProvider, { client }, children)
    }
}

// ── Fixtures ──────────────────────────────────────────────────

const REAL: DirectoryDAO = { name: "GovDAO", path: "gno.land/r/gov/dao", isSaved: false, category: "governance" }
const STALE: DirectoryDAO = { name: "FOUFOU DAO CLUB", path: "gno.land/r/foufou/dao", isSaved: true, category: "community" }

// A realistic Render("") body the parser can mine member/proposal counts from.
const REAL_RENDER = "# GovDAO\n\nCore governance DAO for gno.land\n\nMembers: 3\nProposals: 5\n"

const RPC_URL = "https://rpc.test13.gno.land"

// ── Tests ─────────────────────────────────────────────────────

describe("useResolvedDirectoryDaos", () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it("keeps a DAO whose render resolves on the active network", async () => {
        vi.mocked(shared.queryRender).mockResolvedValue(REAL_RENDER)

        const { useResolvedDirectoryDaos } = await import("./useResolvedDirectoryDaos")
        const { result } = renderHook(() => useResolvedDirectoryDaos([REAL], RPC_URL), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(result.current.daos).toHaveLength(1)
        expect(result.current.daos[0].path).toBe("gno.land/r/gov/dao")
    })

    it("drops a DAO whose render returns null (not deployed here)", async () => {
        vi.mocked(shared.queryRender).mockImplementation(async (_rpc, path) =>
            path === REAL.path ? REAL_RENDER : null,
        )

        const { useResolvedDirectoryDaos } = await import("./useResolvedDirectoryDaos")
        const { result } = renderHook(() => useResolvedDirectoryDaos([REAL, STALE], RPC_URL), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        const paths = result.current.daos.map(d => d.path)
        expect(paths).toContain(REAL.path)
        expect(paths).not.toContain(STALE.path)
        expect(result.current.daos).toHaveLength(1)
    })

    it("is loading (and shows no daos) while any query is in flight", async () => {
        // Never resolves → stays pending
        vi.mocked(shared.queryRender).mockReturnValue(new Promise(() => {}) as never)

        const { useResolvedDirectoryDaos } = await import("./useResolvedDirectoryDaos")
        const { result } = renderHook(() => useResolvedDirectoryDaos([REAL, STALE], RPC_URL), { wrapper: makeWrapper() })

        await waitFor(() => expect(result.current.loading).toBe(true))
        expect(result.current.daos).toHaveLength(0)
    })

    // B-9: a transport outage (every RPC down — the strict render THROWS a
    // plain Error) says nothing about whether a realm is deployed here. The
    // DAO must survive as a degraded card; silently dropping it deleted the
    // user's saved DAOs from the Directory during any transient outage.
    it("keeps a DAO whose render hits a transport outage, flagged degraded (B-9)", async () => {
        vi.mocked(shared.queryRender).mockImplementation(async (_rpc, path) => {
            if (path === REAL.path) return REAL_RENDER
            throw new Error("All RPC endpoints unreachable")
        })

        const { useResolvedDirectoryDaos } = await import("./useResolvedDirectoryDaos")
        const { result } = renderHook(() => useResolvedDirectoryDaos([REAL, STALE], RPC_URL), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        // Input order preserved; the unreachable DAO is kept, not dropped…
        const paths = result.current.daos.map(d => d.path)
        expect(paths).toEqual([REAL.path, STALE.path])
        // …and flagged degraded, with no metadata entry (nothing was read).
        expect(result.current.degraded.has(STALE.path)).toBe(true)
        expect(result.current.degraded.has(REAL.path)).toBe(false)
        expect(result.current.metadata.has(STALE.path)).toBe(false)
    })

    it("asks queryRender for the strict read (an outage must throw, not null)", async () => {
        vi.mocked(shared.queryRender).mockResolvedValue(REAL_RENDER)

        const { useResolvedDirectoryDaos } = await import("./useResolvedDirectoryDaos")
        const { result } = renderHook(() => useResolvedDirectoryDaos([REAL], RPC_URL), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(vi.mocked(shared.queryRender)).toHaveBeenCalledWith(RPC_URL, REAL.path, "", true)
    })

    // E-F9 under the strict read: AbciQueryError is the chain ANSWERING that
    // the realm is not deployed here — the one throw that may still drop.
    it("drops a DAO the chain says is not deployed here (AbciQueryError), not degraded", async () => {
        vi.mocked(shared.queryRender).mockImplementation(async (_rpc, path) => {
            if (path === REAL.path) return REAL_RENDER
            throw new AbciQueryError("vm/qrender", "not found", "invalid package path")
        })

        const { useResolvedDirectoryDaos } = await import("./useResolvedDirectoryDaos")
        const { result } = renderHook(() => useResolvedDirectoryDaos([REAL, STALE], RPC_URL), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        const paths = result.current.daos.map(d => d.path)
        expect(paths).toEqual([REAL.path])
        expect(result.current.degraded.size).toBe(0)
    })

    // The symmetric twin of the no-resurrect test below: a healthy resolved
    // card must SURVIVE a failed background refetch. React Query retains the
    // truthy render body, and that answer outranks the transient error — a
    // background blip may not flip resolved cards to degraded.
    it("keeps a resolved DAO resolved (with metadata) when a refetch hits transport", async () => {
        vi.mocked(shared.queryRender).mockResolvedValue(REAL_RENDER)

        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const wrapper = function Wrapper({ children }: { children: ReactNode }) {
            return React.createElement(QueryClientProvider, { client }, children)
        }
        const { useResolvedDirectoryDaos } = await import("./useResolvedDirectoryDaos")
        const { result } = renderHook(() => useResolvedDirectoryDaos([REAL], RPC_URL), { wrapper })
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.daos.map(d => d.path)).toEqual([REAL.path])

        // The next read fails at the transport layer; the retained body wins.
        vi.mocked(shared.queryRender).mockRejectedValue(new Error("All RPC endpoints unreachable"))
        await client.refetchQueries()
        await waitFor(() => expect(vi.mocked(shared.queryRender)).toHaveBeenCalledTimes(2))

        expect(result.current.daos.map(d => d.path)).toEqual([REAL.path])
        expect(result.current.degraded.size).toBe(0)
        expect(result.current.metadata.get(REAL.path)?.memberCount).toBe(3)
    })

    // React Query retains previous data when a background refetch fails. The
    // chain's own verdict (null render → not deployed here) outranks a later
    // transient error: the dead entry must not resurrect as a degraded card.
    it("keeps a chain-declared-dead DAO dropped when a later refetch hits transport", async () => {
        vi.mocked(shared.queryRender).mockResolvedValue(null)

        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const wrapper = function Wrapper({ children }: { children: ReactNode }) {
            return React.createElement(QueryClientProvider, { client }, children)
        }
        const { useResolvedDirectoryDaos } = await import("./useResolvedDirectoryDaos")
        const { result } = renderHook(() => useResolvedDirectoryDaos([STALE], RPC_URL), { wrapper })
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.daos).toEqual([]) // chain answered: not here → dropped

        // The next read fails at the transport layer; the retained answer wins.
        vi.mocked(shared.queryRender).mockRejectedValue(new Error("All RPC endpoints unreachable"))
        await client.refetchQueries()
        await waitFor(() => expect(vi.mocked(shared.queryRender)).toHaveBeenCalledTimes(2))

        expect(result.current.daos).toEqual([])
        expect(result.current.degraded.size).toBe(0)
    })

    it("preserves the input metadata of resolved DAOs", async () => {
        vi.mocked(shared.queryRender).mockResolvedValue(REAL_RENDER)

        const saved: DirectoryDAO = { name: "Worx DAO", path: "gno.land/r/demo/worx", isSaved: true, category: "community" }
        const { useResolvedDirectoryDaos } = await import("./useResolvedDirectoryDaos")
        const { result } = renderHook(() => useResolvedDirectoryDaos([saved], RPC_URL), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(result.current.daos[0]).toEqual(saved)
    })

    it("returns an empty, non-loading result for an empty input (zero reads)", async () => {
        const { useResolvedDirectoryDaos } = await import("./useResolvedDirectoryDaos")
        const { result } = renderHook(() => useResolvedDirectoryDaos([], RPC_URL), { wrapper: makeWrapper() })

        expect(result.current.loading).toBe(false)
        expect(result.current.daos).toEqual([])
        expect(result.current.metadata.size).toBe(0)
        expect(vi.mocked(shared.queryRender)).not.toHaveBeenCalled()
    })

    it("parses card metadata from the same render, only for resolved DAOs", async () => {
        vi.mocked(shared.queryRender).mockImplementation(async (_rpc, path) =>
            path === REAL.path ? REAL_RENDER : null,
        )

        const { useResolvedDirectoryDaos } = await import("./useResolvedDirectoryDaos")
        const { result } = renderHook(() => useResolvedDirectoryDaos([REAL, STALE], RPC_URL), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        // resolved DAO carries parsed counts…
        const meta = result.current.metadata.get(REAL.path)
        expect(meta?.memberCount).toBe(3)
        expect(meta?.proposalCount).toBe(5)
        expect(meta?.isActive).toBe(true)
        // …the dropped DAO is absent from the metadata map.
        expect(result.current.metadata.has(STALE.path)).toBe(false)
    })

    it("issues exactly one render per DAO (single-read fan-out contract)", async () => {
        vi.mocked(shared.queryRender).mockResolvedValue(REAL_RENDER)

        const daos = [REAL, STALE, { name: "X", path: "gno.land/r/x/dao", isSaved: false, category: "community" } as DirectoryDAO]
        const { useResolvedDirectoryDaos } = await import("./useResolvedDirectoryDaos")
        const { result } = renderHook(() => useResolvedDirectoryDaos(daos, RPC_URL), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        // One STRICT Render("") per DAO — no per-DAO memberstore/IsArchived
        // follow-up reads, and no non-strict read that would mask an outage.
        expect(vi.mocked(shared.queryRender)).toHaveBeenCalledTimes(daos.length)
        for (const d of daos) {
            expect(vi.mocked(shared.queryRender)).toHaveBeenCalledWith(RPC_URL, d.path, "", true)
        }
    })
})

// Self-recovery (B-9): the app pins refetchOnWindowFocus:false and its global
// retry predicate ignores plain transport errors, so without a re-poll a
// degraded card would only ever recover on a full tab remount. Unverified
// queries (never answered + errored) re-poll on an interval; answered queries
// — resolved, or chain-declared-dead — must never poll.
describe("useResolvedDirectoryDaos — degraded cards self-recover", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.useFakeTimers({ shouldAdvanceTime: true })
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it("re-polls an unverified DAO and clears the degraded flag once the chain answers", async () => {
        vi.mocked(shared.queryRender).mockRejectedValue(new Error("All RPC endpoints unreachable"))

        const { useResolvedDirectoryDaos } = await import("./useResolvedDirectoryDaos")
        const { result } = renderHook(() => useResolvedDirectoryDaos([REAL], RPC_URL), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.degraded.has(REAL.path)).toBe(true)
        expect(vi.mocked(shared.queryRender)).toHaveBeenCalledTimes(1)

        // Still down at the next poll: card stays degraded, polling continues.
        await vi.advanceTimersByTimeAsync(30_000)
        await waitFor(() => expect(vi.mocked(shared.queryRender)).toHaveBeenCalledTimes(2))
        expect(result.current.degraded.has(REAL.path)).toBe(true)

        // The outage ends: the next poll resolves, the card recovers fully.
        vi.mocked(shared.queryRender).mockResolvedValue(REAL_RENDER)
        await vi.advanceTimersByTimeAsync(30_000)
        await waitFor(() => expect(result.current.degraded.size).toBe(0))
        expect(result.current.daos.map(d => d.path)).toEqual([REAL.path])
        expect(result.current.metadata.get(REAL.path)?.memberCount).toBe(3)

        // Recovered (data retained) → the poll gate closes again.
        const settled = vi.mocked(shared.queryRender).mock.calls.length
        await vi.advanceTimersByTimeAsync(90_000)
        expect(vi.mocked(shared.queryRender).mock.calls.length).toBe(settled)
    })

    it("never polls DAOs the chain already answered (resolved or not-deployed)", async () => {
        vi.mocked(shared.queryRender).mockImplementation(async (_rpc, path) =>
            path === REAL.path ? REAL_RENDER : null,
        )

        const { useResolvedDirectoryDaos } = await import("./useResolvedDirectoryDaos")
        const { result } = renderHook(() => useResolvedDirectoryDaos([REAL, STALE], RPC_URL), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(vi.mocked(shared.queryRender)).toHaveBeenCalledTimes(2)

        // No unverified queries → no polling for anyone.
        await vi.advanceTimersByTimeAsync(90_000)
        expect(vi.mocked(shared.queryRender)).toHaveBeenCalledTimes(2)
    })
})
