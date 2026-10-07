import { describe, expect, it, vi } from "vitest"
import { decodeFunctionData, type Address, type Hex } from "viem"
import { evmContract } from "./manifest"
import {
    BASENAME_YEAR_SECONDS,
    basenameFor,
    controllerAbi,
    planBasenameRegistration,
    planBasenameTextUpdate,
    planPrimaryName,
    prepareBasenameWrite,
    quoteBasename,
    resolverWriteAbi,
    reverseRegistrarAbi,
    type BasenameQuote,
    type BasenameWrite,
} from "./basenamesWrite"

// The flows of contracts/evm/test/fork/Basenames.t.sol (register with records and primary name; payer = owner;
// ENSIP-19 setName; owner multicall). namehash vectors from `cast namehash`.
const ALICE: Address = "0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7"
const BOB: Address = "0x0376AAc07Ad725E01357B1725B5ceC61aE10473c"
const NODE_BASE: Hex = "0x31d3ba42bb78a4c4cbdd8de5265a53707fb126f2907170d78d0fac613e285005"
const NODE_SEPOLIA: Hex = "0x1fd57f2d33b02ae64487284abe8afd77360d1cdd537f0c80c1a17a2875ebe79c"
const PRICE = 99_908_791_632_000n // 1-year price of a 16-character name on Base (PHASE0)
const QUOTE: BasenameQuote = { chainId: 8453, label: "membaprofilewrite", years: 1, available: true, price: PRICE, ensip19Primary: "" }

const registerRequest = (data: Hex) => (decodeFunctionData({ abi: controllerAbi, data }).args as unknown as [Record<string, unknown>])[0]

describe("Basename registration", () => {
    it("registers for the sending account in one payable call, with records, on the quoted chain", () => {
        const plan = planBasenameRegistration({
            account: ALICE, quote: QUOTE, texts: { description: "Memba builder", "memba.profile.v1": '{"version":1}', url: "" },
        })
        expect(plan.name).toBe("membaprofilewrite.base.eth")
        expect(plan.node).toBe(NODE_BASE)
        expect(plan.register).toMatchObject({ chainId: 8453, from: ALICE, to: evmContract(8453, "basenamesRegistrarController"), value: (PRICE * 105n) / 100n })
        expect(registerRequest(plan.register.data)).toMatchObject({
            name: "membaprofilewrite", owner: ALICE, duration: BASENAME_YEAR_SECONDS,
            resolver: evmContract(8453, "basenamesL2Resolver"), reverseRecord: true, coinTypes: [], signatureExpiry: 0n, signature: "0x",
        })
        const calls = (registerRequest(plan.register.data).data as Hex[]).map((d) => decodeFunctionData({ abi: resolverWriteAbi, data: d }))
        expect(calls.map((c) => [c.functionName, ...(c.args as unknown[])])).toEqual([
            ["setAddr", NODE_BASE, ALICE],
            ["setText", NODE_BASE, "description", "Memba builder"],
            ["setText", NODE_BASE, "memba.profile.v1", '{"version":1}'],
        ]) // an empty value is skipped at registration
        expect(plan.primaryName).toBeNull()
    })

    it("adds the ENSIP-19 setName step only when the account has another ENSIP-19 primary name", () => {
        expect(planBasenameRegistration({ account: ALICE, quote: { ...QUOTE, ensip19Primary: "membaprofilewrite.base.eth" } }).primaryName).toBeNull()
        const step = planBasenameRegistration({ account: ALICE, quote: { ...QUOTE, ensip19Primary: "old.base.eth" } }).primaryName
        expect(step).toMatchObject({ chainId: 8453, from: ALICE, to: evmContract(8453, "basenamesL2ReverseRegistrar"), value: 0n })
        expect(decodeFunctionData({ abi: reverseRegistrarAbi, data: step!.data })).toMatchObject({ functionName: "setName", args: ["membaprofilewrite.base.eth"] })
        expect(planPrimaryName(84532, ALICE, "membaprofilewrite.basetest.eth").to).toBe(evmContract(84532, "basenamesL2ReverseRegistrar"))
        expect(() => planPrimaryName(8453, ALICE, "membaprofilewrite.basetest.eth")).toThrow(/Not a Basename/)
    })

    it("keeps the current primary name when asked: no reverse record and no setName step", () => {
        const plan = planBasenameRegistration({ account: ALICE, quote: { ...QUOTE, ensip19Primary: "old.base.eth" }, makePrimary: false })
        expect(registerRequest(plan.register.data).reverseRecord).toBe(false)
        expect(plan.primaryName).toBeNull()
    })

    it("skips undefined records and refuses non-text values", () => {
        const plan = planBasenameRegistration({ account: ALICE, quote: QUOTE, texts: { url: undefined, location: "Base" } })
        expect((registerRequest(plan.register.data).data as Hex[]).length).toBe(2) // setAddr + location
        expect(() => planBasenameRegistration({ account: ALICE, quote: QUOTE, texts: { url: 5 as never } })).toThrow(/must be text/)
    })

    it("uses the Base Sepolia controller, resolver and parent for a Base Sepolia quote", () => {
        const plan = planBasenameRegistration({ account: ALICE, quote: { ...QUOTE, chainId: 84532, years: 2 } })
        expect(plan.node).toBe(NODE_SEPOLIA)
        expect(plan.register).toMatchObject({ chainId: 84532, to: evmContract(84532, "basenamesRegistrarController") })
        expect(registerRequest(plan.register.data)).toMatchObject({ resolver: evmContract(84532, "basenamesL2Resolver"), duration: 2n * BASENAME_YEAR_SECONDS })
    })

    it("refuses taken names, short or look-alike labels, durations, missing quotes and unknown records", () => {
        expect(basenameFor(8453, "jesse")).toBe("jesse.base.eth")
        for (const label of ["Jesse", "a.b", "", "je​sse"]) expect(() => basenameFor(8453, label), label).toThrow(/one word/)
        expect(() => basenameFor(8453, "ab")).toThrow(/at least 3/)
        expect(() => planBasenameRegistration({ account: ALICE, quote: { ...QUOTE, available: false } })).toThrow(/taken/)
        expect(() => planBasenameRegistration({ account: ALICE, quote: { ...QUOTE, years: 0 } })).toThrow(/1 to 10/)
        expect(() => planBasenameRegistration({ account: ALICE, quote: { ...QUOTE, years: 11 } })).toThrow(/1 to 10/)
        expect(() => planBasenameRegistration({ account: ALICE, quote: { ...QUOTE, label: "ab" } })).toThrow(/at least 3/)
        expect(() => planBasenameRegistration({ account: ALICE, quote: { ...QUOTE, price: 0n } })).toThrow(/Quote/)
        expect(() => planBasenameRegistration({ account: ALICE, quote: QUOTE, texts: { email: "x" } as never })).toThrow(/does not write/)
        expect(() => planBasenameRegistration({ account: ALICE, quote: QUOTE, texts: { description: "x".repeat(4097) } })).toThrow(/too large/)
    })

    it("refuses to quote a bad label or duration before reading anything", async () => {
        for (const [label, years] of [["ab", 1], ["Jesse", 1], ["membaprofilewrite", 0], ["membaprofilewrite", 11], ["membaprofilewrite", 1.5]] as const) {
            const readContract = vi.fn()
            await expect(quoteBasename({ readContract } as never, 8453, label, years, ALICE), `${label} ${years}`).rejects.toThrow()
            expect(readContract).not.toHaveBeenCalled()
        }
    })

    it("quotes availability, price and the account's ENSIP-19 primary name from manifest contracts", async () => {
        const readContract = vi.fn().mockImplementation(async ({ functionName }: { functionName: string }) =>
            functionName === "available" ? true : functionName === "registerPrice" ? PRICE : "old.base.eth")
        await expect(quoteBasename({ readContract } as never, 8453, "membaprofilewrite", 1, ALICE)).resolves.toEqual({ ...QUOTE, ensip19Primary: "old.base.eth" })
        expect(readContract).toHaveBeenCalledWith(expect.objectContaining({
            address: evmContract(8453, "basenamesRegistrarController"), functionName: "registerPrice", args: ["membaprofilewrite", BASENAME_YEAR_SECONDS],
        }))
        expect(readContract).toHaveBeenCalledWith(expect.objectContaining({
            address: evmContract(8453, "basenamesL2ReverseRegistrar"), functionName: "nameForAddr", args: [ALICE],
        }))
    })
})

describe("Basename record update", () => {
    const primary = { name: "membaprofilewrite.base.eth", node: NODE_BASE, resolver: evmContract(8453, "basenamesL2ResolverLegacy") }

    it("sets (or clears with \"\") the records in one multicall on the name's own resolver, with no value", () => {
        const write = planBasenameTextUpdate(8453, ALICE, primary, { url: "https://memba.club", location: "" })
        expect(write).toMatchObject({ chainId: 8453, from: ALICE, to: primary.resolver, value: 0n })
        const outer = decodeFunctionData({ abi: resolverWriteAbi, data: write.data })
        expect(outer.functionName).toBe("multicall")
        const inner = (outer.args as unknown as [Hex[]])[0].map((d) => decodeFunctionData({ abi: resolverWriteAbi, data: d }).args)
        expect(inner).toEqual([[NODE_BASE, "url", "https://memba.club"], [NODE_BASE, "location", ""]])
    })

    it("refuses a node that is not the name's", () => {
        expect(() => planBasenameTextUpdate(8453, ALICE, { ...primary, name: "other.base.eth" }, { url: "x" })).toThrow(/do not match/)
    })

    it("refuses an unknown resolver and an empty change set", () => {
        expect(() => planBasenameTextUpdate(8453, ALICE, { ...primary, resolver: "0x000000000000000000000000000000000000dEaD" }, { url: "x" })).toThrow(/resolver/)
        expect(() => planBasenameTextUpdate(8453, ALICE, primary, {})).toThrow(/Nothing changed/)
    })
})

describe("prepareBasenameWrite", () => {
    const write: BasenameWrite = planBasenameRegistration({ account: ALICE, quote: QUOTE }).register
    const client = (over: Partial<Record<"getChainId" | "getCode" | "estimateGas", ReturnType<typeof vi.fn>>> = {}) => ({
        getChainId: vi.fn().mockResolvedValue(8453),
        getCode: vi.fn().mockResolvedValue("0x6080"),
        estimateGas: vi.fn().mockResolvedValue(378_488n),
        ...over,
    })

    it("adds a gas limit from a successful estimate, value included", async () => {
        const c = client()
        await expect(prepareBasenameWrite(c as never, write, ALICE)).resolves.toMatchObject({ gas: 454_185n, value: write.value })
        expect(c.estimateGas).toHaveBeenCalledWith({ account: ALICE, to: write.to, data: write.data, value: write.value })
    })

    it("refuses another chain: the other chain's controller has no code, and a call there would keep the ETH", async () => {
        const c = client({ getChainId: vi.fn().mockResolvedValue(84532) })
        await expect(prepareBasenameWrite(c as never, write, ALICE)).rejects.toThrow(/for chain 8453, not chain 84532/)
        expect(c.estimateGas).not.toHaveBeenCalled()
    })

    it("refuses a target without code", async () => {
        for (const code of [undefined, "0x"]) {
            const c = client({ getCode: vi.fn().mockResolvedValue(code) })
            await expect(prepareBasenameWrite(c as never, write, ALICE)).rejects.toThrow(/not deployed/)
            expect(c.estimateGas).not.toHaveBeenCalled()
        }
    })

    it("refuses a sender other than the planned account (the payer gets the refund and the reverse record)", async () => {
        await expect(prepareBasenameWrite(client() as never, write, BOB)).rejects.toThrow(/another account/)
    })

    it("never returns a transaction when the estimate reverts", async () => {
        await expect(prepareBasenameWrite(client({ estimateGas: vi.fn().mockRejectedValue(new Error("reverted")) }) as never, write, ALICE)).rejects.toThrow(/reverted/)
    })
})
