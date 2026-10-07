import { describe, expect, it } from "vitest"
import { countSafeAwaiting, dedupeByHash, sameNonce, type QueuedTx } from "./useSafes"

const ME = "0xa11ce00000000000000000000000000000000001"
const tx = (nonce: bigint, hash: string) => ({ nonce, safeTxHash: hash }) as QueuedTx

describe("Safe queue helpers", () => {
    it("names each nonce that more than one proposal claims", () => {
        expect(sameNonce([tx(4n, "a"), tx(4n, "b"), tx(5n, "c")])).toEqual(new Map([["4", 2]]))
        expect(sameNonce([tx(4n, "a")]).size).toBe(0)
    })

    it("counts per Safe the queued transactions this owner has not confirmed, in any spelling", () => {
        const counts = countSafeAwaiting([
            { address: "0xs1", pending: [{ confirmations: [{ owner: ME.toUpperCase().replace("0X", "0x") }] }, { confirmations: [] }, {}] },
            { address: "0xs2", pending: [{ confirmations: [{ owner: ME }] }] },
        ], ME)
        expect(counts).toEqual(new Map([["0xs1", 2]]))
    })
})

describe("one queue entry per hash", () => {
    it("keeps the entry whose contents match its hash, else the first, and counts the dropped ones", () => {
        const e = (id: string, hash: string, hashMatches: boolean) => ({ id, safeTxHash: hash, hashMatches })
        expect(dedupeByHash([e("decoy", "h1", false), e("real", "h1", true), e("other", "h2", true)])).toEqual([
            { id: "real", safeTxHash: "h1", hashMatches: true, duplicates: 1 },
            { id: "other", safeTxHash: "h2", hashMatches: true },
        ])
        expect(dedupeByHash([e("a", "h", false), e("b", "h", false)])).toEqual([{ id: "a", safeTxHash: "h", hashMatches: false, duplicates: 1 }])
    })
})
