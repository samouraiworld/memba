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
 *   4. a per-DAO RPC error drops that DAO (treated as unresolved) without throwing
 *   5. resolved DAOs keep their input metadata (name/category/isSaved)
 *   6. empty input → not loading, empty list, zero reads
 *   7. card metadata (member/proposal counts) is parsed from the same render,
 *      and only resolved DAOs appear in the metadata map
 *   8. exactly ONE render is issued per DAO (the W3.2 single-read contract)
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import React from "react"
import type { DirectoryDAO } from "../lib/directory"

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

    it("drops a DAO whose render fetch rejects (treated as unresolved, no throw)", async () => {
        vi.mocked(shared.queryRender).mockImplementation(async (_rpc, path) => {
            if (path === REAL.path) return REAL_RENDER
            throw new Error("all RPC down")
        })

        const { useResolvedDirectoryDaos } = await import("./useResolvedDirectoryDaos")
        const { result } = renderHook(() => useResolvedDirectoryDaos([REAL, STALE], RPC_URL), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        const paths = result.current.daos.map(d => d.path)
        expect(paths).toEqual([REAL.path])
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

        // One Render("") per DAO — no per-DAO memberstore/IsArchived follow-up reads.
        expect(vi.mocked(shared.queryRender)).toHaveBeenCalledTimes(daos.length)
        for (const d of daos) {
            expect(vi.mocked(shared.queryRender)).toHaveBeenCalledWith(RPC_URL, d.path, "")
        }
    })
})
