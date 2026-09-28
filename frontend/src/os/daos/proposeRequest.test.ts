import { beforeEach, describe, expect, it, vi } from "vitest"
import type { MembaV2Config } from "../../lib/dao/membaV2"
import { proposeRequest } from "./proposeRequest"

const CALLER = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const REALM = "gno.land/r/team/dao"
const config = { proposal_count: 5, electorate_version: 0, threshold: 60, quorum: 20, voting_period: 86400 } as MembaV2Config

function request(onCreated = vi.fn()) {
    return { onCreated, req: proposeRequest({ daoKind: "memba-v2", realmPath: REALM, daoName: "Team", caller: CALLER,
        config, proposalKind: "text", action: { type: "propose-text", title: "Same title", description: "", category: "governance" },
        effect: "A decision", onCreated }) }
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
