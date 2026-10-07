import { describe, expect, it, vi } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import React, { type ReactNode } from "react"

vi.mock("../../lib/api", () => ({ api: { multisigs: vi.fn(async () => ({ multisigs: [] })), transactions: vi.fn() } }))
vi.mock("../../lib/config", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../lib/config")>()), ENABLE_NATIVE_GNO_MULTISIG: true }))

import { api } from "../../lib/api"
import { GNO_CHAIN_ID } from "../../lib/config"
import type { Transaction } from "../../gen/memba/v1/memba_pb"
import { notificationsLabel, useAwaiting, useMyMultisigs } from "./useOsMultisig"

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
    const auth = { token: { userAddress: "g1me" }, isAuthenticated: true } as never
    const tx = (multisigAddress: string, signers: string[]) =>
        ({ multisigAddress, multisigPubkeyJson: '{"@type":"/tm.PubKeyMultisig"}', finalHash: "", threshold: 2, signatures: signers.map((userAddress) => ({ userAddress })) }) as unknown as Transaction
    it("words the bell's label: joined accounts by name of the action, shared ones as a neutral count", () => {
        expect(notificationsLabel(0, { mine: 0, shared: 0 })).toBe("Notifications")
        expect(notificationsLabel(1, { mine: 2, shared: 1 })).toBe("Notifications, 1 new, 2 proposals wait for your signature, 1 proposal waits in a multisig shared with you")
    })
    it("splits the count by join state, treats an account missing from the list as shared, and gives a guest nothing even from a member's cache", async () => {
        const txs = [tx("g1joined", ["g1bob"]), tx("g1shared", []), tx("g1unlisted", ["g1bob"])]
        vi.mocked(api.transactions).mockResolvedValue({ transactions: txs } as never)
        vi.mocked(api.multisigs).mockResolvedValue({ multisigs: [{ address: "g1joined", joined: true }, { address: "g1shared", joined: false }] } as never)
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const wrap = ({ children }: { children: ReactNode }) => React.createElement(QueryClientProvider, { client }, children)
        const member = renderHook(() => useAwaiting(auth, "g1me"), { wrapper: wrap })
        await waitFor(() => expect(member.result.current.mine).toBe(1))
        // g1shared is not joined; g1unlisted is not in the list at all (join state unknown).
        expect(member.result.current.shared).toBe(2)
        const guest = renderHook(() => useAwaiting(auth, ""), { wrapper: wrap })
        expect(guest.result.current).toMatchObject({ mine: 0, shared: 0 })
    })
})
