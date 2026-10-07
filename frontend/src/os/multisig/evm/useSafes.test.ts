import { describe, expect, it } from "vitest"
import { countSafeAwaiting, sameNonce, type QueuedTx } from "./useSafes"

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
