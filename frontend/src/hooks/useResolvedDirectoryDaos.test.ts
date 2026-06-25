/**
 * useResolvedDirectoryDaos.test.ts
 *
 * Verifies the Directory DAOs-tab resolve filter (R2-D2): only DAOs that
 * actually render on the active network are shown.
 *
 *   1. a DAO whose getDAOConfig resolves (non-null) is KEPT
 *   2. a DAO whose getDAOConfig returns null is DROPPED
 *   3. loading is true while any per-DAO query is in flight; daos is []
 *   4. a per-DAO RPC error drops that DAO (treated as unresolved) without throwing
 *   5. resolved DAOs keep their input metadata (name/category/isSaved)
 *   6. empty input → not loading, empty list
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import React from "react"
import type { DirectoryDAO } from "../lib/directory"

// ── Module-level mocks ────────────────────────────────────────

vi.mock("../lib/dao", () => ({
    getDAOConfig: vi.fn(),
}))

const daoMod = await import("../lib/dao")

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

const CONFIG = {
    name: "GovDAO",
    description: "",
    threshold: "",
    memberCount: 3,
    memberstorePath: "",
    tierDistribution: [],
    isArchived: false,
}

const RPC_URL = "https://rpc.test13.gno.land"

// ── Tests ─────────────────────────────────────────────────────

describe("useResolvedDirectoryDaos", () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it("keeps a DAO whose config resolves on the active network", async () => {
        vi.mocked(daoMod.getDAOConfig).mockResolvedValue(CONFIG as never)

        const { useResolvedDirectoryDaos } = await import("./useResolvedDirectoryDaos")
        const { result } = renderHook(() => useResolvedDirectoryDaos([REAL], RPC_URL), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(result.current.daos).toHaveLength(1)
        expect(result.current.daos[0].path).toBe("gno.land/r/gov/dao")
    })

    it("drops a DAO whose config returns null (not deployed here)", async () => {
        vi.mocked(daoMod.getDAOConfig).mockImplementation(async (_rpc, path) =>
            path === REAL.path ? (CONFIG as never) : null,
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
        vi.mocked(daoMod.getDAOConfig).mockReturnValue(new Promise(() => {}) as never)

        const { useResolvedDirectoryDaos } = await import("./useResolvedDirectoryDaos")
        const { result } = renderHook(() => useResolvedDirectoryDaos([REAL, STALE], RPC_URL), { wrapper: makeWrapper() })

        await waitFor(() => expect(result.current.loading).toBe(true))
        expect(result.current.daos).toHaveLength(0)
    })

    it("drops a DAO whose config fetch rejects (treated as unresolved, no throw)", async () => {
        vi.mocked(daoMod.getDAOConfig).mockImplementation(async (_rpc, path) => {
            if (path === REAL.path) return CONFIG as never
            throw new Error("all RPC down")
        })

        const { useResolvedDirectoryDaos } = await import("./useResolvedDirectoryDaos")
        const { result } = renderHook(() => useResolvedDirectoryDaos([REAL, STALE], RPC_URL), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        const paths = result.current.daos.map(d => d.path)
        expect(paths).toEqual([REAL.path])
    })

    it("preserves the input metadata of resolved DAOs", async () => {
        vi.mocked(daoMod.getDAOConfig).mockResolvedValue(CONFIG as never)

        const saved: DirectoryDAO = { name: "Worx DAO", path: "gno.land/r/demo/worx", isSaved: true, category: "community" }
        const { useResolvedDirectoryDaos } = await import("./useResolvedDirectoryDaos")
        const { result } = renderHook(() => useResolvedDirectoryDaos([saved], RPC_URL), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(result.current.daos[0]).toEqual(saved)
    })

    it("returns an empty, non-loading result for an empty input", async () => {
        const { useResolvedDirectoryDaos } = await import("./useResolvedDirectoryDaos")
        const { result } = renderHook(() => useResolvedDirectoryDaos([], RPC_URL), { wrapper: makeWrapper() })

        expect(result.current.loading).toBe(false)
        expect(result.current.daos).toEqual([])
        expect(vi.mocked(daoMod.getDAOConfig)).not.toHaveBeenCalled()
    })
})
