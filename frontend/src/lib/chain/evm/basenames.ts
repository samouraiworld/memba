/**
 * Reading a Basename profile on Base: the address's primary name, proven by its forward record, and the text
 * records of that name. Read straight from Base (no L1, no CCIP gateway), from contracts in the manifest only.
 *
 * Primary name: the ENSIP-19 reverse registrar first, then the legacy reverse node `<addr>.<coinType>.reverse`.
 * A reverse record is a claim anyone can make about themselves, so a name is shown only when its forward record
 * (`addr(namehash(name))`, on a Basenames resolver) is the same address. An RPC failure throws: "no name" is
 * only ever what the chain answered.
 *
 * A viem module: reach it only through the lazy EVM adapter (./load.ts), never from eager code.
 *
 * @module lib/chain/evm/basenames
 */
import { isAddressEqual, parseAbi, zeroAddress, type Address, type Hex, type PublicClient } from "viem"
import { namehash, normalize } from "viem/ens"
import { evmContract } from "./manifest"

/** Text records the Profile app reads: ENSIP-5 keys, plus Memba's layout document under its Gno field name. */
export const BASENAME_TEXT_KEYS = ["description", "avatar", "url", "location", "com.twitter", "com.github", "memba.profile.v1"] as const
export type BasenameTextKey = (typeof BASENAME_TEXT_KEYS)[number]

export interface PrimaryBasename {
    name: string
    node: Hex
    /** The name's resolver, one of the Basenames resolvers in the manifest. */
    resolver: Address
}

export type BasenameClient = Pick<PublicClient, "readContract" | "multicall">

const registryAbi = parseAbi(["function resolver(bytes32 node) view returns (address)"])
const resolverAbi = parseAbi([
    "function addr(bytes32 node) view returns (address)",
    "function name(bytes32 node) view returns (string)",
    "function text(bytes32 node, string key) view returns (string)",
])
const reverseRegistrarAbi = parseAbi(["function nameForAddr(address addr) view returns (string)"])

const SUFFIX: Readonly<Record<number, string>> = { 8453: ".base.eth", 84532: ".basetest.eth" }

/** The parent every Basename on this chain sits under. */
export function basenameSuffix(chainId: number): string {
    if (!Object.hasOwn(SUFFIX, chainId)) throw new Error(`No Basenames on chain ${chainId}.`)
    return SUFFIX[chainId]
}

/** ENSIP-11 legacy reverse node of `address` on `chainId`: namehash("<addr hex>.<0x80000000 | chainId hex>.reverse"). */
export function legacyReverseNode(address: Address, chainId: number): Hex {
    const coinType = (0x80000000 + chainId).toString(16)
    return namehash(`${address.slice(2).toLowerCase()}.${coinType}.reverse`)
}

/** A one-label Basename under this chain's parent, already in ENSIP-15 normal form (no look-alike spellings). */
export function isAcceptableBasename(name: string, chainId: number): boolean {
    const suffix = basenameSuffix(chainId)
    if (!name.endsWith(suffix)) return false
    const label = name.slice(0, -suffix.length)
    if (!label || label.includes(".")) return false
    try {
        return normalize(name) === name
    } catch {
        return false
    }
}

function knownResolvers(chainId: number): Address[] {
    return [evmContract(chainId, "basenamesL2Resolver"), evmContract(chainId, "basenamesL2ResolverLegacy")]
}

/** Whether `resolver` is one of the Basenames resolvers in the manifest (the only ones Memba reads or writes). */
export function isKnownResolver(chainId: number, resolver: Address): boolean {
    return knownResolvers(chainId).some((r) => isAddressEqual(r, resolver))
}

async function resolverOf(client: BasenameClient, chainId: number, node: Hex): Promise<Address> {
    return client.readContract({ address: evmContract(chainId, "basenamesRegistry"), abi: registryAbi, functionName: "resolver", args: [node] })
}

/** The name proven by its forward record, or null when the chain says it does not point back to `address`. */
async function verifyForward(client: BasenameClient, chainId: number, address: Address, name: string): Promise<PrimaryBasename | null> {
    if (!isAcceptableBasename(name, chainId)) return null
    const node = namehash(name)
    const resolver = await resolverOf(client, chainId, node)
    if (resolver === zeroAddress || !isKnownResolver(chainId, resolver)) return null
    const target = await client.readContract({ address: resolver, abi: resolverAbi, functionName: "addr", args: [node] })
    return isAddressEqual(target, address) ? { name, node, resolver } : null
}

/** The primary Basename of `address`, proven by its forward record; null when it has none. Throws on RPC failure. */
export async function readPrimaryBasename(client: BasenameClient, chainId: number, address: Address): Promise<PrimaryBasename | null> {
    basenameSuffix(chainId)
    const candidates: string[] = []
    const ensip19 = await client.readContract({
        address: evmContract(chainId, "basenamesL2ReverseRegistrar"), abi: reverseRegistrarAbi, functionName: "nameForAddr", args: [address],
    })
    if (ensip19) candidates.push(ensip19)
    const reverseNode = legacyReverseNode(address, chainId)
    const reverseResolver = await resolverOf(client, chainId, reverseNode)
    if (reverseResolver !== zeroAddress && isKnownResolver(chainId, reverseResolver)) {
        const legacy = await client.readContract({ address: reverseResolver, abi: resolverAbi, functionName: "name", args: [reverseNode] })
        if (legacy && !candidates.includes(legacy)) candidates.push(legacy)
    }
    for (const name of candidates) {
        const proven = await verifyForward(client, chainId, address, name)
        if (proven) return proven
    }
    return null
}

/**
 * The profile text records of a proven name, in one multicall. A record that is not set reads "" (ENS has no
 * "absent"); a record whose call failed reads null. Throws when the RPC does not answer at all.
 */
export async function readBasenameTexts(
    client: BasenameClient,
    chainId: number,
    primary: PrimaryBasename,
): Promise<Record<BasenameTextKey, string | null>> {
    const results = await client.multicall({
        multicallAddress: evmContract(chainId, "multicall3"),
        allowFailure: true,
        contracts: BASENAME_TEXT_KEYS.map((key) => ({
            address: primary.resolver, abi: resolverAbi, functionName: "text" as const, args: [primary.node, key] as const,
        })),
    })
    return Object.fromEntries(
        BASENAME_TEXT_KEYS.map((key, i) => [key, results[i].status === "success" ? (results[i].result as string) : null]),
    ) as Record<BasenameTextKey, string | null>
}
