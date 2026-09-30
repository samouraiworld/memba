import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import { GNO_CHAIN_ID } from "../../lib/config"
import { useReviewsModerator } from "./useReviewsModerator"

const fetchModerator = vi.hoisted(() => vi.fn())
vi.mock("../../lib/reviews", async (importActual) => ({ ...await importActual<typeof import("../../lib/reviews")>(), fetchModerator }))

const REALM = "gno.land/r/samcrew/memba_reviews_v2"
const MODERATOR = "g136j0m08pkm2lwwde9dmlx8uee26llent9s5cpf"

function harness() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }
}

describe("useReviewsModerator", () => {
    it("answers nothing while switched off, even when another page already cached this realm's moderator", () => {
        const { client, wrapper } = harness()
        client.setQueryData(["reviews", "moderator", GNO_CHAIN_ID, REALM], MODERATOR)
        const { result } = renderHook(() => useReviewsModerator(REALM, false), { wrapper })
        expect(result.current).toBeUndefined()
        expect(fetchModerator).not.toHaveBeenCalled()
    })

    it("is undefined while the read is pending, then the moderator, and null for a read that fails", async () => {
        const { wrapper } = harness()
        let answer!: (value: string) => void
        fetchModerator.mockReturnValueOnce(new Promise((resolve) => { answer = resolve }))
        const { result } = renderHook(() => useReviewsModerator(REALM), { wrapper })
        expect(result.current).toBeUndefined()
        answer(MODERATOR)
        await waitFor(() => expect(result.current).toBe(MODERATOR))

        fetchModerator.mockRejectedValueOnce(new Error("rpc down"))
        const failed = renderHook(() => useReviewsModerator("gno.land/r/x/other"), { wrapper: harness().wrapper })
        await waitFor(() => expect(failed.result.current).toBeNull())
    })
})
