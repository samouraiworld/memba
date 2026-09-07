import { describe, it, expect } from "vitest"
import { normalizeTxHashHex, txExplorerUrl, GNOSCAN_CHAIN_IDS } from "./txExplorerUrl"

// 32 bytes 0x00..0x1f — the same bytes in both wire shapes.
const HEX = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"
const B64 = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="

describe("normalizeTxHashHex", () => {
    it("passes 64-hex through as lowercase (Adena ≥1.20.5, Tendermint RPC upper hex, 0x-prefixed)", () => {
        expect(normalizeTxHashHex(HEX)).toBe(HEX)
        expect(normalizeTxHashHex(HEX.toUpperCase())).toBe(HEX)
        expect(normalizeTxHashHex(`0x${HEX.toUpperCase()}`)).toBe(HEX)
        expect(normalizeTxHashHex(`  ${HEX}\n`)).toBe(HEX)
    })
    it("decodes a base64 32-byte hash (older Adena / broadcast_tx_commit) to the same hex", () => {
        expect(normalizeTxHashHex(B64)).toBe(HEX)
    })
    it("returns null for anything that is not a 32-byte hash", () => {
        expect(normalizeTxHashHex("")).toBeNull()
        expect(normalizeTxHashHex("abc123def456789012345678")).toBeNull()
        expect(normalizeTxHashHex(HEX.slice(0, 62))).toBeNull()
        expect(normalizeTxHashHex(`${HEX}00`)).toBeNull()
        expect(normalizeTxHashHex("zz".repeat(32))).toBeNull()
        // valid base64, wrong length (16 bytes)
        expect(normalizeTxHashHex("AAECAwQFBgcICQoLDA0ODw==")).toBeNull()
        expect(normalizeTxHashHex("not base64 at all!!")).toBeNull()
    })
})

describe("txExplorerUrl", () => {
    it("builds the chain-aware gnoscan transaction URL from either hash shape", () => {
        expect(txExplorerUrl(HEX, "pearl-1")).toBe(`https://gnoscan.io/transactions/details?txhash=${HEX}&chainId=pearl-1`)
        expect(txExplorerUrl(B64, "pearl-1")).toBe(`https://gnoscan.io/transactions/details?txhash=${HEX}&chainId=pearl-1`)
        expect(txExplorerUrl(HEX, "gnoland1")).toBe(`https://gnoscan.io/transactions/details?txhash=${HEX}&chainId=gnoland1`)
    })
    it("returns null for an unrecognized hash (caller renders plain text)", () => {
        expect(txExplorerUrl("abc123def456789012345678", "pearl-1")).toBeNull()
        expect(txExplorerUrl("", "pearl-1")).toBeNull()
    })
    it("returns null for a chain gnoscan does not index (a dead link is worse than none)", () => {
        expect(txExplorerUrl(HEX, "test-13")).toBeNull()
        expect(txExplorerUrl(HEX, "")).toBeNull()
        expect(GNOSCAN_CHAIN_IDS).toContain("pearl-1")
    })
})
