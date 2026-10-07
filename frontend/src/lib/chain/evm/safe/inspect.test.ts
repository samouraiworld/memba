import { describe, expect, it, vi } from "vitest"
import { encodeAbiParameters, encodeFunctionResult, keccak256, pad, parseAbi, toFunctionSelector, type Hex } from "viem"
import { inspectSafe, type SafeReader } from "./inspect"
import { SAFE_PROXY_CODE_HASHES, SAFE_SINGLETONS, SAFE_SLOTS } from "./known"

const SAFE_ABI = parseAbi([
    "function VERSION() view returns (string)",
    "function getOwners() view returns (address[])",
    "function getThreshold() view returns (uint256)",
    "function nonce() view returns (uint256)",
    "function getModulesPaginated(address start, uint256 pageSize) view returns (address[] array, address next)",
])

const SAFE: Hex = "0x5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe"
const OWNERS: Hex[] = ["0xa11ce00000000000000000000000000000000001", "0xb0b0000000000000000000000000000000000002", "0xca1e000000000000000000000000000000000003"]
const L2_150 = SAFE_SINGLETONS.find((s) => s.version === "1.5.0" && s.l2)!
const L2_141 = SAFE_SINGLETONS.find((s) => s.version === "1.4.1" && s.l2)!
const HANDLER_150: Hex = "0x3EfCBb83A4A7AfcB4F68D501E2c2203a38be77f4"
const SENTINEL: Hex = "0x0000000000000000000000000000000000000001"

// Fake code blobs; the injected hash maps them to the published codehashes
// (the real keccak256 for anything else).
const PROXY_CODE: Hex = "0xfa4e01"
const SINGLETON_CODE: Hex = "0xfa4e02"
const FAKE_HASHES: Record<string, Hex> = { [PROXY_CODE]: SAFE_PROXY_CODE_HASHES["1.5.0"], [SINGLETON_CODE]: L2_150.codeHash }
const hash = (data: Hex): Hex => FAKE_HASHES[data] ?? keccak256(data)

interface World {
    chainId: number
    code: Record<string, Hex>
    storage: Record<string, Hex>
    version: string
    owners: Hex[]
    threshold: bigint
    nonce: bigint
    modules: Hex[]
    next: Hex
}

function world(over: Partial<World> = {}): World {
    return {
        chainId: 84532,
        code: { [SAFE]: PROXY_CODE, [L2_150.address.toLowerCase()]: SINGLETON_CODE },
        storage: { [SAFE_SLOTS.singleton]: pad(L2_150.address), [SAFE_SLOTS.fallbackHandler]: pad(HANDLER_150) },
        version: "1.5.0", owners: OWNERS, threshold: 2n, nonce: 7n, modules: [], next: SENTINEL,
        ...over,
    }
}

function readerFor(w: World): SafeReader & { slotsRead: Hex[] } {
    const slotsRead: Hex[] = []
    return {
        slotsRead,
        getChainId: async () => w.chainId,
        getCode: async (address) => w.code[address.toLowerCase()],
        getStorageAt: async (address, slot) => {
            expect(address).toBe(SAFE)
            slotsRead.push(slot)
            return w.storage[slot] ?? pad("0x00")
        },
        call: async (to, data) => {
            expect(to).toBe(SAFE)
            const selector = data.slice(0, 10)
            if (selector === toFunctionSelector("VERSION()")) return encodeFunctionResult({ abi: SAFE_ABI, functionName: "VERSION", result: w.version })
            if (selector === toFunctionSelector("getOwners()")) return encodeFunctionResult({ abi: SAFE_ABI, functionName: "getOwners", result: w.owners })
            if (selector === toFunctionSelector("getThreshold()")) return encodeFunctionResult({ abi: SAFE_ABI, functionName: "getThreshold", result: w.threshold })
            if (selector === toFunctionSelector("nonce()")) return encodeFunctionResult({ abi: SAFE_ABI, functionName: "nonce", result: w.nonce })
            if (selector === toFunctionSelector("getModulesPaginated(address,uint256)")) {
                expect(data.slice(10)).toBe(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [SENTINEL, 10n]).slice(2))
                return encodeFunctionResult({ abi: SAFE_ABI, functionName: "getModulesPaginated", result: [w.modules, w.next] })
            }
            throw new Error(`unexpected call ${selector}`)
        },
    }
}

const inspect = (w: World, address: string = SAFE) => inspectSafe(readerFor(w), hash, 84532, address)

describe("inspecting a Safe on chain", () => {
    it("reads a SafeL2 v1.5.0 with the canonical handler as a Safe with nothing to warn about", async () => {
        expect(await inspect(world())).toEqual({
            kind: "ok",
            value: {
                kind: "safe", address: SAFE, version: "1.5.0", l2: true, singleton: L2_150.address.toLowerCase(),
                owners: OWNERS.map((o) => o.toLowerCase()), threshold: 2, nonce: 7n,
                modules: [], modulesTruncated: false, guard: null, moduleGuard: null, fallbackHandler: HANDLER_150.toLowerCase(), warnings: [],
            },
        })
    })

    it("accepts the address in any case and keeps it lowercase", async () => {
        const r = await inspect(world(), SAFE.toUpperCase().replace("0X", "0x"))
        expect(r.kind === "ok" && r.value.address).toBe(SAFE)
    })

    it("trusts nothing from an RPC that answers as another chain, or does not answer", async () => {
        expect(await inspect(world({ chainId: 8453 }))).toEqual({ kind: "unavailable", reason: "the RPC answered as chain 8453, not 84532" })
        const down = { ...readerFor(world()), getChainId: () => Promise.reject(new Error("offline")) }
        expect(await inspectSafe(down, hash, 84532, SAFE)).toEqual({ kind: "unavailable", reason: "the RPC did not answer" })
        expect(await inspect(world(), "0x1234")).toEqual({ kind: "unavailable", reason: "this is not an address" })
    })

    it("says an outage mid-way is unavailable, never 'not a Safe'", async () => {
        const flaky = { ...readerFor(world()), call: () => Promise.reject(new Error("timeout")) }
        expect(await inspectSafe(flaky, hash, 84532, SAFE)).toEqual({ kind: "unavailable", reason: "the RPC did not answer" })
        const garbled = { ...readerFor(world()), call: async () => "0x1234" as Hex }
        const r = await inspectSafe(garbled, hash, 84532, SAFE)
        expect(r.kind).toBe("unavailable")
        expect(r.kind === "unavailable" && r.reason).toMatch(/not a Safe's/)
    })

    it("refuses look-alikes: no code, unknown proxy, unknown singleton, tampered singleton code, lying VERSION", async () => {
        const reason = async (w: World) => {
            const r = await inspect(w)
            return r.kind === "ok" && r.value.kind === "not-a-safe" ? r.value.reason : r
        }
        expect(await reason(world({ code: {} }))).toBe("no-contract")
        expect(await reason(world({ code: { [SAFE]: "0x6080604052" } }))).toBe("unknown-proxy")
        expect(await reason(world({ storage: { [SAFE_SLOTS.singleton]: pad("0x1111111111111111111111111111111111111111") } }))).toBe("unknown-singleton")
        expect(await reason(world({ storage: {} }))).toBe("unknown-singleton")
        // The proxy points at the real singleton address, but other code is there (as on a chain where it was never deployed).
        expect(await reason(world({ code: { [SAFE]: PROXY_CODE, [L2_150.address.toLowerCase()]: "0x6080" } }))).toBe("singleton-code-mismatch")
        expect(await reason(world({ code: { [SAFE]: PROXY_CODE } }))).toBe("singleton-code-mismatch")
        expect(await reason(world({ version: "1.4.1" }))).toBe("version-mismatch")
    })

    it("does not present owners and a threshold that cannot be a Safe's", async () => {
        expect((await inspect(world({ threshold: 4n }))).kind).toBe("unavailable")
        expect((await inspect(world({ threshold: 0n }))).kind).toBe("unavailable")
        expect((await inspect(world({ owners: [] }))).kind).toBe("unavailable")
    })

    it("lists modules, guards and an unknown fallback handler, worst first", async () => {
        const module: Hex = "0xd0d0000000000000000000000000000000000001"
        const guard: Hex = "0x9a9d000000000000000000000000000000000002"
        const moduleGuard: Hex = "0x9a9d000000000000000000000000000000000003"
        const handler: Hex = "0xbad0000000000000000000000000000000000004"
        const r = await inspect(world({
            modules: [module], next: module,
            storage: { [SAFE_SLOTS.singleton]: pad(L2_150.address), [SAFE_SLOTS.guard]: pad(guard), [SAFE_SLOTS.moduleGuard]: pad(moduleGuard), [SAFE_SLOTS.fallbackHandler]: pad(handler) },
        }))
        if (r.kind !== "ok" || r.value.kind !== "safe") throw new Error("expected a Safe")
        expect(r.value).toMatchObject({ modules: [module], modulesTruncated: true, guard, moduleGuard, fallbackHandler: handler })
        expect(r.value.warnings.map((w) => [w.code, w.severity, w.addresses])).toEqual([
            ["modules", "danger", [module]],
            ["guard", "caution", [guard]],
            ["module-guard", "caution", [moduleGuard]],
            ["unknown-fallback-handler", "danger", [handler]],
        ])
        expect(r.value.warnings[0].text).toMatch(/^1 or more modules are enabled/)
    })

    it("counts modules exactly when the first page holds them all, and flags a missing fallback handler", async () => {
        const modules: Hex[] = ["0xd0d0000000000000000000000000000000000001", "0xd0d0000000000000000000000000000000000002"]
        const r = await inspect(world({ modules, storage: { [SAFE_SLOTS.singleton]: pad(L2_150.address) } }))
        if (r.kind !== "ok" || r.value.kind !== "safe") throw new Error("expected a Safe")
        expect(r.value.modulesTruncated).toBe(false)
        expect(r.value.warnings.map((w) => w.code)).toEqual(["modules", "no-fallback-handler"])
        expect(r.value.warnings[0].text).toMatch(/^2 modules are enabled/)
    })

    it("reads an imported v1.4.1 Safe without asking for the v1.5.0-only module guard", async () => {
        const PROXY_141: Hex = "0xfa4e03", SINGLETON_141: Hex = "0xfa4e04"
        const hash141 = (d: Hex): Hex => ({ [PROXY_141]: SAFE_PROXY_CODE_HASHES["1.4.1"], [SINGLETON_141]: L2_141.codeHash } as Record<string, Hex>)[d] ?? keccak256(d)
        const w = world({
            version: "1.4.1",
            code: { [SAFE]: PROXY_141, [L2_141.address.toLowerCase()]: SINGLETON_141 },
            storage: { [SAFE_SLOTS.singleton]: pad(L2_141.address), [SAFE_SLOTS.fallbackHandler]: pad("0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99") },
        })
        const reader = readerFor(w)
        const r = await inspectSafe(reader, hash141, 84532, SAFE)
        expect(r.kind === "ok" && r.value.kind === "safe" && [r.value.version, r.value.l2, r.value.warnings]).toEqual(["1.4.1", true, []])
        expect(reader.slotsRead).not.toContain(SAFE_SLOTS.moduleGuard)
    })

    it("refuses a storage answer that is not one word", async () => {
        const reader = readerFor(world())
        const odd = { ...reader, getStorageAt: vi.fn(async () => "0x01020304050607080910111213141516171819202122232425262728293031323334" as Hex) }
        expect((await inspectSafe(odd, hash, 84532, SAFE)).kind).toBe("unavailable")
    })
})
