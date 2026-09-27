import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"

const reads = vi.hoisted(() => ({ full: { name: "Full DAO", tierDistribution: [{ tier: "Members", count: 1 }] } }))
vi.mock("../../lib/dao", async (original) => ({
    ...(await original<typeof import("../../lib/dao")>()),
    getDAOConfig: vi.fn(async () => reads.full),
}))
vi.mock("../../lib/dao/membaV2Shell", async (original) => ({
    ...(await original<typeof import("../../lib/dao/membaV2Shell")>()),
    hasVotedOnV2: vi.fn(),
    findV2VoterChoice: vi.fn(),
}))

import { getDAOConfig } from "../../lib/dao"
import { findV2VoterChoice, hasVotedOnV2 } from "../../lib/dao/membaV2Shell"
import { useDaoConfig, useMyVote } from "./useOsDao"

describe("OS DAO config cache", () => {
    it("does not reuse a light classic-page config as the full OS config", async () => {
        const realm = "gno.land/r/alice/team"
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        client.setQueryData(["dao", "config", realm], { name: "Light DAO" })
        const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
        const { result } = renderHook(() => useDaoConfig(realm), { wrapper })

        await waitFor(() => expect(result.current.isSuccess).toBe(true))
        expect(result.current.data).toEqual(reads.full)
        expect(getDAOConfig).toHaveBeenCalledWith(expect.any(String), realm, true)
        expect(client.getQueryData(["dao", "config", realm])).toEqual({ name: "Light DAO" })
    })
})

describe("OS DAO member vote", () => {
    it("keeps the vote recorded with unknown choice when vote pages are unavailable", async () => {
        vi.mocked(hasVotedOnV2).mockResolvedValue(true)
        vi.mocked(findV2VoterChoice).mockRejectedValue(new Error("RPC unavailable"))
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
        const { result } = renderHook(() => useMyVote("gno.land/r/alice/team", 7, "g1member", true), { wrapper })

        await waitFor(() => expect(result.current.isSuccess).toBe(true))
        expect(result.current.data).toEqual({ voted: true, choice: null })
    })
})
