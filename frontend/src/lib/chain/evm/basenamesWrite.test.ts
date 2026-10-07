import { describe, expect, it, vi } from "vitest"
import { decodeFunctionData, type Address, type Hex } from "viem"
import { evmContract } from "./manifest"
import {
    BASENAME_YEAR_SECONDS,
    basenameFor,
    controllerAbi,
    planBasenameRegistration,
    planBasenameTextUpdate,
    prepareBasenameWrite,
    quoteBasename,
    resolverWriteAbi,
} from "./basenamesWrite"

// The flow of contracts/evm/test/fork/Basenames.t.sol test_register_with_records_and_primary_name_in_one_tx.
const ALICE: Address = "0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7"
// namehash vectors from `cast namehash`.
const NODE_BASE: Hex = "0x31d3ba42bb78a4c4cbdd8de5265a53707fb126f2907170d78d0fac613e285005"
const NODE_SEPOLIA: Hex = "0x1fd57f2d33b02ae64487284abe8afd77360d1cdd537f0c80c1a17a2875ebe79c"
const PRICE = 99_908_791_632_000n // 1-year price of a 16-character name on Base (PHASE0)

describe("Basename registration", () => {
    it("registers through the upgradeable controller in one payable call, with records and the primary name", () => {
        const plan = planBasenameRegistration({
            chainId: 8453, label: "membaprofilewrite", owner: ALICE, years: 1, price: PRICE,
            texts: { description: "Memba builder", "memba.profile.v1": '{"version":1}', url: "" },
        })
        expect(plan.name).toBe("membaprofilewrite.base.eth")
        expect(plan.node).toBe(NODE_BASE)
        expect(plan.to).toBe(evmContract(8453, "basenamesRegistrarController"))
        expect(plan.value).toBe((PRICE * 105n) / 100n)
        const { functionName, args } = decodeFunctionData({ abi: controllerAbi, data: plan.data })
        expect(functionName).toBe("register")
        const request = (args as unknown as [Record<string, unknown>])[0]
        expect(request).toMatchObject({
            name: "membaprofilewrite", owner: ALICE, duration: BASENAME_YEAR_SECONDS,
            resolver: evmContract(8453, "basenamesL2Resolver"), reverseRecord: true, coinTypes: [], signatureExpiry: 0n, signature: "0x",
        })
        const calls = (request.data as Hex[]).map((d) => decodeFunctionData({ abi: resolverWriteAbi, data: d }))
        expect(calls.map((c) => [c.functionName, ...(c.args as unknown[])])).toEqual([
            ["setAddr", NODE_BASE, ALICE],
            ["setText", NODE_BASE, "description", "Memba builder"],
            ["setText", NODE_BASE, "memba.profile.v1", '{"version":1}'],
        ]) // the empty url is skipped
    })

    it("uses the Base Sepolia controller, resolver and parent there", () => {
        const plan = planBasenameRegistration({ chainId: 84532, label: "membaprofilewrite", owner: ALICE, years: 2, price: PRICE })
        expect(plan.node).toBe(NODE_SEPOLIA)
        expect(plan.to).toBe(evmContract(84532, "basenamesRegistrarController"))
        const request = (decodeFunctionData({ abi: controllerAbi, data: plan.data }).args as unknown as [Record<string, unknown>])[0]
        expect(request.resolver).toBe(evmContract(84532, "basenamesL2Resolver"))
        expect(request.duration).toBe(2n * BASENAME_YEAR_SECONDS)
    })

    it("refuses look-alike labels, bad owners, durations, missing quotes and unknown records", () => {
        expect(basenameFor(8453, "jesse")).toBe("jesse.base.eth")
        for (const label of ["Jesse", "a.b", "", "je​sse"]) expect(() => basenameFor(8453, label), label).toThrow(/one word/)
        const ok = { chainId: 8453, label: "membaprofilewrite", owner: ALICE, years: 1, price: PRICE }
        expect(() => planBasenameRegistration({ ...ok, owner: "0x0000000000000000000000000000000000000000" })).toThrow(/owner/)
        expect(() => planBasenameRegistration({ ...ok, years: 0 })).toThrow(/1 to 10/)
        expect(() => planBasenameRegistration({ ...ok, price: 0n })).toThrow(/Quote/)
        expect(() => planBasenameRegistration({ ...ok, texts: { email: "x" } as never })).toThrow(/does not write/)
        expect(() => planBasenameRegistration({ ...ok, texts: { description: "x".repeat(4097) } })).toThrow(/too large/)
    })

    it("quotes availability and price from the manifest controller", async () => {
        const readContract = vi.fn().mockImplementation(async ({ functionName }: { functionName: string }) => (functionName === "available" ? true : PRICE))
        await expect(quoteBasename({ readContract } as never, 8453, "membaprofilewrite", 1)).resolves.toEqual({ available: true, price: PRICE })
        expect(readContract).toHaveBeenCalledWith(expect.objectContaining({
            address: evmContract(8453, "basenamesRegistrarController"), functionName: "registerPrice", args: ["membaprofilewrite", BASENAME_YEAR_SECONDS],
        }))
    })
})

describe("Basename record update", () => {
    const primary = { name: "membaprofilewrite.base.eth", node: NODE_BASE, resolver: evmContract(8453, "basenamesL2ResolverLegacy") }

    it("sets the changed records in one multicall on the name's own resolver, with no value", () => {
        const write = planBasenameTextUpdate(8453, primary, { url: "https://memba.club", location: "Base" })
        expect(write.to).toBe(primary.resolver)
        expect(write.value).toBe(0n)
        const outer = decodeFunctionData({ abi: resolverWriteAbi, data: write.data })
        expect(outer.functionName).toBe("multicall")
        const inner = (outer.args as unknown as [Hex[]])[0].map((d) => decodeFunctionData({ abi: resolverWriteAbi, data: d }).args)
        expect(inner).toEqual([[NODE_BASE, "url", "https://memba.club"], [NODE_BASE, "location", "Base"]])
    })

    it("refuses an unknown resolver and an empty change set", () => {
        expect(() => planBasenameTextUpdate(8453, { ...primary, resolver: "0x000000000000000000000000000000000000dEaD" }, { url: "x" })).toThrow(/resolver/)
        expect(() => planBasenameTextUpdate(8453, primary, {})).toThrow(/Nothing changed/)
    })

    it("adds a gas limit from a successful estimate, value included", async () => {
        const write = planBasenameTextUpdate(8453, primary, { location: "Base" })
        const estimateGas = vi.fn().mockResolvedValue(76_840n)
        await expect(prepareBasenameWrite({ estimateGas } as never, write, ALICE)).resolves.toMatchObject({ gas: 92_208n })
        expect(estimateGas).toHaveBeenCalledWith({ account: ALICE, to: write.to, data: write.data, value: 0n })
        await expect(prepareBasenameWrite({ estimateGas: vi.fn().mockRejectedValue(new Error("reverted")) } as never, write, ALICE)).rejects.toThrow(/reverted/)
    })
})
