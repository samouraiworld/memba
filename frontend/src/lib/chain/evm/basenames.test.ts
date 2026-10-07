import { describe, expect, it, vi } from "vitest"
import { zeroAddress, type Address, type Hex } from "viem"
import { namehash } from "viem/ens"
import { evmContract } from "./manifest"
import {
    BASENAME_TEXT_KEYS,
    basenameSuffix,
    isAcceptableBasename,
    legacyReverseNode,
    readBasenameTexts,
    readPrimaryBasename,
    type BasenameClient,
} from "./basenames"

// Live on Base (cast, 2026-10-07) and pinned in contracts/evm/test/fork/Basenames.t.sol test_primary_name_read_path.
const JESSE: Address = "0x2211d1D0020DAEA8039E46Cf1367962070d77DA9"
const JESSE_NODE: Hex = "0x286c3ecf9d29c1d2cc5b4606d9f2164c4a6f069f8edcc0bb406b838b69856509"
const JESSE_REVERSE: Hex = "0x32ac9b4c5ef8d4742ed765a7e069ea31f043ee8d666b9009d74b2de6d02ff182"
const OTHER: Address = "0x97BCd93504d89D9d236E773e8f5C20fEaE466e72"
const B = 8453
const REGISTRY = evmContract(B, "basenamesRegistry")
const L2_REVERSE = evmContract(B, "basenamesL2ReverseRegistrar")
const RESOLVER = evmContract(B, "basenamesL2Resolver")
const LEGACY_RESOLVER = evmContract(B, "basenamesL2ResolverLegacy")

interface Chain {
    ensip19?: string
    resolvers?: Record<Hex, Address>
    names?: Record<Hex, string>
    addrs?: Record<Hex, Address>
}

/** A fake Base that answers the four reads the module makes, and fails loudly on any other. */
function fakeClient(chain: Chain): BasenameClient {
    const readContract = vi.fn(async ({ address, functionName, args }: { address: Address; functionName: string; args: readonly unknown[] }) => {
        const node = args[0] as Hex
        if (address === L2_REVERSE && functionName === "nameForAddr") return chain.ensip19 ?? ""
        if (address === REGISTRY && functionName === "resolver") return chain.resolvers?.[node] ?? zeroAddress
        if (functionName === "name") return chain.names?.[node] ?? ""
        if (functionName === "addr") return chain.addrs?.[node] ?? zeroAddress
        throw new Error(`unexpected read ${address}.${functionName}`)
    })
    return { readContract, multicall: vi.fn() } as unknown as BasenameClient
}

describe("Basenames names", () => {
    it("computes the legacy reverse node the forge test reads (ENSIP-11 coin type 0x80002105)", () => {
        expect(legacyReverseNode(JESSE, B)).toBe(JESSE_REVERSE)
        expect(namehash("jesse.base.eth")).toBe(JESSE_NODE)
        expect(legacyReverseNode(JESSE, 84532)).toBe(namehash("2211d1d0020daea8039e46cf1367962070d77da9.80014a34.reverse"))
    })

    it("accepts only one normalized label under this chain's parent", () => {
        expect(basenameSuffix(B)).toBe(".base.eth")
        expect(basenameSuffix(84532)).toBe(".basetest.eth")
        expect(() => basenameSuffix(1)).toThrow(/No Basenames/)
        expect(isAcceptableBasename("jesse.base.eth", B)).toBe(true)
        expect(isAcceptableBasename("jesse.basetest.eth", 84532)).toBe(true)
        for (const bad of ["jesse.basetest.eth", "Jesse.base.eth", "a.jesse.base.eth", ".base.eth", "jesse.eth", "je​sse.base.eth"]) {
            expect(isAcceptableBasename(bad, B), bad).toBe(false)
        }
    })
})

describe("readPrimaryBasename", () => {
    it("returns the ENSIP-19 name when its forward record points back", async () => {
        const client = fakeClient({ ensip19: "jesse.base.eth", resolvers: { [JESSE_NODE]: LEGACY_RESOLVER }, addrs: { [JESSE_NODE]: JESSE } })
        await expect(readPrimaryBasename(client, B, JESSE)).resolves.toEqual({ name: "jesse.base.eth", node: JESSE_NODE, resolver: LEGACY_RESOLVER })
    })

    it("falls back to the legacy reverse node", async () => {
        const client = fakeClient({
            resolvers: { [JESSE_REVERSE]: LEGACY_RESOLVER, [JESSE_NODE]: RESOLVER },
            names: { [JESSE_REVERSE]: "jesse.base.eth" },
            addrs: { [JESSE_NODE]: JESSE },
        })
        await expect(readPrimaryBasename(client, B, JESSE)).resolves.toMatchObject({ name: "jesse.base.eth", resolver: RESOLVER })
    })

    it("refuses a claimed name whose forward record is someone else (anyone can claim any name in reverse)", async () => {
        const client = fakeClient({ ensip19: "jesse.base.eth", resolvers: { [JESSE_NODE]: RESOLVER }, addrs: { [JESSE_NODE]: JESSE } })
        await expect(readPrimaryBasename(client, B, OTHER)).resolves.toBeNull()
    })

    it("tries the legacy name when the ENSIP-19 one does not verify", async () => {
        const stale = namehash("old.base.eth")
        const client = fakeClient({
            ensip19: "old.base.eth",
            resolvers: { [stale]: RESOLVER, [JESSE_REVERSE]: LEGACY_RESOLVER, [JESSE_NODE]: RESOLVER },
            names: { [JESSE_REVERSE]: "jesse.base.eth" },
            addrs: { [stale]: OTHER, [JESSE_NODE]: JESSE },
        })
        await expect(readPrimaryBasename(client, B, JESSE)).resolves.toMatchObject({ name: "jesse.base.eth" })
    })

    it("ignores names on resolvers outside the manifest, and look-alike spellings", async () => {
        const rogue: Address = "0x000000000000000000000000000000000000dEaD"
        const onRogue = fakeClient({ ensip19: "jesse.base.eth", resolvers: { [JESSE_NODE]: rogue }, addrs: { [JESSE_NODE]: JESSE } })
        await expect(readPrimaryBasename(onRogue, B, JESSE)).resolves.toBeNull()
        const upper = fakeClient({ ensip19: "JESSE.base.eth", resolvers: { [namehash("JESSE.base.eth")]: RESOLVER }, addrs: { [namehash("JESSE.base.eth")]: JESSE } })
        await expect(readPrimaryBasename(upper, B, JESSE)).resolves.toBeNull()
    })

    it("returns null for an address with no name, and throws (never 'no name') when the RPC fails", async () => {
        await expect(readPrimaryBasename(fakeClient({}), B, OTHER)).resolves.toBeNull()
        const down = { readContract: vi.fn().mockRejectedValue(new Error("fetch failed")), multicall: vi.fn() } as unknown as BasenameClient
        await expect(readPrimaryBasename(down, B, JESSE)).rejects.toThrow(/fetch failed/)
    })
})

describe("readBasenameTexts", () => {
    it("reads every profile key from the name's resolver in one multicall, failed calls as null", async () => {
        const multicall = vi.fn().mockResolvedValue(
            BASENAME_TEXT_KEYS.map((key) => (key === "url" ? { status: "failure", error: new Error("x") } : { status: "success", result: key === "description" ? "base.eth builder #001" : "" })),
        )
        const client = { readContract: vi.fn(), multicall } as unknown as BasenameClient
        const texts = await readBasenameTexts(client, B, { name: "jesse.base.eth", node: JESSE_NODE, resolver: LEGACY_RESOLVER })
        expect(texts).toMatchObject({ description: "base.eth builder #001", avatar: "", url: null, "memba.profile.v1": "" })
        const call = multicall.mock.calls[0][0]
        expect(call.multicallAddress).toBe(evmContract(B, "multicall3"))
        expect(call.contracts.map((c: { address: Address; args: unknown[] }) => [c.address, c.args[0], c.args[1]])).toEqual(
            BASENAME_TEXT_KEYS.map((key) => [LEGACY_RESOLVER, JESSE_NODE, key]),
        )
    })
})
