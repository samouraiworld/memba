/**
 * allowlistMerkle.ts — client-side Merkle allowlist for memba_collections.
 *
 * Hashes byte-identically to the realm's merkle.gno so generated roots/proofs
 * verify on-chain in MintAllowlist:
 *   leaf = sha256(0x00 ‖ addr ‖ ":" ‖ maxQty)        (tagged, S-5)
 *   node = sha256(0x01 ‖ sortedConcat(l, r))          (domain-separated, sorted-pair)
 * A single-leaf tree has root == leaf and an empty proof. Leaves are sorted by
 * hash (so the root is independent of input order) and deduped by address.
 *
 * The proof crosses the ABI as a comma-joined hex string — see joinProof in
 * launchpad.ts and splitProof in mint.gno.
 *
 * @module lib/allowlistMerkle
 */

export interface AllowlistEntry {
    addr: string
    maxQty: number
}

const enc = new TextEncoder()

/**
 * Parse a creator's allowlist text: one entry per line, `addr<sep>qty` where
 * sep is comma/space/tab. Blank lines and `#`-comments are skipped; a missing
 * qty defaults to 1; malformed lines are dropped. Deduping happens downstream.
 */
export function parseAllowlistText(text: string): AllowlistEntry[] {
    const out: AllowlistEntry[] = []
    for (const raw of text.split("\n")) {
        const line = raw.trim()
        if (line === "" || line.startsWith("#")) continue
        const parts = line.split(/[,\s]+/)
        const addr = parts[0]
        if (!addr.startsWith("g1")) continue
        const qty = parts.length > 1 ? parseInt(parts[1], 10) : 1
        if (!Number.isFinite(qty) || qty < 1) continue
        out.push({ addr, maxQty: qty })
    }
    return out
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
    // Cast for TS 5.7 BufferSource strictness (Uint8Array<ArrayBufferLike>).
    const buf = await crypto.subtle.digest("SHA-256", bytes as BufferSource)
    return new Uint8Array(buf)
}

function concatBytes(...arrs: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0))
    let o = 0
    for (const a of arrs) {
        out.set(a, o)
        o += a.length
    }
    return out
}

function bytesToHex(b: Uint8Array): string {
    let s = ""
    for (const x of b) s += x.toString(16).padStart(2, "0")
    return s
}

const HEX32 = /^[0-9a-f]{64}$/

function hexToBytes(h: string): Uint8Array {
    const out = new Uint8Array(h.length / 2)
    for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16)
    return out
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
    const n = Math.min(a.length, b.length)
    for (let i = 0; i < n; i++) {
        if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
    }
    return a.length - b.length
}

async function leafHash(addr: string, maxQty: number): Promise<Uint8Array> {
    return sha256(concatBytes(new Uint8Array([0x00]), enc.encode(`${addr}:${maxQty}`)))
}

/** Hex of the tagged leaf hash for (addr, maxQty). */
export async function leafHashHex(addr: string, maxQty: number): Promise<string> {
    return bytesToHex(await leafHash(addr, maxQty))
}

async function parentHash(a: Uint8Array, b: Uint8Array): Promise<Uint8Array> {
    const [lo, hi] = compareBytes(a, b) <= 0 ? [a, b] : [b, a]
    return sha256(concatBytes(new Uint8Array([0x01]), lo, hi))
}

/** Dedupe by addr (first wins), compute leaves, sort by leaf bytes (deterministic). */
async function normalizedLeaves(entries: AllowlistEntry[]): Promise<{ leaf: Uint8Array; entry: AllowlistEntry }[]> {
    const seen = new Set<string>()
    const unique: AllowlistEntry[] = []
    for (const e of entries) {
        if (seen.has(e.addr)) continue
        seen.add(e.addr)
        unique.push(e)
    }
    const withLeaf = await Promise.all(unique.map(async (entry) => ({ leaf: await leafHash(entry.addr, entry.maxQty), entry })))
    withLeaf.sort((x, y) => compareBytes(x.leaf, y.leaf))
    return withLeaf
}

async function buildLayers(leaves: Uint8Array[]): Promise<Uint8Array[][]> {
    const layers: Uint8Array[][] = [leaves]
    let cur = leaves
    while (cur.length > 1) {
        const next: Uint8Array[] = []
        for (let i = 0; i < cur.length; i += 2) {
            next.push(i + 1 < cur.length ? await parentHash(cur[i], cur[i + 1]) : cur[i]) // odd promotes
        }
        layers.push(next)
        cur = next
    }
    return layers
}

/** The allowlist Merkle root (hex) to set via SetMintPhase. "" for an empty list. */
export async function computeAllowlistRoot(entries: AllowlistEntry[]): Promise<string> {
    const sorted = await normalizedLeaves(entries)
    if (sorted.length === 0) return ""
    const layers = await buildLayers(sorted.map((x) => x.leaf))
    return bytesToHex(layers[layers.length - 1][0])
}

/** The (maxQty, proof) a given address needs to mint, or null if not allowlisted. */
export async function getAllowlistProof(
    entries: AllowlistEntry[],
    addr: string,
): Promise<{ maxQty: number; proof: string[] } | null> {
    const sorted = await normalizedLeaves(entries)
    const idx = sorted.findIndex((x) => x.entry.addr === addr)
    if (idx < 0) return null
    const layers = await buildLayers(sorted.map((x) => x.leaf))
    const proof: string[] = []
    let pos = idx
    for (let l = 0; l < layers.length - 1; l++) {
        const layer = layers[l]
        const sib = pos ^ 1
        if (sib < layer.length) proof.push(bytesToHex(layer[sib])) // promoted node has no sibling at this layer
        pos = pos >> 1
    }
    return { maxQty: sorted[idx].entry.maxQty, proof }
}

/** Local mirror of the realm's verifyAllowlist (for UI preview + self-test). */
export async function verifyAllowlist(
    root: string,
    addr: string,
    maxQty: number,
    proof: string[],
): Promise<boolean> {
    if (root === "") return false
    let cur = await leafHash(addr, maxQty)
    for (const sibHex of proof) {
        if (!HEX32.test(sibHex)) return false
        cur = await parentHash(cur, hexToBytes(sibHex))
    }
    return bytesToHex(cur) === root
}
