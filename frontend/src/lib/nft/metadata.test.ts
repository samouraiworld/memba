import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getIpfsGatewayUrl } from "../ipfs"
import { TokenMetadataError, fetchTokenMetadata, mediaUrl, webUrl } from "./metadata"

const CID = `bafy${"b".repeat(55)}`
const RAW_CID = `bafk${"c".repeat(55)}`
const CID_V0 = `Qm${"a".repeat(44)}`
const TOKEN_URI = `ipfs://${CID}/7.json`
const MAX_BYTES = 64 * 1024

const fetchMock = vi.fn()
const serve = (body: BodyInit | null, status = 200) => fetchMock.mockResolvedValueOnce(new Response(body, { status }))
const serveJson = (file: unknown) => serve(JSON.stringify(file))
const failure = (promise: Promise<unknown>) => promise.then(() => { throw new Error("resolved") }, (error: unknown) => error)
/** A request that never answers, and rejects as a browser's does once its signal aborts. */
const hang = (_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")))
})

beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
})

describe("media URL", () => {
    it.each([
        ["a file in a directory", `ipfs://${CID}/7.png`, `${getIpfsGatewayUrl(CID)}/7.png`],
        ["a bare CID", `ipfs://${CID}`, getIpfsGatewayUrl(CID)],
        ["a CIDv0", `ipfs://${CID_V0}/art/7.png`, `${getIpfsGatewayUrl(CID_V0)}/art/7.png`],
        ["a raw block", `ipfs://${RAW_CID}`, getIpfsGatewayUrl(RAW_CID)],
        ["the older ipfs://ipfs/ form", `ipfs://ipfs/${CID}/7.png`, `${getIpfsGatewayUrl(CID)}/7.png`],
        ["dot segments that stay inside the CID", `ipfs://${CID}/a/../7.png`, `${getIpfsGatewayUrl(CID)}/7.png`],
        ["a file with a query and a fragment, both dropped", `ipfs://${CID}/7.png?download=1#top`, `${getIpfsGatewayUrl(CID)}/7.png`],
    ])("sends %s through the gateway", (_name, uri, url) => {
        expect(mediaUrl(uri)).toBe(url)
        expect(url).toMatch(/^https:\/\/[^/]+\/ipfs\//)
    })

    it("loads no image from a creator's own host, but keeps it as a link in the form the browser will open", () => {
        for (const uri of ["https://example.org/art/7.png?size=l#top", "https://EXAMPLE.org", "https://example.org:8443/a'b.png"]) {
            expect(mediaUrl(uri)).toBeNull()
        }
        expect(webUrl("https://example.org/art/7.png?size=l#top")).toBe("https://example.org/art/7.png?size=l#top")
        expect(webUrl("https://EXAMPLE.org")).toBe("https://example.org/")
        expect(webUrl("https://example.org:8443/a'b.png")).toBe("https://example.org:8443/a'b.png")
        expect(webUrl("https://user:pass@example.org/")).toBeNull()
        expect(webUrl(`ipfs://${CID}`)).toBeNull()
    })

    it("answers the same for a URL it has already resolved", () => {
        const url = mediaUrl(`ipfs://${CID}/7.png`)
        expect(url).not.toBeNull()
        expect(mediaUrl(url as string)).toBe(url)
    })

    it.each([
        ["nothing", ""],
        ["a script", "javascript:alert(1)"],
        ["a script split by a line break", "java\nscript:alert(1)"],
        ["inline data", "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>"],
        ["plain http", "http://example.org/7.png"],
        ["a blob", "blob:https://example.org/0b9d7f2e"],
        ["a local file", "file:///etc/passwd"],
        ["ftp", "ftp://example.org/7.png"],
        ["an upper-case scheme", "HTTPS://example.org/7.png"],
        ["https with one slash", "https:/example.org/7.png"],
        ["https with no slash", "https:example.org/7.png"],
        ["https with no host", "https://"],
        ["a malformed host", "https://[bad/7.png"],
        ["a port out of range", "https://example.org:99999/7.png"],
        ["a protocol-relative URL", "//example.org/7.png"],
        ["a path", "/art/7.png"],
        ["a bare host", "example.org/7.png"],
        ["credentials", "https://user:pass@example.org/7.png"],
        ["a user name", "https://example.org@evil.example/7.png"],
        ["a leading space", " https://example.org/7.png"],
        ["a trailing line break", "https://example.org/7.png\n"],
        ["a space", "https://example.org/my art.png"],
        ["a tab inside the scheme", "ht\ttps://example.org/7.png"],
        ["a character outside ASCII", "https://example.org/é.png"],
        ["a URL longer than 2,048 characters", `https://example.org/${"a".repeat(2_029)}`],
        ["ipfs with no CID", "ipfs://"],
        ["ipfs with a name in place of a CID", "ipfs://bafyrevealed/7.png"],
        ["a CIDv0 outside base58", `ipfs://Qm${"0".repeat(44)}`],
        ["a CIDv1 outside base32", `ipfs://bafy${"B".repeat(55)}`],
        ["a CIDv1 of a codec the NFT realms do not write", `ipfs://bafz${"b".repeat(55)}`],
        ["a CIDv1 that is too short", `ipfs://bafy${"b".repeat(54)}`],
        ["a CID followed by a query", `ipfs://${CID}?filename=x`],
        ["an upper-case ipfs scheme", `IPFS://${CID}`],
        ["a path that climbs out of the CID", `ipfs://${CID}/../../api`],
        ["an encoded path that climbs out of the CID", `ipfs://${CID}/%2e%2e/%2E%2E/api`],
        ["a path that climbs into another CID", `ipfs://${CID}/../${CID_V0}/7.png`],
    ])("refuses %s", (_name, uri) => {
        expect(mediaUrl(uri)).toBeNull()
    })

    it("accepts a URL of exactly 2,048 characters", () => {
        expect(webUrl(`https://example.org/${"a".repeat(2_028)}`)).toHaveLength(2_048)
    })
})

describe("token metadata", () => {
    it("fetches the file from the gateway and returns its checked fields", async () => {
        serveJson({
            name: "Relevé #7",
            description: "Signé — 確認済み",
            image: `ipfs://${RAW_CID}`,
            attributes: [{ trait_type: "Paper", value: "Laid" }, { trait_type: "Edition", value: 7 }],
        })
        await expect(fetchTokenMetadata(TOKEN_URI)).resolves.toEqual({
            name: "Relevé #7",
            description: "Signé — 確認済み",
            image: getIpfsGatewayUrl(RAW_CID),
            attributes: [{ trait_type: "Paper", value: "Laid" }, { trait_type: "Edition", value: 7 }],
        })
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(fetchMock.mock.calls[0][0]).toBe(`${getIpfsGatewayUrl(CID)}/7.json`)
    })

    it("fetches a gateway URL as it is, and drops an image on the creator's own host", async () => {
        serveJson({ image: "https://example.org/7.png" })
        await expect(fetchTokenMetadata(`${getIpfsGatewayUrl(CID)}/7.json`)).resolves.toMatchObject({ image: null })
        expect(fetchMock.mock.calls[0][0]).toBe(`${getIpfsGatewayUrl(CID)}/7.json`)
    })

    it("ignores keys it does not use, on the file and on a trait", async () => {
        serve(`{"name":"Seven","animation_url":"javascript:alert(1)","external_url":"https://example.org","__proto__":{"description":"polluted"},`
            + `"attributes":[{"trait_type":"Level","value":3,"display_type":"boost_number","max_value":9}]}`)
        const metadata = await fetchTokenMetadata(TOKEN_URI)
        expect(metadata).toEqual({ name: "Seven", description: null, image: null, attributes: [{ trait_type: "Level", value: 3 }] })
        expect(Object.keys(metadata)).toEqual(["name", "description", "image", "attributes"])
        expect(Object.keys(metadata.attributes[0])).toEqual(["trait_type", "value"])
    })

    it("leaves what the file does not state empty", async () => {
        serveJson({})
        await expect(fetchTokenMetadata(TOKEN_URI)).resolves.toEqual({ name: null, description: null, image: null, attributes: [] })
    })

    it("keeps a text of exactly its limit, and an empty one", async () => {
        serveJson({ name: "n".repeat(200), description: "d".repeat(2_000) })
        await expect(fetchTokenMetadata(TOKEN_URI)).resolves.toMatchObject({ name: "n".repeat(200), description: "d".repeat(2_000) })
        serveJson({ name: "", description: "" })
        await expect(fetchTokenMetadata(TOKEN_URI)).resolves.toMatchObject({ name: "", description: "" })
    })

    it.each([
        ["a name that is a number", { name: 7 }, { name: null }],
        ["a name that is a list", { name: ["Seven"] }, { name: null }],
        ["a name that is null", { name: null }, { name: null }],
        ["a name of 201 characters", { name: "n".repeat(201) }, { name: null }],
        ["a description that is an object", { description: { en: "text" } }, { description: null }],
        ["a description that is a boolean", { description: true }, { description: null }],
        ["a description of 2,001 characters", { description: "d".repeat(2_001) }, { description: null }],
        ["an image that is a number", { image: 7 }, { image: null }],
        ["an image that is a list", { image: [`ipfs://${CID}`] }, { image: null }],
        ["an image that is a script", { image: "javascript:alert(1)" }, { image: null }],
        ["an image that is inline data", { image: "data:image/png;base64,AAAA" }, { image: null }],
        ["an image over plain http", { image: "http://example.org/7.png" }, { image: null }],
        ["attributes that are an object", { attributes: { Paper: "Laid" } }, { attributes: [] }],
        ["attributes that are a text", { attributes: "Paper=Laid" }, { attributes: [] }],
        ["attributes that are null", { attributes: null }, { attributes: [] }],
    ])("drops %s, and keeps the rest", async (_name, fields, expected) => {
        serveJson({ name: "Seven", description: "A token", image: `ipfs://${CID}/7.png`, attributes: [{ trait_type: "Paper", value: "Laid" }], ...fields })
        await expect(fetchTokenMetadata(TOKEN_URI)).resolves.toEqual({
            name: "Seven",
            description: "A token",
            image: `${getIpfsGatewayUrl(CID)}/7.png`,
            attributes: [{ trait_type: "Paper", value: "Laid" }],
            ...expected,
        })
    })

    it("drops every trait that does not fit, without repairing one", async () => {
        serve(`{"attributes":[
            null, "Paper=Laid", 7, ["Paper", "Laid"], {},
            {"trait_type":"Paper"},
            {"value":"Laid"},
            {"trait_type":7,"value":"Laid"},
            {"trait_type":null,"value":"Laid"},
            {"trait_type":"Signed","value":true},
            {"trait_type":"Signed","value":null},
            {"trait_type":"Signed","value":{"by":"artist"}},
            {"trait_type":"Signed","value":["artist"]},
            {"trait_type":"Weight","value":1e999},
            {"trait_type":"Serial","value":9007199254740993},
            {"trait_type":"${"t".repeat(201)}","value":"Laid"},
            {"trait_type":"Paper","value":"${"v".repeat(201)}"},
            {"trait_type":"Paper","value":"Laid"},
            {"trait_type":"","value":""},
            {"trait_type":"Edition","value":0},
            {"trait_type":"Ratio","value":-1.5}
        ]}`)
        await expect(fetchTokenMetadata(TOKEN_URI)).resolves.toMatchObject({
            attributes: [
                { trait_type: "Paper", value: "Laid" },
                { trait_type: "", value: "" },
                { trait_type: "Edition", value: 0 },
                { trait_type: "Ratio", value: -1.5 },
            ],
        })
    })

    it("strips control characters and bidi overrides from every text, keeping a description's line breaks", async () => {
        serveJson({
            name: "Rel\u202eevé\u0007",
            description: "Line one\nLine\u2066 two\u2069\r",
            attributes: [{ trait_type: "Pa\u0000per", value: "La\u202aid" }],
        })
        await expect(fetchTokenMetadata(TOKEN_URI)).resolves.toMatchObject({
            name: "Relevé",
            description: "Line one\nLine two",
            attributes: [{ trait_type: "Paper", value: "Laid" }],
        })
    })

    it("asks the gateway with no redirect allowed and no credential sent", async () => {
        serveJson({ name: "Seven" })
        await fetchTokenMetadata(TOKEN_URI)
        expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "error", credentials: "omit" })
    })

    it("keeps the first 100 traits that fit", async () => {
        const traits = Array.from({ length: 120 }, (_unused, index) => ({ trait_type: `T${index}`, value: index }))
        serveJson({ attributes: [{ trait_type: 7, value: "dropped" }, ...traits] })
        const { attributes } = await fetchTokenMetadata(TOKEN_URI)
        expect(attributes).toEqual(traits.slice(0, 100))
    })

    it("reads a file of exactly the size limit, and one that starts with a byte order mark", async () => {
        const open = `{"name":"Seven","padding":"`
        const bytes = new TextEncoder().encode(`${open}${"a".repeat(MAX_BYTES - open.length - 2)}"}`)
        expect(bytes).toHaveLength(MAX_BYTES)
        serve(bytes)
        await expect(fetchTokenMetadata(TOKEN_URI)).resolves.toMatchObject({ name: "Seven" })
        serve(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(`{"name":"Seven"}`)]))
        await expect(fetchTokenMetadata(TOKEN_URI)).resolves.toMatchObject({ name: "Seven" })
    })
})

describe("metadata that could not be fetched", () => {
    const unavailable = { reason: "unavailable", message: "The token metadata could not be fetched" }

    it("reports a failed request, and keeps its cause", async () => {
        const cause = new TypeError("Failed to fetch")
        fetchMock.mockRejectedValueOnce(cause)
        const error = await failure(fetchTokenMetadata(TOKEN_URI))
        expect(error).toBeInstanceOf(TokenMetadataError)
        expect(error).toMatchObject({ ...unavailable, cause })
    })

    it.each([404, 410, 429, 500, 504])("reports a gateway answering %d, whatever its body", async (status) => {
        serve(`{"name":"Seven"}`, status)
        await expect(fetchTokenMetadata(TOKEN_URI)).rejects.toMatchObject(unavailable)
    })

    it("reports a body cut short", async () => {
        const cause = new TypeError("terminated")
        serve(new ReadableStream<Uint8Array>({
            start(controller) { controller.enqueue(new TextEncoder().encode(`{"name":`)) },
            pull(controller) { controller.error(cause) },
        }))
        await expect(fetchTokenMetadata(TOKEN_URI)).rejects.toMatchObject({ ...unavailable, cause })
    })

    it("gives up on a gateway that does not answer in time", async () => {
        vi.useFakeTimers()
        fetchMock.mockImplementationOnce(hang)
        const error = failure(fetchTokenMetadata(TOKEN_URI))
        await vi.advanceTimersByTimeAsync(14_999)
        expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(false)
        await vi.advanceTimersByTimeAsync(1)
        await expect(error).resolves.toMatchObject(unavailable)
    })

    it("gives up on a body that stalls", async () => {
        vi.useFakeTimers()
        fetchMock.mockImplementationOnce(async (_url: string, init: RequestInit) => new Response(new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new TextEncoder().encode(`{"name":`))
                init.signal?.addEventListener("abort", () => controller.error(new DOMException("The operation was aborted.", "AbortError")))
            },
        })))
        const error = failure(fetchTokenMetadata(TOKEN_URI))
        await vi.advanceTimersByTimeAsync(15_000)
        await expect(error).resolves.toMatchObject(unavailable)
    })
})

describe("a caller that gives up", () => {
    it("gets its own reason back, not a failure to retry, and the request is ended", async () => {
        const caller = new AbortController()
        fetchMock.mockImplementationOnce(hang)
        const error = failure(fetchTokenMetadata(TOKEN_URI, caller.signal))
        caller.abort()
        expect(await error).toBe(caller.signal.reason)
        expect(await error).not.toBeInstanceOf(TokenMetadataError)
        expect(await error).toMatchObject({ name: "AbortError" })
        expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
    })

    it("sends nothing when it had given up already", async () => {
        const reason = new Error("window closed")
        await expect(fetchTokenMetadata(TOKEN_URI, AbortSignal.abort(reason))).rejects.toBe(reason)
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it("changes nothing when it never gives up", async () => {
        serveJson({ name: "Seven" })
        await expect(fetchTokenMetadata(TOKEN_URI, new AbortController().signal)).resolves.toMatchObject({ name: "Seven" })
    })
})

describe("a file that is not metadata", () => {
    it("stops reading past the size limit", async () => {
        const bytes = new Uint8Array(MAX_BYTES + 1).fill(0x20)
        serve(new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(bytes.subarray(0, MAX_BYTES))
                controller.enqueue(bytes.subarray(MAX_BYTES))
                controller.close()
            },
        }))
        const error = await failure(fetchTokenMetadata(TOKEN_URI))
        expect(error).toBeInstanceOf(TokenMetadataError)
        expect(error).toMatchObject({ reason: "too_large", message: "The token metadata is too large to fetch" })
    })

    it("stops reading a body that never ends", async () => {
        let pulls = 0
        const chunk = new Uint8Array(16 * 1024)
        serve(new ReadableStream<Uint8Array>({ pull(controller) { pulls++; controller.enqueue(chunk) } }, { highWaterMark: 0 }))
        await expect(fetchTokenMetadata(TOKEN_URI)).rejects.toMatchObject({ reason: "too_large" })
        expect(pulls).toBeLessThanOrEqual(6)
        expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
    })

    it.each([
        ["a gateway page", "<html><body>504 Gateway Time-out</body></html>"],
        ["an empty file", ""],
        ["JSON cut short", `{"name":"Seven"`],
        ["a list", `[{"name":"Seven"}]`],
        ["a text", `"Seven"`],
        ["a number", "7"],
        ["null", "null"],
        ["an image", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe])],
        ["JSON in bytes that are not UTF-8", new Uint8Array([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d])],
    ])("refuses %s", async (_name, body) => {
        serve(body)
        const error = await failure(fetchTokenMetadata(TOKEN_URI))
        expect(error).toBeInstanceOf(TokenMetadataError)
        expect(error).toMatchObject({ reason: "not_json", message: "The token metadata is not a JSON object" })
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it("serves an empty body as not JSON too", async () => {
        serve(null)
        await expect(fetchTokenMetadata(TOKEN_URI)).rejects.toMatchObject({ reason: "not_json" })
    })
})

describe("a URI this app cannot fetch", () => {
    it.each([
        ["a creator's own https host, which the policy does not list", "https://example.org/meta/7.json"],
        ["the gateway outside /ipfs/", "https://gateway.lighthouse.storage/api/7.json"],
        ["a gateway URL that climbs out of /ipfs/", `${getIpfsGatewayUrl(CID)}/../../api/7.json`],
        ["a host that only starts like the gateway", "https://gateway.lighthouse.storage.evil.example/ipfs/7.json"],
        ["plain http", `http://gateway.lighthouse.storage/ipfs/${CID}/7.json`],
        ["a script", "javascript:alert(1)"],
        ["inline data", `data:application/json,{"name":"Seven"}`],
        ["a name in place of a CID", "ipfs://bafyrevealed/7.json"],
        ["nothing", ""],
    ])("never asks for %s", async (_name, uri) => {
        const error = await failure(fetchTokenMetadata(uri))
        expect(error).toBeInstanceOf(TokenMetadataError)
        expect(error).toMatchObject({ reason: "unsupported", message: "The token metadata is not at an address this app can fetch" })
        expect(fetchMock).not.toHaveBeenCalled()
    })
})

describe("defects", () => {
    it("lets an error that is not a fetch failure through, unchanged", async () => {
        const defect = new TypeError("fetch is not what it was")
        fetchMock.mockImplementationOnce(() => { throw defect })
        const error = await failure(fetchTokenMetadata(TOKEN_URI))
        expect(error).toBe(defect)
        expect(error).not.toBeInstanceOf(TokenMetadataError)
    })

    it("lets a body that cannot be read through, unchanged", async () => {
        const body = new ReadableStream<Uint8Array>()
        body.getReader()
        fetchMock.mockResolvedValueOnce({ ok: true, body })
        const error = await failure(fetchTokenMetadata(TOKEN_URI))
        expect(error).toBeInstanceOf(TypeError)
        expect(error).not.toBeInstanceOf(TokenMetadataError)
    })
})
