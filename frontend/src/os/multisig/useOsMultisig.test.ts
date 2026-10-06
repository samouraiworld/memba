import { describe, expect, it, vi } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import React, { type ReactNode } from "react"

vi.mock("../../lib/api", () => ({ api: { multisigs: vi.fn(async () => ({ multisigs: [] })) } }))

import { api } from "../../lib/api"
import { GNO_CHAIN_ID } from "../../lib/config"
import type { Transaction } from "../../gen/memba/v1/memba_pb"
import { awaitingSignature, awaitingText, notificationsLabel, useMyMultisigs } from "./useOsMultisig"

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

describe("proposals waiting for a member's signature", () => {
    const tx = (multisigAddress: string, signers: string[], finalHash = "") =>
        ({ multisigAddress, finalHash, signatures: signers.map((userAddress) => ({ userAddress })) }) as unknown as Transaction
    it("counts unsent proposals the member has not signed, per account", () => {
        const counts = awaitingSignature([tx("g1a", ["g1bob"]), tx("g1a", []), tx("g1a", ["g1me"]), tx("g1b", ["g1bob"]), tx("g1b", [], "SENT")], "g1me")
        expect([...counts]).toEqual([["g1a", 2], ["g1b", 1]])
    })
    it("words the count and the bell's label", () => {
        expect(awaitingText(1)).toBe("1 proposal waits for your signature")
        expect(awaitingText(2)).toBe("2 proposals wait for your signature")
        expect(notificationsLabel(0, 0)).toBe("Notifications")
        expect(notificationsLabel(1, 2)).toBe("Notifications, 1 new, 2 proposals wait for your signature")
    })
})
