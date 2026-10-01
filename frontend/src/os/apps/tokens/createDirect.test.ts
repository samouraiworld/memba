import { beforeEach, describe, expect, it, vi } from "vitest"

const reads = vi.hoisted(() => ({
    terms: vi.fn(), status: vi.fn(), reserved: vi.fn(), count: vi.fn(),
    fresh: vi.fn(), covers: vi.fn(), broadcast: vi.fn(), verify: vi.fn(),
}))
vi.mock("../../../lib/tokenLaunchpadSalesClient", async (load) => ({
    ...(await load<typeof import("../../../lib/tokenLaunchpadSalesClient")>()),
    TokenLaunchpadSalesClient: class { terms = reads.terms },
}))
vi.mock("../../../lib/tokenLaunchpadClient", async (load) => ({
    ...(await load<typeof import("../../../lib/tokenLaunchpadClient")>()),
    TokenLaunchpadClient: class { count = reads.count },
}))
vi.mock("../../../lib/tokenLaunchpadConfigClient", async (load) => ({
    ...(await load<typeof import("../../../lib/tokenLaunchpadConfigClient")>()),
    readActionStatus: reads.status, readReserved: reads.reserved,
}))
vi.mock("../../../lib/grc20", async (load) => ({
    ...(await load<typeof import("../../../lib/grc20")>()),
    freshFeeForGasWanted: reads.fresh, assertFeeStillCovers: reads.covers, doContractBroadcast: reads.broadcast,
}))
vi.mock("../../wallet/sendRequest", () => ({ verifySendTx: reads.verify }))

import { prepareAirdropManifest } from "../../../lib/tokenLaunchpadAirdropManifest"
import { TOKEN_LAUNCHPAD_SALES_ADDRESS, TOKEN_LAUNCHPAD_SALES_PATH, type LaunchTermsView } from "../../../lib/tokenLaunchpadSalesClient"
import { createDirectRequest, creatorShare, directCost, directLaunchProblem, encodeAllocations, parseAirdrop, toBaseUnits, type DirectLaunch } from "./createDirect"

const A = "g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0"
const B = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const CREATOR = "g136j0m08pkm2lwwde9dmlx8uee26llent9s5cpf"
const TERMS: LaunchTermsView = { version: 4n, currency: "ugnot", directCreationFee: 1_000_000n, fairSaleCreationFee: 2_000_000n, fairSaleRaiseCap: 1_000_000_000n, primaryFeeBps: 200n }
const launch = (patch: Partial<DirectLaunch> = {}): DirectLaunch => ({
    mode: "direct_fixed", name: "Rehearsal Token", ticker: "REHA", decimals: 6,
    initialSupply: 1_000_000_000n, maxSupply: 1_000_000_000n, description: "",
    allocations: [], airdropTotal: 0n, ...patch,
})
const open = { open: true }

beforeEach(() => {
    for (const fn of Object.values(reads)) fn.mockReset()
    reads.terms.mockResolvedValue(TERMS)
    reads.status.mockResolvedValue(open)
    reads.reserved.mockResolvedValue(false)
    reads.count.mockResolvedValue(6n)
    reads.covers.mockResolvedValue(undefined)
})

describe("direct token rules", () => {
    it("reads whole-token amounts exactly", () => {
        expect(toBaseUnits("1.5", 6)).toBe(1_500_000n)
        expect(toBaseUnits(" 1000000 ", 6)).toBe(1_000_000_000_000n)
        expect(toBaseUnits("9223372.036854775807", 12)).toBe(9_223_372_036_854_775_807n)
        expect(toBaseUnits("5", 0)).toBe(5n)
        for (const bad of ["1.0000001", "", "1e6", "-1", "1,5", "0x10", "5."]) expect(toBaseUnits(bad, 6), bad).toBeNull()
        expect(toBaseUnits("5.0", 0)).toBeNull()
    })

    it("reads airdrop lines in order and refuses a malformed line", () => {
        expect(parseAirdrop(`${A} 1.5\n\n${B},2`, 6)).toEqual([{ index: 0, beneficiary: A, amount: "1500000" }, { index: 1, beneficiary: B, amount: "2000000" }])
        expect(parseAirdrop(`${A}`, 6)).toBe("Line 1 needs an address and an amount above zero.")
        expect(parseAirdrop(`${A} 1\n${B} 0`, 6)).toBe("Line 2 needs an address and an amount above zero.")
        expect(parseAirdrop(`${A} 1 extra`, 6)).toBe("Line 1 needs an address and an amount above zero.")
        expect(parseAirdrop(`${A.toUpperCase()} 1`, 6)).toBe(`Line 1: ${A.toUpperCase()} is not an address that can receive tokens.`)
    })

    it("names the part of the wizard each broken rule belongs to", () => {
        expect(directLaunchProblem(launch())).toBeNull()
        const cases: [Partial<DirectLaunch>, string, RegExp][] = [
            [{ name: "" }, "token", /name/], [{ name: " Padded" }, "token", /name/], [{ name: "x".repeat(33) }, "token", /name/],
            [{ name: "Bad (name)" }, "token", /name/], [{ name: "No break" }, "token", /name/],
            [{ ticker: "reha" }, "token", /ticker/], [{ ticker: "TOOLONGTICK" }, "token", /ticker/], [{ ticker: "GNOT" }, "token", /reserved/],
            [{ decimals: 13 }, "token", /Decimals/], [{ initialSupply: 0n, maxSupply: 0n }, "token", /supply/],
            [{ maxSupply: 2_000_000_000n }, "token", /capped/], [{ mode: "direct_capped" }, "token", /capped/],
            [{ description: "see <script>" }, "token", /description/], [{ description: "x".repeat(281) }, "token", /description/],
            [{ allocations: [{ beneficiary: A.toUpperCase(), amount: 1n, vestingDays: 0, cliffDays: 0 }] }, "distribution", /not an address/],
            [{ allocations: [{ beneficiary: TOKEN_LAUNCHPAD_SALES_ADDRESS, amount: 1n, vestingDays: 0, cliffDays: 0 }] }, "distribution", /not an address/],
            [{ allocations: [{ beneficiary: A, amount: 1n, vestingDays: 0, cliffDays: 0 }, { beneficiary: A, amount: 1n, vestingDays: 0, cliffDays: 0 }] }, "distribution", /twice/],
            [{ allocations: [{ beneficiary: A, amount: 0n, vestingDays: 0, cliffDays: 0 }] }, "distribution", /above zero/],
            [{ allocations: [{ beneficiary: A, amount: 1n, vestingDays: 10, cliffDays: 11 }] }, "distribution", /cliff/],
            [{ allocations: [{ beneficiary: A, amount: 1_000_000_001n, vestingDays: 0, cliffDays: 0 }] }, "distribution", /exceed/],
            [{ allocations: Array.from({ length: 51 }, () => ({ beneficiary: A, amount: 1n, vestingDays: 0, cliffDays: 0 })) }, "distribution", /50/],
            [{ allocations: [{ beneficiary: A, amount: 600_000_000n, vestingDays: 0, cliffDays: 0 }], airdropTotal: 400_000_001n }, "airdrop", /together/],
        ]
        for (const [patch, part, message] of cases) {
            const problem = directLaunchProblem(launch(patch))
            expect(problem?.part, JSON.stringify(patch, (_k, v) => typeof v === "bigint" ? `${v}` : v).slice(0, 80)).toBe(part)
            expect(problem?.message).toMatch(message)
        }
        expect(directLaunchProblem(launch({ mode: "direct_capped", maxSupply: 2_000_000_000n }))).toBeNull()
    })

    it("encodes allocations sorted by address, vesting from the start in seconds", () => {
        const encoded = encodeAllocations([
            { beneficiary: B, amount: 5n, vestingDays: 0, cliffDays: 0 },
            { beneficiary: A, amount: 7n, vestingDays: 30, cliffDays: 10 },
        ], 1_700_000_000n)
        expect(encoded).toBe(`${B}:5:0:0:0:0;${A}:7:1700000000:864000:2592000:0`)
        expect(creatorShare(launch({ allocations: [{ beneficiary: A, amount: 100n, vestingDays: 0, cliffDays: 0 }], airdropTotal: 50n }))).toBe(999_999_850n)
    })
})

describe("direct token creation costs", () => {
    // Measured on a committed node at the pinned Gno (gas used, bytes stored).
    // The gas asked for is at least 1.5 times the measure, the deposit cap at least twice it.
    it("covers every measured creation", () => {
        for (const [immediate, vested, airdrop, gas, bytes] of [
            [0, 0, false, 23_405_265, 9_473], [0, 1, false, 26_488_896, 17_112],
            [50, 0, false, 165_890_130, 113_931], [0, 50, false, 126_186_573, 155_974],
            [0, 1, false, 50_300_000, 20_806], // one vesting record, 3,000 entries in every tree
            [0, 0, true, 40_100_000, 24_634],
        ] as const) {
            const cost = directCost(immediate, vested, airdrop)
            expect(cost.gasWanted, `${immediate}/${vested}/${airdrop}`).toBeGreaterThanOrEqual(gas * 1.5)
            expect(cost.bytes, `${immediate}/${vested}/${airdrop}`).toBeGreaterThanOrEqual(bytes)
            expect(cost.gasWanted).toBeLessThanOrEqual(500_000_000)
        }
    })
})

describe("direct token creation request", () => {
    const base = { network: "mainnet", creator: CREATOR, terms: TERMS, start: 1_700_000_000n, gasPrice: { gas: 1000, ugnot: 1 }, onSettled: vi.fn() }

    it("sends exactly the creation fee to CreateDirect, naming the terms' version", () => {
        const request = createDirectRequest({ ...base, launch: launch({ allocations: [{ beneficiary: A, amount: 10n, vestingDays: 30, cliffDays: 0 }] }), airdrop: null })
        const { msgs } = request.prepare(undefined)
        expect(msgs).toEqual([{
            type: "vm/MsgCall",
            value: {
                caller: CREATOR, send: "1000000ugnot", pkg_path: TOKEN_LAUNCHPAD_SALES_PATH, func: "CreateDirect", max_deposit: "4820000ugnot",
                args: ["direct_fixed", "Rehearsal Token", "REHA", "6", "1000000000", "1000000000", "ugnot", "4", "", "", "", "", "", `${A}:10:1700000000:0:2592000:0`],
            },
        }])
        expect(new Map(request.lines(undefined)).get("Creation fee")).toBe("1 GNOT")
        expect(new Map(request.lines(undefined)).get("To you")).toBe("999.99999 REHA")
    })

    it("adds the expected token ID, root and total with an airdrop, and refuses a mismatched manifest", () => {
        const manifest = prepareAirdropManifest("T7", [{ index: 0, beneficiary: A, amount: "100" }, { index: 1, beneficiary: B, amount: "50" }])
        const request = createDirectRequest({ ...base, launch: launch({ airdropTotal: 150n }), airdrop: manifest })
        const value = request.prepare(undefined).msgs[0].value as { func: string; args: string[] }
        expect(value.func).toBe("CreateDirectWithAirdrop")
        expect(value.args.slice(-3)).toEqual(["T7", manifest.root, "150"])
        expect(() => createDirectRequest({ ...base, launch: launch({ airdropTotal: 151n }), airdrop: manifest })).toThrow("does not match")
        expect(() => createDirectRequest({ ...base, launch: launch(), airdrop: manifest })).toThrow("does not match")
    })

    it("sends no coins when creation is free, and refuses a currency without terms", () => {
        const free = createDirectRequest({ ...base, terms: { ...TERMS, directCreationFee: 0n }, launch: launch(), airdrop: null })
        expect((free.prepare(undefined).msgs[0].value as { send: string }).send).toBe("")
        expect(free.note).toMatch(/no coins attached/)
        expect(new Map(free.lines(undefined)).get("Creation fee")).toBe("Free")
        expect(() => createDirectRequest({ ...base, terms: { ...TERMS, directCreationFee: null }, launch: launch(), airdrop: null })).toThrow("no terms")
    })

    it("rechecks the terms, the lanes, the ticker and the next token ID before Adena opens", async () => {
        const manifest = prepareAirdropManifest("T7", [{ index: 0, beneficiary: A, amount: "100" }])
        const request = createDirectRequest({ ...base, launch: launch({ airdropTotal: 100n }), airdrop: manifest })
        await request.recheck!(undefined)
        expect(reads.status.mock.calls.map(call => call[1])).toEqual(["direct", "airdrop"])
        expect(reads.covers).toHaveBeenCalled()

        reads.terms.mockResolvedValueOnce({ ...TERMS, version: 5n })
        await expect(request.recheck!(undefined)).rejects.toThrow("terms changed")
        reads.terms.mockResolvedValueOnce({ ...TERMS, directCreationFee: 2n })
        await expect(request.recheck!(undefined)).rejects.toThrow("terms changed")
        reads.status.mockResolvedValueOnce(open).mockResolvedValueOnce({ open: false })
        await expect(request.recheck!(undefined)).rejects.toThrow("not taking new tokens")
        reads.reserved.mockResolvedValueOnce(true)
        await expect(request.recheck!(undefined)).rejects.toThrow("reserved")
        reads.count.mockResolvedValueOnce(7n)
        await expect(request.recheck!(undefined)).rejects.toThrow("Another token was created first")
    })

    it("broadcasts the reviewed message and verifies by the transaction's result", async () => {
        const request = createDirectRequest({ ...base, launch: launch(), airdrop: null })
        reads.broadcast.mockResolvedValue({ hash: "ABC" })
        const beforeSign = vi.fn()
        await request.send(undefined, beforeSign)
        expect(reads.broadcast).toHaveBeenCalledWith(request.prepare(undefined).msgs, "Create REHA", expect.objectContaining({ gasWanted: 75_000_000, beforeSign }))
        reads.verify.mockResolvedValue("failed")
        expect(await request.verify!(undefined, "ABC", undefined)).toBe("failed")
    })
})
