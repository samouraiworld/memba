/**
 * Token Launchpad airdrop manifests: the Merkle root a creator commits with
 * `CreateAirdrop` and each beneficiary's proof for `ClaimAirdrop`, built
 * exactly as `r/samcrew/launchpad/sales/v1` and `p/merkle/v1` check them.
 * Offline: nothing here reads a chain or implies the realm is published.
 */
import { sha256 } from "@noble/hashes/sha2.js"
import { isValidGnoAddressChecksum } from "./dao/address"
import { TOKEN_LAUNCHPAD_SALES_ADDRESS } from "./tokenLaunchpadSalesClient"

const MAX_INT64 = 9223372036854775807n
/** A browser-side bound; the contract's own limit is a proof depth of 32. */
const MAX_ENTRIES = 100_000
const encoder = new TextEncoder()

export interface AirdropEntry {
    index: number
    /** The address as the chain writes a caller's: lowercase bech32. */
    beneficiary: string
    /** Token base units, a canonical positive int64 decimal string. */
    amount: string
}

export interface AirdropClaim extends AirdropEntry {
    /** Comma-separated lowercase sibling hashes; empty for a one-leaf tree. */
    proof: string
}

export interface AirdropManifest {
    tokenId: string
    root: string
    /** The sum of the amounts: what `CreateAirdrop` funds, so nothing is left unclaimable. */
    total: string
    claims: AirdropClaim[]
}

function fail(message: string): never {
    throw new Error(`Launchpad airdrop manifest: ${message}`)
}

function parseAmount(raw: unknown): bigint {
    if (typeof raw !== "string" || raw.length > 19 || !/^[1-9][0-9]*$/.test(raw)) fail("amount must be a canonical positive decimal string")
    const amount = BigInt(raw)
    if (amount > MAX_INT64) fail("amount exceeds int64")
    return amount
}

function toHex(bytes: Uint8Array): string {
    return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("")
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
    for (let i = 0; i < 32; i++) {
        if (a[i] !== b[i]) return a[i] - b[i]
    }
    return 0
}

/** An inner node hashes 0x01 and its two children in byte order. */
function node(a: Uint8Array, b: Uint8Array): Uint8Array {
    const [first, second] = compareBytes(a, b) <= 0 ? [a, b] : [b, a]
    const bytes = new Uint8Array(65)
    bytes[0] = 1
    bytes.set(first, 1)
    bytes.set(second, 33)
    return sha256(bytes)
}

/** A leaf hashes 0x00 and the text the sales realm rebuilds from the claim's arguments. */
function leaf(tokenId: string, entry: AirdropEntry): Uint8Array {
    const data = encoder.encode(`launchpad-airdrop-v1|${tokenId}|${entry.index}|${entry.beneficiary}|${entry.amount}`)
    const bytes = new Uint8Array(data.length + 1)
    bytes.set(data, 1)
    return sha256(bytes)
}

/**
 * Builds the root and every proof. Indices run from 0 without gaps, in any
 * input order; an odd node is promoted to the next level unhashed.
 */
export function prepareAirdropManifest(tokenId: string, input: readonly AirdropEntry[]): AirdropManifest {
    if (!/^T[1-9][0-9]{0,9}$/.test(tokenId)) fail("invalid token ID")
    if (!Array.isArray(input) || input.length === 0 || input.length > MAX_ENTRIES) fail("invalid entry count")

    let total = 0n
    const entries = input.map(entry => {
        if (!entry || typeof entry !== "object" || !Number.isSafeInteger(entry.index) || entry.index < 0 || Object.is(entry.index, -0)) fail("invalid leaf index")
        if (!isValidGnoAddressChecksum(entry.beneficiary) || entry.beneficiary === TOKEN_LAUNCHPAD_SALES_ADDRESS) {
            fail(`beneficiary at index ${entry.index} must be an address as the chain writes it, not the sales realm`)
        }
        total += parseAmount(entry.amount)
        return { index: entry.index, beneficiary: entry.beneficiary, amount: entry.amount }
    }).sort((a, b) => a.index - b.index)
    if (total > MAX_INT64) fail("total exceeds int64")
    entries.forEach((entry, i) => {
        if (entry.index !== i) fail("indices must be unique and contiguous from zero")
    })

    const levels: Uint8Array[][] = [entries.map(entry => leaf(tokenId, entry))]
    while (levels[levels.length - 1].length > 1) {
        const previous = levels[levels.length - 1]
        const next: Uint8Array[] = []
        for (let i = 0; i < previous.length; i += 2) {
            next.push(i + 1 < previous.length ? node(previous[i], previous[i + 1]) : previous[i])
        }
        levels.push(next)
    }

    const claims = entries.map((entry, position) => {
        const siblings: string[] = []
        let offset = position
        for (let level = 0; level < levels.length - 1; level++) {
            const sibling = offset ^ 1
            if (sibling < levels[level].length) siblings.push(toHex(levels[level][sibling]))
            offset = Math.floor(offset / 2)
        }
        return { ...entry, proof: siblings.join(",") }
    })

    return { tokenId, root: toHex(levels[levels.length - 1][0]), total: total.toString(), claims }
}

/**
 * Checks a published manifest against the token, root and total read from the
 * chain, and rebuilds every proof. Claims may come in any order; each is
 * compared with the rebuilt claim of the same index. Returns the rebuilt manifest.
 */
export function verifyAirdropManifest(
    manifest: AirdropManifest,
    commitment: { tokenId: string; root: string; total: string },
): AirdropManifest {
    if (!manifest || typeof manifest !== "object" || !commitment || typeof commitment !== "object" ||
        !Array.isArray(manifest.claims)) fail("invalid manifest")
    if (manifest.tokenId !== commitment.tokenId || manifest.root !== commitment.root ||
        manifest.total !== commitment.total) fail("manifest does not match the chain commitment")
    const rebuilt = prepareAirdropManifest(manifest.tokenId, manifest.claims)
    const published = [...manifest.claims].sort((a, b) => a.index - b.index)
    if (rebuilt.root !== manifest.root || rebuilt.total !== manifest.total ||
        rebuilt.claims.some((claim, i) => claim.proof !== published[i].proof)) {
        fail("manifest does not match its root, total or proofs")
    }
    return rebuilt
}
