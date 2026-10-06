/**
 * What a collection or a token points at, turned into something a screen may
 * load. The ledger states URIs (`ipfs://` or `https://`); the files behind them
 * are written by a creator, not by the realm, so nothing read from one is
 * trusted: a URI becomes an https URL or nothing, and a metadata file yields
 * only the fields that pass their checks. An unknown key is ignored, a field
 * that does not fit is dropped, and none is repaired or filled in.
 *
 * The failures are kept apart because a screen answers each differently: a file
 * that could not be fetched may be tried again; one that is too large, is not
 * JSON, or sits where this app may not fetch never will be, and the token is
 * shown without it; and anything else is a defect, which propagates as it is.
 *
 * @module lib/nft/metadata
 */
import { getIpfsGatewayUrl } from "../ipfs"

const MAX_BYTES = 64 * 1024
const TIMEOUT_MS = 15_000
const MAX_URI = 2_048
const MAX_NAME = 200
const MAX_DESCRIPTION = 2_000
const MAX_ATTRIBUTES = 100

/** The one place files are fetched from: the app's connect-src lists the gateway and no creator's own host. */
const GATEWAY = getIpfsGatewayUrl("")

/**
 * `ipfs://<CID>` and an optional path, the CID as the NFT realms write one
 * (lib/nft/parse `cid`): CIDv1 `bafy…` or `bafk…` in base32, or CIDv0 `Qm…`.
 */
const IPFS = /^ipfs:\/\/(?:ipfs\/)?(baf[yk][a-z2-7]{55,86}|Qm[1-9A-HJ-NP-Za-km-z]{44})(\/.*)?$/

export interface NftAttribute {
    trait_type: string
    value: string | number
}

export interface NftTokenMetadata {
    name: string | null
    description: string | null
    /** Already resolved: a URL the browser may load, or null. */
    image: string | null
    attributes: NftAttribute[]
}

const FAILURES = {
    unavailable: "The token metadata could not be fetched",
    too_large: "The token metadata is too large to fetch",
    not_json: "The token metadata is not a JSON object",
    unsupported: "The token metadata is not at an address this app can fetch",
} as const

export class TokenMetadataError extends Error {
    /** Only `unavailable` is worth another try. */
    readonly reason: keyof typeof FAILURES

    constructor(reason: keyof typeof FAILURES, cause?: unknown) {
        super(FAILURES[reason], { cause })
        this.name = "TokenMetadataError"
        this.reason = reason
    }
}

function parseUrl(text: string): URL | null {
    try {
        return new URL(text)
    } catch {
        // The constructor fails in one way only: on text that is not a URL.
        return null
    }
}

/** Printable ASCII only, as the realm requires of an image: the URL parser would strip or re-encode anything else. */
const printable = (uri: string) => uri.length <= MAX_URI && /^[\x21-\x7e]+$/.test(uri)

/**
 * An https link a creator wrote (a website), in the form the browser will
 * open, or null. Every other scheme, and credentials in the URL, are refused.
 */
export function webUrl(uri: string): string | null {
    if (!printable(uri) || !uri.startsWith("https://")) return null
    const url = parseUrl(uri)
    return url !== null && url.protocol === "https:" && url.username === "" && url.password === "" ? url.href : null
}

/**
 * The URL the browser may load for a collection image, a banner or a token
 * image, or null when the URI is not one this client renders. Only IPFS is
 * loaded: `ipfs://` goes through the gateway, an https URL only when it is
 * already the gateway's, and anything else (a creator's own host, `data:`,
 * `javascript:`…) is refused, so no host learns who views a token.
 */
export function mediaUrl(uri: string): string | null {
    if (!printable(uri)) return null
    const ipfs = IPFS.exec(uri)
    if (ipfs) {
        const root = getIpfsGatewayUrl(ipfs[1])
        const url = parseUrl(root + (ipfs[2] ?? ""))
        // A query or a fragment is not part of a file's address in the CID's directory.
        if (url !== null) { url.search = ""; url.hash = "" }
        // Dot segments, encoded or not, must not climb out of the CID's own directory.
        return url !== null && (url.href === root || url.href.startsWith(`${root}/`)) ? url.href : null
    }
    const url = webUrl(uri)
    return url !== null && url.startsWith(GATEWAY) ? url : null
}

/**
 * Wraps the two calls that talk to the gateway, and only them. Whatever they
 * reject with (no network, a blocked or timed-out request, a body cut short) is
 * a transport failure, unless the caller itself gave up: then it gets its own
 * reason back. Nothing else here is caught, so a defect is never reported as one.
 */
function transport<T>(call: Promise<T>, signal?: AbortSignal): Promise<T> {
    return call.catch((cause: unknown) => {
        signal?.throwIfAborted()
        throw new TokenMetadataError("unavailable", cause)
    })
}

/** At most MAX_BYTES, with TIMEOUT_MS for the answer and its body together. */
async function download(url: string, signal?: AbortSignal): Promise<Uint8Array> {
    signal?.throwIfAborted()
    const controller = new AbortController()
    const stop = () => controller.abort()
    const timer = setTimeout(stop, TIMEOUT_MS)
    signal?.addEventListener("abort", stop)
    try {
        // No redirect away from the gateway, and no cookie or credential sent with the request.
        const response = await transport(fetch(url, { signal: controller.signal, redirect: "error", credentials: "omit" }), signal)
        // Whatever the gateway refuses, a file it cannot find included, it may serve later.
        if (!response.ok) throw new TokenMetadataError("unavailable")
        if (response.body === null) return new Uint8Array(0)
        const reader = response.body.getReader()
        const bytes = new Uint8Array(MAX_BYTES)
        let size = 0
        for (;;) {
            const { done, value } = await transport(reader.read(), signal)
            if (done) return bytes.slice(0, size)
            if (size + value.length > MAX_BYTES) throw new TokenMetadataError("too_large")
            bytes.set(value, size)
            size += value.length
        }
    } finally {
        clearTimeout(timer)
        signal?.removeEventListener("abort", stop)
        // Ends a download that stopped early; it changes nothing once the body was read to its end.
        controller.abort()
    }
}

/**
 * Control characters and the bidi overrides and isolates that could reorder
 * what a screen shows around a creator's text. A description keeps its line breaks.
 */
const UNSAFE = /(?!\n)[\p{Cc}\u202a-\u202e\u2066-\u2069]/gu
const UNSAFE_INLINE = /[\p{Cc}\u202a-\u202e\u2066-\u2069]/gu

function bounded(value: unknown, max: number, lines = false): string | null {
    return typeof value === "string" && value.length <= max ? value.replace(lines ? UNSAFE : UNSAFE_INLINE, "") : null
}

/** One trait, rebuilt from its two checked fields, or nothing: an entry that does not fit is dropped. */
function attribute(entry: unknown): NftAttribute[] {
    if (entry === null || typeof entry !== "object") return []
    const { trait_type, value } = entry as Record<string, unknown>
    const type = bounded(trait_type, MAX_NAME)
    if (type === null) return []
    if (typeof value === "string") {
        const text = bounded(value, MAX_NAME)
        return text === null ? [] : [{ trait_type: type, value: text }]
    }
    // JSON has no NaN, but a number too large for a double parses to Infinity, and a whole number past 2^53 is not the one written.
    const fits = typeof value === "number" && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))
    return fits ? [{ trait_type: type, value }] : []
}

function parse(bytes: Uint8Array): NftTokenMetadata {
    let file: unknown
    try {
        file = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
    } catch (cause) {
        // The two calls fail in one way each: on bytes that are not UTF-8, and on text that is not JSON.
        throw new TokenMetadataError("not_json", cause)
    }
    if (file === null || typeof file !== "object" || Array.isArray(file)) throw new TokenMetadataError("not_json")
    const { name, description, image, attributes } = file as Record<string, unknown>
    return {
        name: bounded(name, MAX_NAME),
        description: bounded(description, MAX_DESCRIPTION, true),
        image: typeof image === "string" ? mediaUrl(image) : null,
        attributes: Array.isArray(attributes) ? attributes.flatMap(attribute).slice(0, MAX_ATTRIBUTES) : [],
    }
}

/**
 * The metadata file a token URI points to. Throws a TokenMetadataError when it
 * cannot be fetched or is not a metadata file; its `reason` says which. A
 * caller that aborts gets its signal's own reason, not a failure.
 */
export async function fetchTokenMetadata(uri: string, signal?: AbortSignal): Promise<NftTokenMetadata> {
    const url = mediaUrl(uri)
    // Checked before anything is sent: a request the policy would block is not a network failure to retry.
    if (url === null || !url.startsWith(GATEWAY)) throw new TokenMetadataError("unsupported")
    return parse(await download(url, signal))
}
