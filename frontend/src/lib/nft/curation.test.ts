import { beforeEach, describe, expect, it, vi } from "vitest"
import { GNO_RPC_URL } from "../config"
import { bech32Encode } from "../dao/realmAddress"
import { AbciQueryError } from "../rpcFallback"
import {
    NFT_CURATION_PATH, getApplication, getCurationAccess, getCurationManagers, getCurationRecord, getCurationState,
    listApplications, listFeatureSlots, listOpenAppeals,
} from "./curation"
import { ReadError, RealmRefusedError } from "./read"

const queryEval = vi.hoisted(() => vi.fn())
vi.mock("../dao/shared", async (original) => ({ ...(await original<typeof import("../dao/shared")>()), queryEval }))

/** Sixteen addresses with valid checksums, in strictly ascending order. */
const ADDRESSES = Array.from({ length: 16 }, (_, n) => bech32Encode("g", new Uint8Array(20).fill(n))).sort()
const addr = (n: number) => ADDRESSES[n]
/** An address whose checksum is valid: the realm refuses any other as an argument. */
const WHO = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const HASH = "a".repeat(64)
const CID_V1 = `bafy${"b".repeat(55)}`
const CID_V0 = `Qm${"a".repeat(44)}`
const qeval = (value: unknown) => `(${JSON.stringify(JSON.stringify(value))} string)`
const answer = (value: unknown) => queryEval.mockResolvedValueOnce(qeval(value))
const without = (row: Record<string, unknown>, key: string) => Object.fromEntries(Object.entries(row).filter(([name]) => name !== key))

const state = { admin: addr(0), pendingAdmin: "", activeManagers: 2, maxSeats: 5 }
const manager = { account: addr(1), lead: true, until: "1790000000" }

const submitted = {
    collection: "C1", founder: addr(3), statementHash: HASH, statementCID: CID_V1, revision: "1", status: "submitted",
    reviewer: "", reasonHash: "", reasonCID: "", updatedAt: "1780000000",
}
const reviewed = { ...submitted, revision: "2", status: "recommended", reviewer: addr(1), reasonHash: "b".repeat(64), reasonCID: CID_V0 }

const access = { collection: "C1", account: WHO, founder: false, manager: true, conflicted: false }

const verification = { verified: true, reasonHash: HASH, reasonCID: CID_V1, updatedAt: "1780000000" }
const feature = { proposer: addr(1), approver: addr(2), reasonHash: HASH, reasonCID: CID_V0, until: "1790000000" }
const hold = { actor: addr(1), confirmer: "", extended: false, reasonHash: HASH, reasonCID: CID_V1, until: "1790000000" }
const openAppeal = {
    collection: "C1", subject: "hold", statementHash: HASH, statementCID: CID_V1, filedAt: "1780000000", open: true,
    upheld: false, reasonHash: "", reasonCID: "", resolvedAt: "0",
}
const resolvedAppeal = { ...openAppeal, open: false, upheld: true, reasonHash: "c".repeat(64), reasonCID: CID_V0, resolvedAt: "1780000100" }
const noAppeals = { application: null, hold: null, verification: null, feature: null }
const bare = { collection: "C1", verified: false, featured: false, hidden: false, verification: null, feature: null, hold: null, appeals: noAppeals }

const slot = { collection: "C1", featured: true, until: "1790000000" }

beforeEach(() => queryEval.mockReset())

describe("state", () => {
    const read = (row: unknown) => { answer(row); return getCurationState() }

    it("reads the admin, a pending handoff and the seats", async () => {
        await expect(read(state)).resolves.toEqual(state)
        expect(queryEval).toHaveBeenCalledWith(GNO_RPC_URL, NFT_CURATION_PATH, "StateJSON()", true)
        await expect(read({ ...state, pendingAdmin: addr(9), activeManagers: 5 })).resolves.toMatchObject({ pendingAdmin: addr(9), activeManagers: 5 })
        await expect(read({ ...state, activeManagers: 0 })).resolves.toMatchObject({ activeManagers: 0 })
    })

    it.each([
        ["an unknown field", { ...state, paused: false }, "Invalid curation state fields"],
        ["a missing field", without(state, "pendingAdmin"), "Invalid curation state fields"],
        ["no admin", { ...state, admin: "" }, "Invalid admin"],
        ["a malformed pending admin", { ...state, pendingAdmin: "g1pending" }, "Invalid pending admin"],
        ["a seat count written as a decimal string", { ...state, activeManagers: "2" }, "Invalid active managers"],
        ["a negative seat count", { ...state, activeManagers: -1 }, "Invalid active managers"],
        ["a fractional seat limit", { ...state, maxSeats: 5.5 }, "Invalid seat limit"],
        ["a handoff to the admin itself", { ...state, pendingAdmin: addr(0) }, "Inconsistent curation state"],
        ["more active managers than seats", { ...state, activeManagers: 6 }, "Inconsistent curation state"],
        ["a seat limit this reader was not written for", { ...state, maxSeats: 7 }, "Inconsistent curation state"],
    ])("rejects %s", async (_name, row, message) => {
        await expect(read(row)).rejects.toThrow(new RegExp(`^${message}$`))
    })

    it("reports an unreadable or undecodable answer as an error", async () => {
        queryEval.mockResolvedValueOnce(null)
        await expect(getCurationState()).rejects.toThrow("Could not read curation state")
        queryEval.mockResolvedValueOnce("not a qeval answer")
        await expect(getCurationState()).rejects.toThrow(/^Invalid curation state$/)
    })
})

describe("managers", () => {
    const read = (rows: unknown) => { answer(rows); return getCurationManagers() }
    const seats = (count: number) => Array.from({ length: count }, (_, n) => ({ ...manager, account: addr(n + 1) }))

    it("reads the active seats, and a realm without managers as an empty list", async () => {
        await expect(read([manager, { account: addr(2), lead: false, until: "1790000001" }])).resolves.toEqual([
            { account: addr(1), lead: true, until: 1790000000n },
            { account: addr(2), lead: false, until: 1790000001n },
        ])
        expect(queryEval).toHaveBeenCalledWith(GNO_RPC_URL, NFT_CURATION_PATH, "ManagersJSON()", true)
        await expect(read(seats(5))).resolves.toHaveLength(5)
        await expect(read([])).resolves.toEqual([])
    })

    it.each([
        ["an answer that is not a list", { managers: [] }, "Invalid manager list"],
        ["a manager with an unknown field", [{ ...manager, conflicts: [] }], "Invalid manager fields"],
        ["a malformed account", [{ ...manager, account: "g1manager" }], "Invalid manager account"],
        ["a lead flag that is not a boolean", [{ ...manager, lead: "true" }], "Invalid lead"],
        ["a term that is not a decimal string", [{ ...manager, until: 1790000000 }], "Invalid seat term"],
        ["more managers than seats", seats(6), "Inconsistent manager list"],
        ["an account seated twice", [manager, manager], "Inconsistent manager list"],
        ["seats out of order", [{ ...manager, account: addr(2) }, manager], "Inconsistent manager list"],
    ])("rejects %s", async (_name, rows, message) => {
        await expect(read(rows)).rejects.toThrow(new RegExp(`^${message}$`))
    })

    it("reports unreadable seats as an error, never as an empty list", async () => {
        queryEval.mockResolvedValueOnce(null)
        await expect(getCurationManagers()).rejects.toThrow("Could not read managers")
    })
})

describe("application", () => {
    const read = (row: unknown) => { answer(row); return getApplication("C1") }

    it("reads an application awaiting review and a reviewed one", async () => {
        await expect(read(submitted)).resolves.toEqual({ ...submitted, revision: 1n, updatedAt: 1780000000n })
        expect(queryEval).toHaveBeenCalledWith(GNO_RPC_URL, NFT_CURATION_PATH, 'ApplicationJSON("C1")', true)
        await expect(read(reviewed)).resolves.toEqual({ ...reviewed, revision: 2n, updatedAt: 1780000000n })
        await expect(read({ ...reviewed, status: "changes_requested" })).resolves.toMatchObject({ status: "changes_requested" })
        await expect(read({ ...reviewed, status: "declined" })).resolves.toMatchObject({ status: "declined" })
    })

    it("reads the realm's null as no application, and nothing else", async () => {
        await expect(read(null)).resolves.toBeNull()
        queryEval.mockResolvedValueOnce(null)
        await expect(getApplication("C1")).rejects.toThrow("Could not read application")
        queryEval.mockResolvedValueOnce("not a qeval answer")
        await expect(getApplication("C1")).rejects.toThrow(/^Invalid application$/)
        queryEval.mockResolvedValueOnce('("{\\"collection\\":" string)')
        await expect(getApplication("C1")).rejects.toThrow(/^Invalid application$/)
        queryEval.mockResolvedValueOnce("(nil string)")
        await expect(getApplication("C1")).rejects.toThrow(/^Invalid application$/)
    })

    it.each([
        ["an unknown field", { ...submitted, score: "1" }, "Invalid application fields"],
        ["a missing field", without(submitted, "reasonCID"), "Invalid application fields"],
        ["an unknown status", { ...submitted, status: "approved" }, "Invalid application status"],
        ["a malformed founder", { ...submitted, founder: "" }, "Invalid founder"],
        ["a statement hash in uppercase", { ...submitted, statementHash: "A".repeat(64) }, "Invalid statement hash"],
        ["a statement hash that is too short", { ...submitted, statementHash: "a".repeat(63) }, "Invalid statement hash"],
        ["no statement", { ...submitted, statementHash: "", statementCID: "" }, "Invalid statement hash"],
        ["a statement CID that is a URL", { ...submitted, statementCID: `https://example.org/ipfs/${CID_V1}` }, "Invalid statement CID"],
        ["a statement CIDv1 that is too short", { ...submitted, statementCID: `bafy${"b".repeat(54)}` }, "Invalid statement CID"],
        ["a statement CIDv0 outside base58", { ...submitted, statementCID: `Qm${"l".repeat(44)}` }, "Invalid statement CID"],
        ["a revision of zero", { ...submitted, revision: "0" }, "Invalid revision"],
        ["a revision that is not a decimal string", { ...submitted, revision: 1 }, "Invalid revision"],
        ["an application awaiting review that names a reviewer", { ...submitted, reviewer: addr(1) }, "Inconsistent application review"],
        ["an application awaiting review that carries a reason", { ...submitted, reasonHash: HASH, reasonCID: CID_V1 }, "Inconsistent review reason"],
        ["an application awaiting review with half a reason", { ...submitted, reasonCID: CID_V1 }, "Inconsistent review reason"],
        ["a reviewed application without a reviewer", { ...reviewed, reviewer: "" }, "Invalid reviewer"],
        ["a reviewed application without a reason", { ...reviewed, reasonHash: "", reasonCID: "" }, "Invalid review reason hash"],
        ["a reviewed application with half a reason", { ...reviewed, reasonCID: "" }, "Invalid review reason CID"],
        ["an update time that is not a decimal string", { ...submitted, updatedAt: 1780000000 }, "Invalid update time"],
        ["the application of another collection", { ...submitted, collection: "C2" }, "Application does not match the request"],
    ])("rejects %s", async (_name, row, message) => {
        await expect(read(row)).rejects.toThrow(new RegExp(`^${message}$`))
    })
})

describe("application list", () => {
    it("reads a page of applications, and none as an empty list", async () => {
        answer([submitted, { ...reviewed, collection: "C2" }])
        await expect(listApplications()).resolves.toEqual([
            { ...submitted, revision: 1n, updatedAt: 1780000000n },
            { ...reviewed, collection: "C2", revision: 2n, updatedAt: 1780000000n },
        ])
        expect(queryEval).toHaveBeenCalledWith(GNO_RPC_URL, NFT_CURATION_PATH, "ApplicationsJSON(0, 20)", true)
        answer([])
        await expect(listApplications(3, 50)).resolves.toEqual([])
        expect(queryEval).toHaveBeenLastCalledWith(GNO_RPC_URL, NFT_CURATION_PATH, "ApplicationsJSON(3, 50)", true)
    })

    it.each([
        ["an answer that is not a list", submitted, "Invalid application list"],
        ["more rows than the page size", [submitted, { ...submitted, collection: "C2" }, { ...submitted, collection: "C3" }], "Invalid application list"],
        ["the same collection twice", [submitted, reviewed], "Duplicate application"],
        ["a null row", [null], "Invalid application"],
        ["a malformed row", [{ ...submitted, status: "approved" }], "Invalid application status"],
    ])("rejects %s", async (_name, rows, message) => {
        answer(rows)
        await expect(listApplications(0, 2)).rejects.toThrow(new RegExp(`^${message}$`))
    })

    it("reports unreadable applications as an error, never as an empty list", async () => {
        queryEval.mockResolvedValueOnce(null)
        await expect(listApplications()).rejects.toThrow("Could not read applications")
    })
})

describe("access", () => {
    const read = (row: unknown) => { answer(row); return getCurationAccess("C1", WHO) }

    it("reads what an account is to a collection", async () => {
        await expect(read(access)).resolves.toEqual(access)
        expect(queryEval).toHaveBeenCalledWith(GNO_RPC_URL, NFT_CURATION_PATH, `AccessJSON("C1", "${WHO}")`, true)
        await expect(read({ ...access, founder: true, manager: false, conflicted: true })).resolves.toMatchObject({ founder: true, conflicted: true })
        await expect(read({ ...access, conflicted: true })).resolves.toMatchObject({ manager: true, conflicted: true })
    })

    it.each([
        ["an unknown field", { ...access, admin: false }, "Invalid curation access fields"],
        ["a role that is not a boolean", { ...access, manager: 1 }, "Invalid manager"],
        ["the access of another collection", { ...access, collection: "C2" }, "Curation access does not match the request"],
        ["the access of another account", { ...access, account: addr(1) }, "Curation access does not match the request"],
        ["a founder without a conflict", { ...access, founder: true }, "Inconsistent curation access"],
    ])("rejects %s", async (_name, row, message) => {
        await expect(read(row)).rejects.toThrow(new RegExp(`^${message}$`))
    })

    it.each(["", "g1manager", `g1${"q".repeat(38)}`, WHO.toUpperCase(), `${WHO}")+("`, `${WHO.slice(0, -1)}"`])("never sends the account %j to the chain", async (who) => {
        await expect(getCurationAccess("C1", who)).rejects.toThrow(/^Invalid account$/)
        expect(queryEval).not.toHaveBeenCalled()
    })
})

describe("curation record", () => {
    const read = (row: unknown) => { answer(row); return getCurationRecord("C1") }
    const typedAppeal = { ...resolvedAppeal, filedAt: 1780000000n, resolvedAt: 1780000100n }

    it("reads a collection nobody decided anything about", async () => {
        await expect(read(bare)).resolves.toEqual(bare)
        expect(queryEval).toHaveBeenCalledWith(GNO_RPC_URL, NFT_CURATION_PATH, 'CollectionJSON("C1")', true)
    })

    it("reads a verified, featured collection with its records and appeals", async () => {
        const row = {
            ...bare, verified: true, featured: true, verification, feature, hold: { ...hold, confirmer: addr(2), extended: true },
            appeals: { ...noAppeals, hold: resolvedAppeal, feature: { ...openAppeal, subject: "feature" } },
        }
        await expect(read(row)).resolves.toEqual({
            ...row,
            verification: { ...verification, updatedAt: 1780000000n },
            feature: { ...feature, until: 1790000000n },
            hold: { ...hold, confirmer: addr(2), extended: true, until: 1790000000n },
            appeals: { ...noAppeals, hold: typedAppeal, feature: { ...openAppeal, subject: "feature", filedAt: 1780000000n, resolvedAt: 0n } },
        })
    })

    it.each([
        ["a hidden collection", { ...bare, hidden: true, hold }],
        ["a hold that ran out", { ...bare, hold }],
        ["a slot awaiting its approval", { ...bare, feature: { ...feature, approver: "" } }],
        ["an approved slot that features nothing right now", { ...bare, feature }],
        ["a hidden collection with an approved slot", { ...bare, hidden: true, hold, feature }],
        ["a withdrawn verification", { ...bare, verification: { ...verification, verified: false } }],
        ["a rejected appeal", { ...bare, appeals: { ...noAppeals, hold: { ...resolvedAppeal, upheld: false } } }],
        ["an appeal resolved in the block it was filed", { ...bare, appeals: { ...noAppeals, hold: { ...resolvedAppeal, resolvedAt: "1780000000" } } }],
    ])("accepts %s", async (_name, row) => {
        await expect(read(row)).resolves.toMatchObject({ collection: "C1", hidden: row.hidden, featured: false })
    })

    it.each([
        ["an unknown field", { ...bare, score: "1" }, "Invalid curation record fields"],
        ["a missing part", without(bare, "hold"), "Invalid curation record fields"],
        ["a flag that is not a boolean", { ...bare, hidden: "false" }, "Invalid hidden"],
        ["the record of another collection", { ...bare, collection: "C2" }, "Curation record does not match the request"],
        ["a null answer", null, "Invalid curation record"],
        ["a part that is not a record", { ...bare, hold: [] }, "Invalid hold"],
        ["verified without a verification record", { ...bare, verified: true }, "Inconsistent verification"],
        ["verified against a withdrawn verification", { ...bare, verified: true, verification: { ...verification, verified: false } }, "Inconsistent verification"],
        ["not verified against a standing verification", { ...bare, verification }, "Inconsistent verification"],
        ["a verification without a reason", { ...bare, verified: true, verification: { ...verification, reasonHash: "", reasonCID: "" } }, "Invalid verification reason hash"],
        ["a verification with an unknown field", { ...bare, verified: true, verification: { ...verification, by: addr(0) } }, "Invalid verification fields"],
        ["featured without a feature record", { ...bare, featured: true }, "Inconsistent feature"],
        ["featured before a second manager approved", { ...bare, featured: true, feature: { ...feature, approver: "" } }, "Inconsistent feature"],
        ["featured while hidden", { ...bare, featured: true, feature, hidden: true, hold }, "Inconsistent feature"],
        ["a slot approved by its own proposer", { ...bare, feature: { ...feature, approver: addr(1) } }, "Inconsistent feature"],
        ["a slot without a proposer", { ...bare, feature: { ...feature, proposer: "" } }, "Invalid feature proposer"],
        ["a slot with a malformed approver", { ...bare, feature: { ...feature, approver: "g1approver" } }, "Invalid feature approver"],
        ["a slot with a malformed reason CID", { ...bare, feature: { ...feature, reasonCID: "bafy" } }, "Invalid feature reason CID"],
        ["a slot with a term that is not a decimal string", { ...bare, feature: { ...feature, until: 1790000000 } }, "Invalid feature term"],
        ["hidden without a hold record", { ...bare, hidden: true }, "Inconsistent hold"],
        ["a hold confirmed by its own actor", { ...bare, hold: { ...hold, confirmer: addr(1) } }, "Inconsistent hold"],
        ["a hold without an actor", { ...bare, hold: { ...hold, actor: "" } }, "Invalid hold actor"],
        ["a hold without a reason", { ...bare, hold: { ...hold, reasonHash: "" } }, "Invalid hold reason hash"],
        ["a hold with a missing field", { ...bare, hold: without(hold, "extended") }, "Invalid hold fields"],
        ["appeals that are not a record", { ...bare, appeals: [] }, "Invalid appeals"],
        ["appeals without one of the four subjects", { ...bare, appeals: without(noAppeals, "feature") }, "Invalid appeals fields"],
        ["appeals on a fifth subject", { ...bare, appeals: { ...noAppeals, royalty: null } }, "Invalid appeals fields"],
        ["an appeal filed under another subject", { ...bare, appeals: { ...noAppeals, feature: openAppeal } }, "Appeal does not match the request"],
        ["an appeal of another collection", { ...bare, appeals: { ...noAppeals, hold: { ...openAppeal, collection: "C2" } } }, "Appeal does not match the request"],
        ["an appeal on an unknown subject", { ...bare, appeals: { ...noAppeals, hold: { ...openAppeal, subject: "royalty" } } }, "Invalid appeal subject"],
        ["an appeal without a statement", { ...bare, appeals: { ...noAppeals, hold: { ...openAppeal, statementHash: "", statementCID: "" } } }, "Invalid appeal statement hash"],
        ["an open appeal already upheld", { ...bare, appeals: { ...noAppeals, hold: { ...openAppeal, upheld: true } } }, "Inconsistent appeal resolution"],
        ["an open appeal with a resolution time", { ...bare, appeals: { ...noAppeals, hold: { ...openAppeal, resolvedAt: "1780000100" } } }, "Inconsistent appeal resolution"],
        ["an open appeal with a reason", { ...bare, appeals: { ...noAppeals, hold: { ...openAppeal, reasonHash: HASH, reasonCID: CID_V1 } } }, "Inconsistent appeal reason"],
        ["a resolved appeal without a reason", { ...bare, appeals: { ...noAppeals, hold: { ...resolvedAppeal, reasonHash: "", reasonCID: "" } } }, "Invalid appeal reason hash"],
        ["an appeal resolved before it was filed", { ...bare, appeals: { ...noAppeals, hold: { ...resolvedAppeal, resolvedAt: "1779999999" } } }, "Inconsistent appeal resolution"],
        ["a resolved appeal without a resolution time", { ...bare, appeals: { ...noAppeals, hold: { ...resolvedAppeal, resolvedAt: "0" } } }, "Inconsistent appeal resolution"],
        ["an appeal with an unknown field", { ...bare, appeals: { ...noAppeals, hold: { ...openAppeal, founder: addr(3) } } }, "Invalid appeal fields"],
    ])("rejects %s", async (_name, row, message) => {
        await expect(read(row)).rejects.toThrow(new RegExp(`^${message}$`))
    })

    it("reports an unreadable record as retryable, and one the realm refuses as refused", async () => {
        queryEval.mockResolvedValueOnce(null)
        const unread = getCurationRecord("C1")
        await expect(unread).rejects.toThrow("Could not read curation record")
        await expect(unread).rejects.toBeInstanceOf(ReadError)
        queryEval.mockRejectedValueOnce(new AbciQueryError("vm/qeval", "unknown collection"))
        const refused = getCurationRecord("C9")
        await expect(refused).rejects.toBeInstanceOf(RealmRefusedError)
        await expect(refused).rejects.not.toBeInstanceOf(ReadError)
    })
})

describe("open appeals", () => {
    it("reads a page of open appeals, and none as an empty list", async () => {
        answer([openAppeal, { ...openAppeal, subject: "feature" }, { ...openAppeal, collection: "C2" }])
        await expect(listOpenAppeals()).resolves.toEqual([
            { ...openAppeal, filedAt: 1780000000n, resolvedAt: 0n },
            { ...openAppeal, subject: "feature", filedAt: 1780000000n, resolvedAt: 0n },
            { ...openAppeal, collection: "C2", filedAt: 1780000000n, resolvedAt: 0n },
        ])
        expect(queryEval).toHaveBeenCalledWith(GNO_RPC_URL, NFT_CURATION_PATH, "AppealsJSON(0, 20)", true)
        answer([])
        await expect(listOpenAppeals(1, 1)).resolves.toEqual([])
    })

    it.each([
        ["an answer that is not a list", { appeals: [] }, "Invalid appeal list"],
        ["more rows than the page size", [openAppeal, { ...openAppeal, subject: "feature" }, { ...openAppeal, collection: "C2" }], "Invalid appeal list"],
        ["a resolved appeal", [resolvedAppeal], "Resolved appeal in the open list"],
        ["the same appeal twice", [openAppeal, openAppeal], "Duplicate appeal"],
        ["a null row", [null], "Invalid appeal"],
        ["an appeal with a malformed collection ID", [{ ...openAppeal, collection: "C01" }], "Invalid collection ID"],
    ])("rejects %s", async (_name, rows, message) => {
        answer(rows)
        await expect(listOpenAppeals(0, 2)).rejects.toThrow(new RegExp(`^${message}$`))
    })

    it("reports unreadable appeals as an error, never as an empty list", async () => {
        queryEval.mockResolvedValueOnce(null)
        await expect(listOpenAppeals()).rejects.toThrow("Could not read appeals")
    })
})

describe("feature slots", () => {
    it("reads a page of slots in ID text order, and none as an empty list", async () => {
        answer([slot, { ...slot, collection: "C10", featured: false }, { ...slot, collection: "C2" }])
        await expect(listFeatureSlots()).resolves.toEqual([
            { ...slot, until: 1790000000n },
            { ...slot, collection: "C10", featured: false, until: 1790000000n },
            { ...slot, collection: "C2", until: 1790000000n },
        ])
        expect(queryEval).toHaveBeenCalledWith(GNO_RPC_URL, NFT_CURATION_PATH, "FeaturesJSON(0, 20)", true)
        answer([])
        await expect(listFeatureSlots(2, 50)).resolves.toEqual([])
    })

    it.each([
        ["an answer that is not a list", slot, "Invalid feature slot list"],
        ["more rows than the page size", [slot, { ...slot, collection: "C2" }, { ...slot, collection: "C3" }], "Invalid feature slot list"],
        ["the same collection twice", [slot, slot], "Inconsistent feature slot list"],
        ["slots in number order", [{ ...slot, collection: "C2" }, { ...slot, collection: "C10" }], "Inconsistent feature slot list"],
        ["a full feature record where a slot is expected", [feature], "Invalid feature slot fields"],
        ["a featured flag that is not a boolean", [{ ...slot, featured: 1 }], "Invalid featured"],
        ["a term that is not a decimal string", [{ ...slot, until: 1790000000 }], "Invalid feature term"],
    ])("rejects %s", async (_name, rows, message) => {
        answer(rows)
        await expect(listFeatureSlots(0, 2)).rejects.toThrow(new RegExp(`^${message}$`))
    })

    it("reports unreadable slots as an error, never as an empty list", async () => {
        queryEval.mockResolvedValueOnce(null)
        await expect(listFeatureSlots()).rejects.toThrow("Could not read feature slots")
    })
})

describe("arguments", () => {
    it.each(["", "C0", "C01", "c1", "1", `C${"1".repeat(21)}`, 'C1")+("'])("never sends the malformed collection ID %j to the chain", async (id) => {
        await expect(getApplication(id)).rejects.toThrow(/^Invalid collection ID$/)
        await expect(getCurationAccess(id, WHO)).rejects.toThrow(/^Invalid collection ID$/)
        await expect(getCurationRecord(id)).rejects.toThrow(/^Invalid collection ID$/)
        expect(queryEval).not.toHaveBeenCalled()
    })

    it.each([[-1, 20], [0.5, 20], [0, 0], [0, 51], [0, 1.5], [Number.NaN, 20]])("never asks the chain for page %d of size %d", async (page, size) => {
        await expect(listApplications(page, size)).rejects.toThrow(/^Invalid application page$/)
        await expect(listOpenAppeals(page, size)).rejects.toThrow(/^Invalid appeal page$/)
        await expect(listFeatureSlots(page, size)).rejects.toThrow(/^Invalid feature slot page$/)
        expect(queryEval).not.toHaveBeenCalled()
    })
})
