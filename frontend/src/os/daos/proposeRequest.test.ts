import { beforeEach, describe, expect, it, vi } from "vitest"

const quote = vi.hoisted(() => ({ ugnotPerThousandGas: 1 }))
vi.mock("../../lib/grc20", async (orig) => ({
    ...(await orig<typeof import("../../lib/grc20")>()),
    freshFeeForGasWanted: vi.fn(async (gasWanted: number) => Math.ceil((gasWanted * 1.2 * quote.ugnotPerThousandGas) / 1000)),
}))
vi.mock("../../lib/dao", async (orig) => ({
    ...(await orig<typeof import("../../lib/dao")>()),
    getDAOConfig: vi.fn(async () => ({ v2: { archived: false, electorate_version: 0 } })),
    getDAOMembers: vi.fn(async () => [{ address: "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5" }]),
}))
vi.mock("../../lib/dao/daoTx", async (orig) => ({
    ...(await orig<typeof import("../../lib/dao/daoTx")>()),
    broadcastDaoTx: vi.fn(async () => ({ hash: "HASH" })),
}))

import type { MembaV2Config } from "../../lib/dao/membaV2"
import { broadcastDaoTx } from "../../lib/dao/daoTx"
import { proposeRequest } from "./proposeRequest"

const CALLER = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const REALM = "gno.land/r/team/dao"
const config = { proposal_count: 5, electorate_version: 0, threshold: 60, quorum: 20, voting_period: 86400 } as MembaV2Config

function request(onCreated = vi.fn()) {
    return { onCreated, req: proposeRequest({ daoKind: "memba-v2", realmPath: REALM, daoName: "Team", caller: CALLER,
        config, proposalKind: "text", action: { type: "propose-text", title: "Same title", description: "", category: "governance" },
        effect: "A decision", onCreated, gasPrice: { gas: 1000, ugnot: 1 } }) }
}

describe("DAO proposal transaction confirmation", () => {
    beforeEach(() => localStorage.clear())

    it("keeps a hash-only result unconfirmed even if another same-title proposal may be visible", async () => {
        const { req, onCreated } = request()
        await expect(req.verify?.(undefined, "E2EHASH", { hash: "E2EHASH" })).resolves.toBe(false)
        expect(onCreated).not.toHaveBeenCalled()
    })

    it("confirms the ID returned by this transaction", async () => {
        const { req, onCreated } = request()
        await expect(req.verify?.(undefined, "E2EHASH", { deliverTx: { data: "(6 uint64)" } })).resolves.toBe(true)
        expect(onCreated).toHaveBeenCalledExactlyOnceWith(6)
    })
})

describe("DAO proposal fee", () => {
    it("shows the network price for the proposal's gas limit, and no longer defers the fee to Adena", () => {
        const { req } = request()
        const lines = new Map(req.lines(undefined))
        expect(lines.get("Network fee")).toMatch(/GNOT$/)
        expect(lines.has("Gas limit")).toBe(false)
        expect(req.note).toBe("Memba re-checks the DAO, your membership and the fee before signing.")
    })

    it("sends exactly the fee shown", async () => {
        const { req } = request()
        const beforeSign = async () => {}
        await req.send(undefined, beforeSign)
        expect(broadcastDaoTx).toHaveBeenCalledWith(expect.anything(), "Propose: Same title", beforeSign,
            { approvedDepositUgnot: undefined, fee: { gasWanted: 26_000_000, gasFee: 31_200 } })
    })

    it("stops before the wallet when a fresh quote no longer covers the fee shown", async () => {
        quote.ugnotPerThousandGas = 1
        const { req } = request()
        await expect(req.recheck!(undefined)).resolves.toBeUndefined()
        quote.ugnotPerThousandGas = 2
        await expect(req.recheck!(undefined)).rejects.toThrow("The network fee increased since review")
    })
})
