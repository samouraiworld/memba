/**
 * Client side of the NFT realms' Merkle scheme (p/samcrew/launchpad/merkle/v1):
 * the leaves of a drop allowlist and of a collection's traits, and the roots and
 * proofs the realms check them against. A hash is 64 lowercase hex digits. A
 * proof is the realms' own argument: its hashes from leaf to root joined by
 * commas, and the empty string for a tree of one leaf. Leaves are never sorted:
 * a root and its proofs come from the same list in the same order.
 *
 * @module lib/nft/merkle
 */
import { isValidGnoAddressChecksum } from "../dao/address"
import { sha256Hex } from "./hash"
import { collectionId, hash } from "./parse"

/** The longest proof a realm accepts. No tree built here is deeper: a list holds fewer than 2^32 leaves. */
const MAX_DEPTH = 32
const MAX_INT64 = 9223372036854775807n
const MAX_TRAIT_BYTES = 100

const utf8 = new TextEncoder()

function leafOf(data: string): Promise<string> {
    return sha256Hex(new Uint8Array([0x00, ...utf8.encode(data)]))
}

/** The pair is hashed smaller first. Lowercase hex of one length sorts exactly as its bytes do. */
function node(a: string, b: string): Promise<string> {
    const pair = a < b ? `01${a}${b}` : `01${b}${a}`
    return sha256Hex(Uint8Array.from(pair.match(/../g) ?? [], (byte) => parseInt(byte, 16)))
}

/** A positive int64, the way the realms count tokens and allowances. */
function positive(value: bigint, what: string): bigint {
    if (typeof value !== "bigint" || value < 1n || value > MAX_INT64) throw new Error(`Invalid ${what}`)
    return value
}

/** drops/v1 bounds: a collection has at most `maxStages` stages and a wallet mints at most `maxPerWallet` per stage. */
const MAX_STAGES = 10
const MAX_PER_WALLET = 1_000_000n

/**
 * The leaf that lets `who` mint up to `allowance` tokens in one allowlist stage
 * of a collection. A stage or an allowance beyond what drops accepts would
 * commit a leaf nobody can ever claim, so it is refused here.
 */
export async function allowlistLeaf(collection: string, stageIndex: number, who: string, allowance: bigint): Promise<string> {
    if (!Number.isSafeInteger(stageIndex) || stageIndex < 0 || stageIndex >= MAX_STAGES) throw new Error("Invalid stage index")
    if (typeof allowance !== "bigint" || allowance > MAX_PER_WALLET) throw new Error("Invalid allowance")
    // The checksum is verified: a mistyped address would commit a leaf nobody can ever use.
    if (!isValidGnoAddressChecksum(who)) throw new Error("Invalid address")
    return leafOf(`launchpad-drop-v1|${collectionId(collection)}|${stageIndex}|${who}|${positive(allowance, "allowance")}`)
}

/** The leaf that proves a token carries a trait, written `<type>=<value>`. */
export async function traitLeaf(collection: string, number: bigint, trait: string): Promise<string> {
    const separator = trait.indexOf("=")
    if (separator < 1 || separator === trait.length - 1 || separator !== trait.lastIndexOf("=") || trait.includes("|")
        || utf8.encode(trait).length > MAX_TRAIT_BYTES) {
        throw new Error("Invalid trait")
    }
    return leafOf(`launchpad-trait-v1|${collectionId(collection)}|${positive(number, "token number")}|${trait}`)
}

/** Every level of the tree, leaves first. A node without a sibling is carried up unchanged. */
async function levels(leaves: readonly string[]): Promise<string[][]> {
    if (leaves.length === 0) throw new Error("No leaves")
    const tree = [leaves.map((leaf) => hash(leaf, "leaf"))]
    for (let level = tree[0]; level.length > 1; level = tree[tree.length - 1]) {
        const next: string[] = []
        for (let i = 0; i < level.length; i += 2) next.push(i + 1 === level.length ? level[i] : await node(level[i], level[i + 1]))
        tree.push(next)
    }
    return tree
}

export async function merkleRoot(leaves: readonly string[]): Promise<string> {
    const tree = await levels(leaves)
    return tree[tree.length - 1][0]
}

/** The proof of the leaf at `index`, as the argument a realm call takes. */
export async function merkleProof(leaves: readonly string[], index: number): Promise<string> {
    if (!Number.isSafeInteger(index) || index < 0 || index >= leaves.length) throw new Error("Invalid leaf index")
    const proof: string[] = []
    let at = index
    for (const level of (await levels(leaves)).slice(0, -1)) {
        const sibling = at % 2 === 0 ? at + 1 : at - 1
        if (sibling < level.length) proof.push(level[sibling])
        at = Math.floor(at / 2)
    }
    return proof.join(",")
}

/** Whether `proof` leads from `leaf` to `root`. A malformed hash or a proof longer than a realm accepts throws. */
export async function verifyProof(root: string, leaf: string, proof: string): Promise<boolean> {
    const expected = hash(root, "root")
    const path = proof === "" ? [] : proof.split(",")
    if (path.length > MAX_DEPTH) throw new Error("Invalid proof")
    let current = hash(leaf, "leaf")
    for (const sibling of path) current = await node(current, hash(sibling, "proof"))
    return current === expected
}
