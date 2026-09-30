import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import { sha256Hex } from "./hash"

const ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
const EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

describe("sha256Hex", () => {
    it("hashes bytes as they are and text as its UTF-8 encoding", async () => {
        await expect(sha256Hex("abc")).resolves.toBe(ABC)
        await expect(sha256Hex(new Uint8Array([0x61, 0x62, 0x63]))).resolves.toBe(ABC)
        await expect(sha256Hex("")).resolves.toBe(EMPTY)
        await expect(sha256Hex(new Uint8Array(0))).resolves.toBe(EMPTY)
        const text = "Vérifié — 確認済み"
        await expect(sha256Hex(text)).resolves.toBe(createHash("sha256").update(text, "utf8").digest("hex"))
    })

    it("hashes only the bytes of a view that sits at an offset of a larger buffer", async () => {
        const view = new Uint8Array([0xff, 0xff, 0x61, 0x62, 0x63, 0xff]).subarray(2, 5)
        expect(view.byteOffset).toBe(2)
        expect(view.buffer.byteLength).toBe(6)
        await expect(sha256Hex(view)).resolves.toBe(ABC)
        await expect(sha256Hex(view.subarray(3))).resolves.toBe(EMPTY)
    })

    it("hashes a view over a shared buffer", async () => {
        const view = new Uint8Array(new SharedArrayBuffer(5)).subarray(1, 4)
        view.set([0x61, 0x62, 0x63])
        await expect(sha256Hex(view)).resolves.toBe(ABC)
    })
})
