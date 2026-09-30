import { createHash } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getIpfsGatewayUrl } from "../ipfs"
import { EvidenceError, fetchCommitted } from "./evidence"

const CID = `bafy${"b".repeat(55)}`
const TEXT = "Vérifié : l'artiste a signé ce relevé — 確認済み"
const MAX_BYTES = 256 * 1024

const utf8 = (text: string) => new TextEncoder().encode(text)
const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex")
const HASH = sha256(TEXT)

const fetchMock = vi.fn()
const serve = (body: BodyInit | null, status = 200) => fetchMock.mockResolvedValueOnce(new Response(body, { status }))
/** A body delivered in the given chunks, then closed, or cut short by `failure`. */
const chunked = (chunks: Uint8Array[], failure?: unknown) => {
    const pending = [...chunks]
    return new ReadableStream<Uint8Array>({
        pull(controller) {
            const next = pending.shift()
            if (next) controller.enqueue(next)
            else if (failure) controller.error(failure)
            else controller.close()
        },
    })
}
const failure = (promise: Promise<unknown>) => promise.then(() => { throw new Error("resolved") }, (error: unknown) => error)

beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
})

describe("committed text", () => {
    it("returns the text whose bytes hash to the commitment", async () => {
        serve(TEXT)
        await expect(fetchCommitted(CID, HASH)).resolves.toBe(TEXT)
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(fetchMock.mock.calls[0][0]).toBe(getIpfsGatewayUrl(CID))
        expect(fetchMock.mock.calls[0][0]).toMatch(new RegExp(`^https://[^/]+/ipfs/${CID}$`))
    })

    it("reads a CIDv0, and a body that arrives in pieces cut inside a character", async () => {
        const bytes = utf8(TEXT)
        serve(chunked([bytes.subarray(0, 2), bytes.subarray(2, 30), bytes.subarray(30)]))
        await expect(fetchCommitted(`Qm${"a".repeat(44)}`, HASH)).resolves.toBe(TEXT)
    })

    it("returns an empty text and keeps a byte order mark, exactly as hashed", async () => {
        serve(null)
        await expect(fetchCommitted(CID, sha256(""))).resolves.toBe("")
        serve(chunked([]))
        await expect(fetchCommitted(CID, sha256(""))).resolves.toBe("")
        const marked = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8("text")])
        serve(marked)
        await expect(fetchCommitted(CID, sha256(marked))).resolves.toBe("﻿text")
    })

    it("reads a text of exactly the size limit", async () => {
        const bytes = new Uint8Array(MAX_BYTES).fill(0x61)
        serve(chunked([bytes.subarray(0, 100_000), bytes.subarray(100_000)]))
        await expect(fetchCommitted(CID, sha256(bytes))).resolves.toHaveLength(MAX_BYTES)
    })
})

describe("text that does not match", () => {
    it.each([
        ["one changed character", TEXT.replace("signé", "signe")],
        ["a trailing newline", `${TEXT}\n`],
        ["a gateway page in place of the file", "<html><body>504 Gateway Time-out</body></html>"],
        ["nothing at all", ""],
    ])("is never returned: %s", async (_name, served) => {
        serve(served)
        const error = await failure(fetchCommitted(CID, HASH))
        expect(error).toBeInstanceOf(EvidenceError)
        expect(error).toMatchObject({ reason: "mismatch", message: "The fetched text does not match its on-chain hash" })
        // A mismatch is an answer, not a network failure: nothing is asked again.
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })
})

describe("text that could not be fetched", () => {
    const unavailable = { reason: "unavailable", message: "The committed text could not be fetched" }

    it("reports a failed request, and keeps its cause", async () => {
        const cause = new TypeError("Failed to fetch")
        fetchMock.mockRejectedValueOnce(cause)
        const error = await failure(fetchCommitted(CID, HASH))
        expect(error).toBeInstanceOf(EvidenceError)
        expect(error).toMatchObject({ ...unavailable, cause })
    })

    it.each([404, 410, 429, 500, 504])("reports a gateway answering %d, whatever its body", async (status) => {
        serve(TEXT, status)
        await expect(fetchCommitted(CID, HASH)).rejects.toMatchObject(unavailable)
    })

    it("reports a body cut short, even after bytes that matched so far", async () => {
        const cause = new TypeError("terminated")
        serve(chunked([utf8(TEXT).subarray(0, 10)], cause))
        await expect(fetchCommitted(CID, HASH)).rejects.toMatchObject({ ...unavailable, cause })
    })

    it("gives up on a gateway that does not answer in time", async () => {
        vi.useFakeTimers()
        fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")))
        }))
        const error = failure(fetchCommitted(CID, HASH))
        await vi.advanceTimersByTimeAsync(14_999)
        expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(false)
        await vi.advanceTimersByTimeAsync(1)
        await expect(error).resolves.toMatchObject(unavailable)
    })

    it("gives up on a body that stalls", async () => {
        vi.useFakeTimers()
        fetchMock.mockImplementationOnce(async (_url: string, init: RequestInit) => new Response(new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(utf8(TEXT).subarray(0, 10))
                init.signal?.addEventListener("abort", () => controller.error(new DOMException("The operation was aborted.", "AbortError")))
            },
        })))
        const error = failure(fetchCommitted(CID, HASH))
        await vi.advanceTimersByTimeAsync(15_000)
        await expect(error).resolves.toMatchObject(unavailable)
    })
})

describe("content that cannot be shown", () => {
    it("stops reading past the size limit", async () => {
        const bytes = new Uint8Array(MAX_BYTES + 1).fill(0x61)
        serve(chunked([bytes.subarray(0, MAX_BYTES), bytes.subarray(MAX_BYTES)]))
        await expect(fetchCommitted(CID, sha256(bytes))).rejects.toMatchObject({ reason: "too_large", message: "The committed text is too large to fetch" })
    })

    it("stops reading a body that never ends", async () => {
        let pulls = 0
        const chunk = new Uint8Array(64 * 1024)
        serve(new ReadableStream<Uint8Array>({ pull(controller) { pulls++; controller.enqueue(chunk) } }, { highWaterMark: 0 }))
        const error = await failure(fetchCommitted(CID, HASH))
        expect(error).toBeInstanceOf(EvidenceError)
        expect(error).toMatchObject({ reason: "too_large" })
        expect(pulls).toBeLessThanOrEqual(6)
        expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
    })

    it("refuses bytes that match the hash but are not text", async () => {
        const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe])
        serve(bytes)
        await expect(fetchCommitted(CID, sha256(bytes))).rejects.toMatchObject({ reason: "not_text", message: "The committed content is not text" })
    })
})

describe("defects and malformed commitments", () => {
    it("lets an error that is not a fetch failure through, unchanged", async () => {
        const defect = new TypeError("digest is broken")
        vi.spyOn(crypto.subtle, "digest").mockRejectedValueOnce(defect)
        serve(TEXT)
        const error = await failure(fetchCommitted(CID, HASH))
        expect(error).toBe(defect)
        expect(error).not.toBeInstanceOf(EvidenceError)
    })

    it.each([
        ["an empty CID", ""],
        ["a path in place of a CID", `${CID}/../../api`],
        ["a CID with a query", `${CID}?filename=x`],
        ["a CIDv1 that is too short", `bafy${"b".repeat(54)}`],
        ["a CIDv1 that is too long", `bafy${"b".repeat(87)}`],
        ["a CIDv1 outside base32", `bafy${"B".repeat(55)}`],
        ["a CIDv0 outside base58", `Qm${"0".repeat(44)}`],
        ["a CIDv0 of the wrong length", `Qm${"a".repeat(45)}`],
        ["a gateway URL", `https://example.org/ipfs/${CID}`],
    ])("never fetches %s", async (_name, cid) => {
        const error = await failure(fetchCommitted(cid, HASH))
        expect(error).toMatchObject({ message: "Invalid CID" })
        expect(error).not.toBeInstanceOf(EvidenceError)
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it.each(["", HASH.toUpperCase(), HASH.slice(1), `${HASH}0`, `0x${HASH.slice(2)}`])("never fetches for the malformed hash %j", async (hash) => {
        await expect(fetchCommitted(CID, hash)).rejects.toThrow(/^Invalid hash$/)
        expect(fetchMock).not.toHaveBeenCalled()
    })
})
