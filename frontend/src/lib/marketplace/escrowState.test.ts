import { beforeEach, describe, expect, it, vi } from "vitest"

const rpc = vi.hoisted(() => ({
    queryEval: vi.fn<(url: string, path: string, expr: string, strict?: boolean) => Promise<string | null>>(async () => null),
}))
vi.mock("../dao/shared", async (importOriginal) => ({ ...(await importOriginal<typeof import("../dao/shared")>()), ...rpc }))

import {
    archiveAvailability,
    archiveRefundEstimateUgnot,
    exitsClosedReason,
    expireAvailability,
    findCreatedContract,
    formatApproxGnot,
    formatBlocksEta,
    hireAvailability,
    parseClientContractsJSON,
    parseContractJSON,
    parsePauseStateJSON,
    parseQevalInt,
    readClientActiveCount,
    readClientContracts,
    readCreatedCount,
    readEscrowContract,
    readEscrowPauseState,
    EscrowViewError,
    type EscrowContractView,
    type EscrowPauseState,
} from "./escrowState"

const CLIENT = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"
const FREELANCER = "g1u7y667z64x2h7vc6fmpcprgey4ck233jaww9zq"
const ESCROW = "gno.land/r/samcrew/escrow_v4"

const OPEN: EscrowPauseState = { paused: false, exitsOpen: true, exitsReopenAt: 0, pausedBlocks: 0 }
const BLOCKING: EscrowPauseState = { paused: true, exitsOpen: false, exitsReopenAt: 1_183_273, pausedBlocks: 50_000 }
const LAPSED: EscrowPauseState = { paused: true, exitsOpen: true, exitsReopenAt: 1_183_273, pausedBlocks: 183_273 }

/** Wrap a JSON string the way vm/qeval returns a Gno string: `("<go-quoted>" string)`. */
const qeval = (json: string) => `(${JSON.stringify(json)} string)`

/**
 * Go's strconv.Quote for the text in these fixtures: it escapes `"` and `\`, and
 * writes runes it cannot print as `\UXXXXXXXX` (checked against Go 1.24 for
 * U+1FAE9, Unicode 16, and the private-use U+F0000).
 */
const goQuote = (s: string) => {
    let out = '"'
    for (const c of s) {
        const cp = c.codePointAt(0) as number
        if (c === '"' || c === "\\") out += "\\" + c
        else if (cp === 0x1fae9 || cp === 0xf0000) out += "\\U" + cp.toString(16).padStart(8, "0")
        else out += c
    }
    return out + '"'
}
const qevalGo = (json: string) => `(${goQuote(json)} string)`

/*
 * Fixtures copied from the realm's own tests (escrow_views_test.gno), with the
 * heights they compute filled in: created at h = 100, funded at f = 103,
 * disputed at d = 104; AutoRefundBlks = 864000, AutoResolveBlks = 806400,
 * UnfundedExpiryBlks = 864000.
 */
const PENDING = `{"exists":true,"id":"7","client":"${CLIENT}","freelancer":"${FREELANCER}","title":"Say \\"hi\\"","description":"Line","status":"active","createdAtHeight":"100",` +
    `"fundedAtHeight":null,"refundAt":null,"expireAt":"864100","resolveAt":null,"milestones":[` +
    `{"index":"0","title":"A","amountUgnot":"1000","status":"pending","fundedAtHeight":null,"completedAtHeight":null,"disputedAtHeight":null,"refundAt":null,"resolveAt":null},` +
    `{"index":"1","title":"B","amountUgnot":"2000","status":"pending","fundedAtHeight":null,"completedAtHeight":null,"disputedAtHeight":null,"refundAt":null,"resolveAt":null}` +
    `],"totals":{"amountUgnot":"3000","escrowedUgnot":"0","releasedUgnot":"0","refundedUgnot":"0"}}`

const DISPUTED = `{"exists":true,"id":"7","client":"${CLIENT}","freelancer":"${FREELANCER}","title":"Say \\"hi\\"","description":"Line","status":"disputed","createdAtHeight":"100",` +
    `"fundedAtHeight":"103","refundAt":"864103","expireAt":null,"resolveAt":"806504","milestones":[` +
    `{"index":"0","title":"A","amountUgnot":"1000","status":"funded","fundedAtHeight":"103","completedAtHeight":null,"disputedAtHeight":null,"refundAt":"864103","resolveAt":null},` +
    `{"index":"1","title":"B","amountUgnot":"2000","status":"disputed","fundedAtHeight":"104","completedAtHeight":null,"disputedAtHeight":"104","refundAt":null,"resolveAt":"806504"}` +
    `],"totals":{"amountUgnot":"3000","escrowedUgnot":"3000","releasedUgnot":"0","refundedUgnot":"0"}}`

const CANCELLED = DISPUTED
    .replace(`"status":"disputed","createdAtHeight"`, `"status":"cancelled","createdAtHeight"`)
    .replace(`"refundAt":"864103","expireAt":null,"resolveAt":"806504"`, `"refundAt":null,"expireAt":null,"resolveAt":null`)
    .replace(`"status":"funded","fundedAtHeight":"103","completedAtHeight":null,"disputedAtHeight":null,"refundAt":"864103"`, `"status":"refunded","fundedAtHeight":"103","completedAtHeight":null,"disputedAtHeight":null,"refundAt":null`)
    .replace(`"status":"disputed","fundedAtHeight":"104","completedAtHeight":null,"disputedAtHeight":"104","refundAt":null,"resolveAt":"806504"`, `"status":"refunded","fundedAtHeight":"104","completedAtHeight":null,"disputedAtHeight":"104","refundAt":null,"resolveAt":null`)
    .replace(`"escrowedUgnot":"3000","releasedUgnot":"0","refundedUgnot":"0"`, `"escrowedUgnot":"0","releasedUgnot":"0","refundedUgnot":"3000"`)

const PAUSE_OFF = `{"paused":false,"pausedAt":null,"exitsReopenAt":null,"exitsOpen":true,"cooldownUntil":"0","pausedBlocks":"0"}`
const PAUSE_ON = `{"paused":true,"pausedAt":"1000000","exitsReopenAt":"1183273","exitsOpen":false,"cooldownUntil":"0","pausedBlocks":"50000"}`

const contract = (over: Partial<EscrowContractView> = {}): EscrowContractView => ({
    id: "7",
    title: "Logo",
    description: "",
    client: CLIENT,
    freelancer: FREELANCER,
    status: "active",
    createdAt: 1_000,
    fundedAt: null,
    refundAt: null,
    expireAt: 865_000,
    resolveAt: null,
    milestones: [{ index: 0, title: "A", amountUgnot: 1000, status: "pending", fundedAt: null, completedAt: null, disputedAt: null, refundAt: null, resolveAt: null }],
    totals: { amountUgnot: 1000, escrowedUgnot: 0, releasedUgnot: 0, refundedUgnot: 0 },
    ...over,
})

const settledMilestone = { index: 0, title: "A", amountUgnot: 1000, status: "released" as const, fundedAt: 2_000, completedAt: 2_100, disputedAt: null, refundAt: null, resolveAt: null }

beforeEach(() => {
    rpc.queryEval.mockReset()
})

describe("GetContractJSON parsing", () => {
    it("parses the realm's pending-contract JSON exactly", () => {
        expect(parseContractJSON("7", JSON.parse(PENDING))).toEqual({
            id: "7",
            client: CLIENT,
            freelancer: FREELANCER,
            title: 'Say "hi"',
            description: "Line",
            status: "active",
            createdAt: 100,
            fundedAt: null,
            refundAt: null,
            expireAt: 864_100,
            resolveAt: null,
            milestones: [
                { index: 0, title: "A", amountUgnot: 1000, status: "pending", fundedAt: null, completedAt: null, disputedAt: null, refundAt: null, resolveAt: null },
                { index: 1, title: "B", amountUgnot: 2000, status: "pending", fundedAt: null, completedAt: null, disputedAt: null, refundAt: null, resolveAt: null },
            ],
            totals: { amountUgnot: 3000, escrowedUgnot: 0, releasedUgnot: 0, refundedUgnot: 0 },
        })
    })

    it("parses deadlines of a funded and disputed contract", () => {
        const c = parseContractJSON("7", JSON.parse(DISPUTED))!
        expect(c).toMatchObject({ status: "disputed", fundedAt: 103, refundAt: 864_103, expireAt: null, resolveAt: 806_504 })
        expect(c.milestones[1]).toMatchObject({ status: "disputed", disputedAt: 104, resolveAt: 806_504, refundAt: null })
        expect(parseContractJSON("7", JSON.parse(CANCELLED))).toMatchObject({ status: "cancelled", refundAt: null, totals: { refundedUgnot: 3000 } })
    })

    it("reads an archived or unknown id as null, only for the id asked", () => {
        expect(parseContractJSON("7", { exists: false, id: "7" })).toBeNull()
        expect(() => parseContractJSON("7", { exists: false, id: "8" })).toThrow(EscrowViewError)
        expect(() => parseContractJSON("7", { exists: false, id: "7", title: "x" })).toThrow(EscrowViewError)
    })

    const mutate = (fn: (o: Record<string, unknown>) => void) => {
        const o = JSON.parse(PENDING) as Record<string, unknown>
        fn(o)
        return o
    }

    it.each([
        ["an integer as a JSON number", (o: Record<string, unknown>) => { o.createdAtHeight = 100 }],
        ["a leading zero", (o: Record<string, unknown>) => { o.createdAtHeight = "0100" }],
        ["a zero height", (o: Record<string, unknown>) => { o.expireAt = "0" }],
        ["a negative amount", (o: Record<string, unknown>) => { (o.totals as Record<string, unknown>).amountUgnot = "-1" }],
        ["an amount beyond 2^53", (o: Record<string, unknown>) => { (o.totals as Record<string, unknown>).amountUgnot = "9223372036854775807" }],
        ["an extra field", (o: Record<string, unknown>) => { o.extra = null }],
        ["a missing field", (o: Record<string, unknown>) => { delete o.resolveAt }],
        ["an unknown status", (o: Record<string, unknown>) => { o.status = "done" }],
        ["a bad address", (o: Record<string, unknown>) => { o.client = "g1bad" }],
        ["another id", (o: Record<string, unknown>) => { o.id = "8" }],
        ["exists missing", (o: Record<string, unknown>) => { o.exists = "true" }],
        ["no milestones", (o: Record<string, unknown>) => { o.milestones = [] }],
        ["21 milestones", (o: Record<string, unknown>) => { o.milestones = Array.from({ length: 21 }, (_, i) => ({ ...(o.milestones as Record<string, unknown>[])[0], index: String(i) })) }],
        ["a milestone index out of order", (o: Record<string, unknown>) => { (o.milestones as Record<string, unknown>[])[1].index = "0" }],
        ["a milestone status unknown", (o: Record<string, unknown>) => { (o.milestones as Record<string, unknown>[])[0].status = "paid" }],
        ["a title that is not a string", (o: Record<string, unknown>) => { o.title = null }],
    ])("fails closed on %s", (_name, fn) => {
        expect(() => parseContractJSON("7", mutate(fn))).toThrow(EscrowViewError)
    })

    it("fails closed on answers that are not objects", () => {
        for (const v of [null, [], "x", 1, true]) expect(() => parseContractJSON("7", v)).toThrow(EscrowViewError)
    })
})

describe("GetClientContractsJSON parsing", () => {
    const item = (id: string, status = "active", h = "100") => `{"id":"${id}","status":"${status}","createdAtHeight":"${h}"}`

    it("parses a page newest first with its cursor, as the realm writes it", () => {
        const page = JSON.parse(`{"items":[${item("12")},${item("9", "cancelled")},${item("4", "completed")}],"next":"4"}`)
        expect(parseClientContractsJSON(page, 3)).toEqual({
            items: [
                { id: "12", status: "active", createdAt: 100 },
                { id: "9", status: "cancelled", createdAt: 100 },
                { id: "4", status: "completed", createdAt: 100 },
            ],
            next: "4",
        })
        expect(parseClientContractsJSON(JSON.parse(`{"items":[],"next":null}`), 20)).toEqual({ items: [], next: null })
        expect(parseClientContractsJSON(JSON.parse(`{"items":[${item("3")}],"next":null}`), 20, "4")).toEqual({ items: [{ id: "3", status: "active", createdAt: 100 }], next: null })
    })

    it.each([
        ["more items than asked", `{"items":[${item("2")},${item("1")}],"next":null}`, 1, ""],
        ["ids not newest first", `{"items":[${item("1")},${item("2")}],"next":null}`, 20, ""],
        ["a repeated id", `{"items":[${item("2")},${item("2")}],"next":null}`, 20, ""],
        ["an id at or after the cursor", `{"items":[${item("4")}],"next":null}`, 20, "4"],
        ["a cursor that is not the last id", `{"items":[${item("5")},${item("4")}],"next":"5"}`, 2, ""],
        ["a cursor on an empty page", `{"items":[],"next":"4"}`, 20, ""],
        ["a numeric cursor", `{"items":[${item("4")}],"next":4}`, 1, ""],
        ["a malformed id", `{"items":[${item("04")}],"next":null}`, 20, ""],
        ["an extra field", `{"items":[],"next":null,"total":"0"}`, 20, ""],
        ["an item without a height", `{"items":[{"id":"4","status":"active","createdAtHeight":null}],"next":null}`, 20, ""],
    ])("fails closed on %s", (_name, json, limit, before) => {
        expect(() => parseClientContractsJSON(JSON.parse(json), limit, before)).toThrow(EscrowViewError)
    })
})

describe("GetPauseStateJSON parsing", () => {
    it("parses the unpaused and paused shapes", () => {
        expect(parsePauseStateJSON(JSON.parse(PAUSE_OFF))).toEqual(OPEN)
        expect(parsePauseStateJSON(JSON.parse(PAUSE_ON))).toEqual(BLOCKING)
    })

    it.each([
        ["paused without heights", PAUSE_ON.replace(`"pausedAt":"1000000"`, `"pausedAt":null`)],
        ["a reopen height that is not pausedAt + MaxPauseBlks", PAUSE_ON.replace("1183273", "1183274")],
        ["unpaused with a height", PAUSE_OFF.replace(`"pausedAt":null`, `"pausedAt":"5"`)],
        ["unpaused with exits shut", PAUSE_OFF.replace(`"exitsOpen":true`, `"exitsOpen":false`)],
        ["a string boolean", PAUSE_OFF.replace(`"paused":false`, `"paused":"false"`)],
        ["a missing field", PAUSE_OFF.replace(`,"pausedBlocks":"0"`, "")],
    ])("fails closed on %s", (_name, json) => {
        expect(() => parsePauseStateJSON(JSON.parse(json))).toThrow(EscrowViewError)
    })
})

describe("text the node prints with Go-only escapes", () => {
    const face = String.fromCodePoint(0x1fae9) // Unicode 16: newer than the node's tables
    const privateUse = String.fromCodePoint(0xf0000)

    it("is quoted with \\U escapes that JSON.parse alone rejects", () => {
        const raw = qevalGo(`{"t":"${face}"}`)
        expect(raw).toContain("\\U0001fae9")
        expect(() => JSON.parse(raw.slice(1, -8))).toThrow()
    })

    it("reads a contract whose title and description hold U+1FAE9 and U+F0000, end to end", async () => {
        const json = PENDING
            .replace(`"title":"Say \\"hi\\""`, `"title":"Face ${face} and ${privateUse}"`)
            .replace(`"description":"Line"`, `"description":"Private ${privateUse} use ${face}"`)
        rpc.queryEval.mockResolvedValue(qevalGo(json))
        const c = await readEscrowContract(ESCROW, "7")
        expect(c?.title).toBe(`Face ${face} and ${privateUse}`)
        expect(c?.description).toBe(`Private ${privateUse} use ${face}`)
        expect(archiveRefundEstimateUgnot({ ...c!, status: "completed" })).toBeGreaterThan(0)
    })

    it("still reads the plain fixtures through the Go decoder", async () => {
        rpc.queryEval.mockResolvedValue(qevalGo(PENDING))
        await expect(readEscrowContract(ESCROW, "7")).resolves.toMatchObject({ title: 'Say "hi"' })
    })
})

describe("reads", () => {
    it("reads GetPauseStateJSON with one strict query", async () => {
        rpc.queryEval.mockResolvedValue(qeval(PAUSE_ON))
        await expect(readEscrowPauseState(ESCROW)).resolves.toEqual(BLOCKING)
        expect(rpc.queryEval).toHaveBeenCalledTimes(1)
        expect(rpc.queryEval).toHaveBeenCalledWith(expect.any(String), ESCROW, "GetPauseStateJSON()", true)
    })

    it("fails closed when the pause state is unreadable or not JSON", async () => {
        rpc.queryEval.mockResolvedValue(null)
        await expect(readEscrowPauseState(ESCROW)).rejects.toThrow(/Could not read/)
        rpc.queryEval.mockResolvedValue("(true bool)")
        await expect(readEscrowPauseState(ESCROW)).rejects.toThrow(EscrowViewError)
    })

    it("reads GetContractJSON for a validated id, decoding the qeval string", async () => {
        rpc.queryEval.mockResolvedValue(qeval(PENDING))
        await expect(readEscrowContract(ESCROW, "7")).resolves.toMatchObject({ id: "7", title: 'Say "hi"', expireAt: 864_100 })
        expect(rpc.queryEval).toHaveBeenCalledWith(expect.any(String), ESCROW, `GetContractJSON("7")`, true)
        await expect(readEscrowContract(ESCROW, "07")).rejects.toThrow(/Invalid contract id/)
        await expect(readEscrowContract(ESCROW, `7") + x("`)).rejects.toThrow(/Invalid contract id/)
        expect(rpc.queryEval).toHaveBeenCalledTimes(1)
    })

    it("reads GetClientContractsJSON pages with a validated client and cursor", async () => {
        rpc.queryEval.mockResolvedValue(qeval(`{"items":[{"id":"3","status":"active","createdAtHeight":"9"}],"next":"3"}`))
        await expect(readClientContracts(ESCROW, CLIENT, "", 1)).resolves.toEqual({ items: [{ id: "3", status: "active", createdAt: 9 }], next: "3" })
        expect(rpc.queryEval).toHaveBeenLastCalledWith(expect.any(String), ESCROW, `GetClientContractsJSON("${CLIENT}", "", 1)`, true)
        rpc.queryEval.mockResolvedValue(qeval(`{"items":[],"next":null}`))
        await readClientContracts(ESCROW, CLIENT, "3")
        expect(rpc.queryEval).toHaveBeenLastCalledWith(expect.any(String), ESCROW, `GetClientContractsJSON("${CLIENT}", "3", 20)`, true)
        for (const [client, before, limit] of [['g1") + x("', "", 20], [CLIENT, "03", 20], [CLIENT, `3", "`, 20], [CLIENT, "", 0], [CLIENT, "", 51]] as const) {
            await expect(readClientContracts(ESCROW, client, before, limit), `${client} ${before} ${limit}`).rejects.toThrow(/Invalid/)
        }
        expect(rpc.queryEval).toHaveBeenCalledTimes(2)
    })

    it("reads GetClientActiveCount for a checksummed address only", async () => {
        rpc.queryEval.mockResolvedValue("(3 int)")
        await expect(readClientActiveCount(ESCROW, CLIENT)).resolves.toBe(3)
        expect(rpc.queryEval).toHaveBeenCalledWith(expect.any(String), ESCROW, `GetClientActiveCount("${CLIENT}")`, true)
        await expect(readClientActiveCount(ESCROW, 'g1") + Evil("')).rejects.toThrow(/Invalid/)
        expect(rpc.queryEval).toHaveBeenCalledTimes(1)
        expect(parseQevalInt("(1.5 int)")).toBeNull()
    })
})

describe("findCreatedContract", () => {
    const expected = { freelancer: FREELANCER, title: 'Say "hi"', description: "Line", milestones: [{ title: "A", amountUgnot: 1000 }, { title: "B", amountUgnot: 2000 }] }
    const answer = (page: string, detail: string) =>
        rpc.queryEval.mockImplementation(async (_u, _p, expr) => (expr.startsWith("GetClientContractsJSON") ? qeval(page) : expr === `GetContractJSON("7")` ? qeval(detail) : null))

    it("returns the client's newest contract id when it is the one just created", async () => {
        answer(`{"items":[{"id":"7","status":"active","createdAtHeight":"100"}],"next":"7"}`, PENDING)
        await expect(findCreatedContract(ESCROW, CLIENT, 7, expected)).resolves.toBe("7")
        expect(rpc.queryEval).toHaveBeenCalledWith(expect.any(String), ESCROW, `GetClientContractsJSON("${CLIENT}", "", 1)`, true)
    })

    it("returns null when the newest contract is a different one, or there is none yet", async () => {
        answer(`{"items":[{"id":"7","status":"active","createdAtHeight":"100"}],"next":"7"}`, PENDING)
        await expect(findCreatedContract(ESCROW, CLIENT, 7, { ...expected, title: "Other" })).resolves.toBeNull()
        await expect(findCreatedContract(ESCROW, CLIENT, 7, { ...expected, milestones: [{ title: "A", amountUgnot: 1000 }] })).resolves.toBeNull()
        answer(`{"items":[],"next":null}`, PENDING)
        await expect(findCreatedContract(ESCROW, CLIENT, 7, expected)).resolves.toBeNull()
    })

    it("never takes an older identical contract for the new one", async () => {
        // The client already had contract 7 with the same fields; the counter read before signing was 8,
        // and the node has not caught up with the new contract yet.
        answer(`{"items":[{"id":"7","status":"active","createdAtHeight":"100"}],"next":"7"}`, PENDING)
        await expect(findCreatedContract(ESCROW, CLIENT, 8, expected)).resolves.toBeNull()
        await expect(findCreatedContract(ESCROW, CLIENT, -1, expected)).resolves.toBeNull()
        await expect(findCreatedContract(ESCROW, CLIENT, Number.NaN, expected)).resolves.toBeNull()
    })

    it("reads GetCreatedCount as the next id", async () => {
        rpc.queryEval.mockResolvedValue("(8 int)")
        await expect(readCreatedCount(ESCROW)).resolves.toBe(8)
        expect(rpc.queryEval).toHaveBeenCalledWith(expect.any(String), ESCROW, "GetCreatedCount()", true)
        rpc.queryEval.mockResolvedValue(null)
        await expect(readCreatedCount(ESCROW)).rejects.toThrow(/counter/)
    })
})

describe("hire availability: per-client cap and pause", () => {
    it("allows hiring below the cap when not paused", () => {
        expect(hireAvailability(OPEN, 0, 5_000)).toEqual({ available: true })
        expect(hireAvailability(OPEN, 4, 5_000)).toEqual({ available: true })
    })

    it("refuses at 5 open contracts, with the reason", () => {
        const a = hireAvailability(OPEN, 5, 5_000)
        expect(a.available).toBe(false)
        if (!a.available) expect(a.reason).toMatch(/5 open escrow contracts.*\(5\).*completed or cancelled/)
    })

    it("refuses while paused, including after exits reopen, and gives the reopen block while they are shut", () => {
        const shut = hireAvailability(BLOCKING, 0, 1_000_000)
        expect(shut.available).toBe(false)
        if (!shut.available) expect(shut.reason).toMatch(/paused.*until it is unpaused.*reopen at block 1,183,273 \(about 7 days\)/)
        const lapsed = hireAvailability(LAPSED, 0, 1_200_000)
        expect(lapsed.available).toBe(false)
        if (!lapsed.available) expect(lapsed.reason).not.toMatch(/reopen/)
    })
})

describe("archive availability", () => {
    const settled = contract({ status: "completed", expireAt: null, milestones: [settledMilestone] })

    it("is for the client only", () => {
        expect(archiveAvailability(settled, FREELANCER, OPEN, 5_000)).toBeNull()
        expect(archiveAvailability(settled, "", OPEN, 5_000)).toBeNull()
        expect(archiveAvailability(settled, CLIENT, OPEN, 5_000)).toEqual({ available: true })
    })

    it("needs a completed or cancelled contract with nothing escrowed", () => {
        expect(archiveAvailability(contract({ status: "active" }), CLIENT, OPEN, 5_000)).toMatchObject({ available: false })
        expect(archiveAvailability(contract({ status: "disputed" }), CLIENT, OPEN, 5_000)).toMatchObject({ available: false })
        expect(archiveAvailability(contract({ status: "cancelled", expireAt: null, milestones: [{ ...settledMilestone, index: 0, title: "A", status: "refunded" }, { ...settledMilestone, index: 1, title: "B", status: "pending" }] }), CLIENT, OPEN, 5_000)).toEqual({ available: true })
        expect(archiveAvailability(contract({ status: "cancelled", expireAt: null, milestones: [{ ...settledMilestone, index: 0, title: "A", status: "funded" }] }), CLIENT, OPEN, 5_000)).toMatchObject({ available: false })
    })

    it("is refused inside a pause's blocking window, with the reopen block, and allowed once it lapses", () => {
        const a = archiveAvailability(settled, CLIENT, BLOCKING, 1_100_000)
        expect(a).toMatchObject({ available: false })
        if (a && !a.available) expect(a.reason).toMatch(/reopens at block 1,183,273 \(about 3 days\), even if nobody unpauses/)
        expect(archiveAvailability(settled, CLIENT, LAPSED, 1_200_000)).toEqual({ available: true })
    })

    it("estimates the refund from the stored text", () => {
        // The smallest measured archive: 1-byte title, one 1-byte milestone, 671,800 ugnot refunded.
        const refund = archiveRefundEstimateUgnot(contract({ title: "L", milestones: [settledMilestone] }))
        expect(refund).toBe(671_800)
        expect(formatApproxGnot(refund)).toBe("~0.67 GNOT")
    })
})

describe("expire availability", () => {
    it("applies only to an active contract none of whose milestones was funded", () => {
        expect(expireAvailability(contract({ status: "cancelled", expireAt: null }), OPEN, 900_000)).toBeNull()
        expect(expireAvailability(contract({ milestones: [{ ...settledMilestone, index: 0, title: "A", status: "pending" }, { ...settledMilestone, index: 1, title: "B", status: "refunded" }] }), OPEN, 900_000)).toBeNull()
        // The realm reports no expireAt once anything was funded.
        expect(expireAvailability(contract({ expireAt: null }), OPEN, 900_000)).toBeNull()
    })

    it("is not yet available before the realm's expireAt, and says from which block", () => {
        const a = expireAvailability(contract(), OPEN, 864_999)
        expect(a).toMatchObject({ available: false })
        if (a && !a.available) expect(a.reason).toMatch(/from block 865,000 \(about 1 minute\)/)
    })

    it("is available from expireAt", () => {
        expect(expireAvailability(contract(), OPEN, 865_000)).toEqual({ available: true })
    })

    it("is refused inside a blocking window", () => {
        expect(expireAvailability(contract(), BLOCKING, 1_100_000)).toMatchObject({ available: false })
    })

    it("follows the realm's pause-adjusted expireAt exactly, with no guesswork after a pause", () => {
        const moved = contract({ expireAt: 865_000 + 100 })
        expect(expireAvailability(moved, LAPSED, 865_099)).toMatchObject({ available: false })
        expect(expireAvailability(moved, LAPSED, 865_100)).toEqual({ available: true })
    })

    it("needs the current height", () => {
        expect(expireAvailability(contract(), OPEN, 0)).toMatchObject({ available: false })
    })
})

describe("time estimates", () => {
    it("formats blocks at about 3.3 s each", () => {
        expect(formatBlocksEta(1)).toBe("about 1 minute")
        expect(formatBlocksEta(1_000)).toBe("about 55 minutes")
        expect(formatBlocksEta(10_000)).toBe("about 9 hours")
        expect(formatBlocksEta(183_273)).toBe("about 7 days")
    })

    it("names no reopen time when exits are open", () => {
        expect(exitsClosedReason(OPEN, 10)).toBeNull()
        expect(exitsClosedReason(LAPSED, 10)).toBeNull()
    })
})
