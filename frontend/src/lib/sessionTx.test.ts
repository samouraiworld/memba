import { describe, expect, it } from "vitest"
import { secp256k1 } from "@noble/curves/secp256k1.js"
import { sha256 } from "@noble/hashes/sha2.js"
import { keyFromPriv, newSessionKey, signPayload, signSessionTx, type CallMsg } from "./sessionTx"

const hex = (s: string) => Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)))
const toB64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))

const FIXTURE = {
    privHex: "ff3b273c6ee2d82d52e14c6f1b44680f66cb83aca07c4641492c42db4ae64210",
    sessionAddr: "g1uy9yysrh3f8xs5e7zng4dujx9u5wy0qz7vcumu",
    payload: "{\"account_number\":\"283\",\"chain_id\":\"onyx-1\",\"fee\":{\"amount\":[{\"amount\":\"24000\",\"denom\":\"ugnot\"}],\"gas\":\"20000000\"},\"memo\":\"Connect 4: Play\",\"msgs\":[{\"@type\":\"/vm.m_call\",\"args\":[\"7\",\"4\"],\"caller\":\"g1cvr48r7l7lkmvp77cr6zg2zhu26jgfwr0y8pew\",\"func\":\"Play\",\"max_deposit\":\"2000000ugnot\",\"pkg_path\":\"gno.land/r/nym-mikecito001/connect4_v2\",\"send\":\"\"}],\"sequence\":\"7\"}",
    txB64: "CnoKCi92bS5tX2NhbGwSbAooZzFjdnI0OHI3bDdsa212cDc3Y3I2emcyemh1MjZqZ2Z3cjB5OHBldxoMMjAwMDAwMHVnbm90IiZnbm8ubGFuZC9yL255bS1taWtlY2l0bzAwMS9jb25uZWN0NF92MioEUGxheTIBNzIBNBIRCIC0iRMSCjI0MDAwdWdub3QaqAEKOgoTL3RtLlB1YktleVNlY3AyNTZrMRIjCiEDXfaR2nuZGxKWWW3wcJe9zaX9aSkUWGB9jB703kvKqC4SQDcABK562JYS2BkKq1qaxPCxr4BVOuuPa/vXFolphBirAFPRkb80J4qiCGI6+S64Hru+5wXQZVGhy1Vs/eW2NT8aKGcxdXk5eXlzcmgzZjh4czVlN3puZzRkdWp4OXU1d3kwcXo3dmN1bXUiD0Nvbm5lY3QgNDogUGxheQ==",
}
const msg: CallMsg = { caller: "g1cvr48r7l7lkmvp77cr6zg2zhu26jgfwr0y8pew", send: "", max_deposit: "2000000ugnot", pkg_path: "gno.land/r/nym-mikecito001/connect4_v2", func: "Play", args: ["7", "4"] }
const base = { chainId: "onyx-1", accountNumber: "283", sequence: "7", gas: 20_000_000, feeUgnot: 24_000, memo: "Connect 4: Play", msg }

describe("sessionTx", () => {
    it("derives the address and gpub gno uses", () => {
        expect(keyFromPriv(hex(FIXTURE.privHex)).address).toBe(FIXTURE.sessionAddr)
        // The spike's on-chain session: gnokey accepted this gpub and stored this address.
        const k = newSessionKey()
        expect(k.gpub.startsWith("gpub1pgfj7ard9eg82cjtv4u4xetrwqer2dntxyfzxz3pq")).toBe(true)
        expect(k.address).toMatch(/^g1[02-9ac-hj-np-z]{38}$/)
    })

    it("builds the exact sign payload", () => {
        expect(signPayload(base)).toBe(FIXTURE.payload)
    })

    it("renders a zero fee as an empty amount list", () => {
        expect(signPayload({ ...base, feeUgnot: 0 })).toContain("\"fee\":{\"amount\":[],\"gas\":\"20000000\"}")
    })

    it("encodes the signed tx byte-for-byte like tm2-js-client", () => {
        const bytes = signSessionTx({ ...base, key: keyFromPriv(hex(FIXTURE.privHex)) })
        expect(toB64(bytes)).toBe(FIXTURE.txB64)
    })

    it("signs with the module's own key: signature verifies and is low-S", () => {
        const key = newSessionKey()
        const tx = signSessionTx({ ...base, key })
        // walk protobuf: returns the bytes of field `want` (length-delimited) in buf
        const field = (buf: Uint8Array, want: number): Uint8Array => {
            for (let i = 0; i < buf.length;) {
                const tag = buf[i++]
                let len = 0, shift = 0
                for (;;) { const c = buf[i++]; len |= (c & 127) << shift; if (c < 128) break; shift += 7 }
                if (tag === want * 8 + 2) return buf.slice(i, i + len)
                i += len
            }
            throw new Error("field not found")
        }
        const sig = field(field(tx, 3), 2)
        expect(sig.length).toBe(64)
        const digest = sha256(new TextEncoder().encode(signPayload(base)))
        expect(secp256k1.verify(sig, digest, key.pub, { prehash: false, lowS: true })).toBe(true)
        const s = BigInt("0x" + [...sig.slice(32)].map((b) => b.toString(16).padStart(2, "0")).join(""))
        expect(s <= secp256k1.Point.CURVE().n / 2n).toBe(true)
    })

    it("refuses a zero fee (signed and carried fee would disagree)", () => {
        expect(() => signSessionTx({ ...base, key: newSessionKey(), feeUgnot: 0 })).toThrow()
    })

    it("refuses inputs the payload encoder can't render safely", () => {
        expect(() => signPayload({ ...base, memo: "<script>" })).toThrow()
        expect(() => signPayload({ ...base, msg: { ...msg, args: [] } })).toThrow()
    })
})
