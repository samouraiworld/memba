import { describe, expect, it, vi } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import React, { type ReactNode } from "react"

vi.mock("../../lib/api", () => ({ api: { multisigs: vi.fn(async () => ({ multisigs: [] })) } }))

import { api } from "../../lib/api"
import { GNO_CHAIN_ID } from "../../lib/config"
import { useMyMultisigs } from "./useOsMultisig"

function wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return React.createElement(QueryClientProvider, { client }, children)
}

describe("useMyMultisigs (Memba OS)", () => {
    it("lists only the active chain's multisigs, like the classic hub", async () => {
        const auth = { token: { userAddress: "g1member" }, isAuthenticated: true } as never
        renderHook(() => useMyMultisigs(auth), { wrapper })
        await waitFor(() => expect(api.multisigs).toHaveBeenCalled())
        expect(vi.mocked(api.multisigs).mock.calls[0][0]).toMatchObject({ chainId: GNO_CHAIN_ID })
        expect(GNO_CHAIN_ID).not.toBe("")
    })
})
