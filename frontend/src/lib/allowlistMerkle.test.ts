/**
 * allowlistMerkle.test.ts — the TS Merkle must hash byte-identically to the
 * realm's merkle.gno, or on-chain MintAllowlist proofs won't verify.
 *
 * Reference vectors below were computed independently (node crypto) from the
 * realm formula: leaf = sha256(0x00 ‖ addr ‖ ":" ‖ maxQty);
 * node = sha256(0x01 ‖ sortedConcat(l,r)).
 */

import { describe, it, expect } from "vitest"
import {
    leafHashHex,
    computeAllowlistRoot,
    getAllowlistProof,
    verifyAllowlist,
    parseAllowlistText,
} from "./allowlistMerkle"

const LA = "d16866b24f922c2b3827edafbaab57862b9d475f2332657a2cab963fee256958" // leaf g1test:3
const LB = "4aa0b679a46a13c322a2f1393ccc7a7bbfcde2b0b17f2aabe56d7b56d7c7a075" // leaf g1other:5
const PARENT = "db1798c2407fe6ee452c86dbb983d6ff4557c4f84d7521bc6e5588a01e048841"

describe("allowlistMerkle — byte layout matches merkle.gno", () => {
    it("leafHashHex = sha256(0x00 ‖ addr:maxQty)", async () => {
        expect(await leafHashHex("g1test", 3)).toBe(LA)
        expect(await leafHashHex("g1other", 5)).toBe(LB)
    })
})

describe("single-leaf tree", () => {
    it("root == leaf; empty proof verifies; wrong maxQty rejects", async () => {
        const entries = [{ addr: "g1test", maxQty: 3 }]
        const root = await computeAllowlistRoot(entries)
        expect(root).toBe(LA)
        expect(await verifyAllowlist(root, "g1test", 3, [])).toBe(true)
        expect(await verifyAllowlist(root, "g1test", 4, [])).toBe(false)
        expect(await verifyAllowlist("", "g1test", 3, [])).toBe(false)
    })
})

describe("two-leaf tree", () => {
    const entries = [
        { addr: "g1test", maxQty: 3 },
        { addr: "g1other", maxQty: 5 },
    ]
    it("root = parent of the two leaves (sorted-pair, commutative)", async () => {
        expect(await computeAllowlistRoot(entries)).toBe(PARENT)
    })
    it("each member's proof verifies; bad hex + non-member handled", async () => {
        const root = await computeAllowlistRoot(entries)
        const pa = await getAllowlistProof(entries, "g1test")
        expect(pa).not.toBeNull()
        expect(pa!.maxQty).toBe(3)
        expect(pa!.proof).toEqual([LB])
        expect(await verifyAllowlist(root, "g1test", pa!.maxQty, pa!.proof)).toBe(true)

        const pb = await getAllowlistProof(entries, "g1other")
        expect(await verifyAllowlist(root, "g1other", pb!.maxQty, pb!.proof)).toBe(true)

        expect(await verifyAllowlist(root, "g1test", 3, ["zzz"])).toBe(false)
        expect(await getAllowlistProof(entries, "g1nope")).toBeNull()
    })
})

describe("N-leaf round trip (incl. odd promote)", () => {
    it("every member proof verifies; wrong qty fails", async () => {
        const entries = Array.from({ length: 7 }, (_, i) => ({ addr: `g1addr${i}`, maxQty: i + 1 }))
        const root = await computeAllowlistRoot(entries)
        for (const e of entries) {
            const p = await getAllowlistProof(entries, e.addr)
            expect(p).not.toBeNull()
            expect(await verifyAllowlist(root, e.addr, p!.maxQty, p!.proof)).toBe(true)
            expect(await verifyAllowlist(root, e.addr, p!.maxQty + 1, p!.proof)).toBe(false)
        }
    })

    it("root is order-independent (leaves sorted internally) and dedupes by addr", async () => {
        const a = [
            { addr: "g1a", maxQty: 1 },
            { addr: "g1b", maxQty: 2 },
            { addr: "g1c", maxQty: 3 },
        ]
        const b = [
            { addr: "g1c", maxQty: 3 },
            { addr: "g1a", maxQty: 1 },
            { addr: "g1b", maxQty: 2 },
        ]
        expect(await computeAllowlistRoot(a)).toBe(await computeAllowlistRoot(b))
        // duplicate addr collapses to one leaf (first occurrence wins)
        const withDup = [...a, { addr: "g1a", maxQty: 9 }]
        expect(await computeAllowlistRoot(withDup)).toBe(await computeAllowlistRoot(a))
    })

    it("empty allowlist → empty root (rejects everyone)", async () => {
        expect(await computeAllowlistRoot([])).toBe("")
    })
})

describe("parseAllowlistText", () => {
    it("parses addr,qty / addr qty lines; defaults qty 1; skips blanks, comments, junk", () => {
        const text = `
# my allowlist
g1abc, 3
g1def 2
g1ghi
notanaddr 5
g1jkl,0

g1mno\t4
`
        expect(parseAllowlistText(text)).toEqual([
            { addr: "g1abc", maxQty: 3 },
            { addr: "g1def", maxQty: 2 },
            { addr: "g1ghi", maxQty: 1 },
            { addr: "g1mno", maxQty: 4 },
        ])
    })
})
