/**
 * useLaneQuery.test.tsx — cached per-lane query → CardModels (marketplace-v2 Phase 2.2).
 */
import type { ReactNode } from "react"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { describe, it, expect } from "vitest"
import { useLaneQuery } from "./useLaneQuery"
import type { CardModel } from "./types"

function makeWrapper() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )
}

const toCard = (n: number): CardModel => ({
    id: String(n),
    lane: "nft",
    title: `#${n}`,
    media: { kind: "monogram", seed: String(n) },
    verified: false,
    seller: { handle: "@x", address: "g1x00000000000000000000000000000000", reputation: null },
    stats: [],
    priceLabel: "1 GNOT",
    href: `#${n}`,
})

describe("useLaneQuery", () => {
    it("maps fetched rows to CardModels through the adapter", async () => {
        const { result } = renderHook(
            () => useLaneQuery("nft", async () => [1, 2, 3], toCard),
            { wrapper: makeWrapper() },
        )
        await waitFor(() => expect(result.current.isLoading).toBe(false))
        expect(result.current.cards.map((c) => c.id)).toEqual(["1", "2", "3"])
        expect(result.current.isError).toBe(false)
    })

    it("surfaces an error state with no cards, without throwing", async () => {
        const { result } = renderHook(
            () => useLaneQuery("token", async () => { throw new Error("boom") }, toCard),
            { wrapper: makeWrapper() },
        )
        await waitFor(() => expect(result.current.isError).toBe(true))
        expect(result.current.cards).toEqual([])
    })

    it("does not fetch when disabled", () => {
        let called = 0
        const { result } = renderHook(
            () => useLaneQuery("nft", async () => { called++; return [1] }, toCard, { enabled: false }),
            { wrapper: makeWrapper() },
        )
        expect(called).toBe(0)
        expect(result.current.cards).toEqual([])
    })
})
