/**
 * The public text behind an on-chain commitment. The curation realm records a
 * (hash, CID) pair for every statement and reason; the text itself is on IPFS.
 * Nothing fetched is returned unless the SHA-256 of the exact bytes received
 * equals the hash on chain, so a gateway cannot put words in anyone's mouth.
 *
 * The failures are kept apart because a screen answers each differently: a text
 * that could not be fetched may be tried again; one that does not match its hash
 * is never shown and never retried as if the network had failed; and anything
 * else is a defect, which propagates as it is.
 *
 * @module lib/nft/evidence
 */
import { getIpfsGatewayUrl } from "../ipfs"
import { sha256Hex } from "./hash"
import { cid as parseCid, hash as parseHash } from "./parse"

const MAX_BYTES = 256 * 1024
const TIMEOUT_MS = 15_000

const FAILURES = {
    unavailable: "The committed text could not be fetched",
    too_large: "The committed text is too large to fetch",
    mismatch: "The fetched text does not match its on-chain hash",
    not_text: "The committed content is not text",
} as const

export class EvidenceError extends Error {
    /** Only `unavailable` is worth another try. */
    readonly reason: keyof typeof FAILURES

    constructor(reason: keyof typeof FAILURES, cause?: unknown) {
        super(FAILURES[reason], { cause })
        this.name = "EvidenceError"
        this.reason = reason
    }
}

/**
 * Wraps the two calls that talk to the gateway, and only them. Whatever they
 * reject with (no network, a blocked or timed-out request, a body cut short) is
 * a transport failure. Nothing else here is caught, so a defect is never
 * reported as one.
 */
function transport<T>(call: Promise<T>): Promise<T> {
    return call.catch((cause: unknown) => {
        throw new EvidenceError("unavailable", cause)
    })
}

/** At most MAX_BYTES, with TIMEOUT_MS for the answer and its body together. */
async function download(url: string): Promise<Uint8Array> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
        const response = await transport(fetch(url, { signal: controller.signal }))
        // Whatever the gateway refuses, a file it cannot find included, it may serve later.
        if (!response.ok) throw new EvidenceError("unavailable")
        if (response.body === null) return new Uint8Array(0)
        const reader = response.body.getReader()
        const bytes = new Uint8Array(MAX_BYTES)
        let size = 0
        for (;;) {
            const { done, value } = await transport(reader.read())
            if (done) return bytes.slice(0, size)
            if (size + value.length > MAX_BYTES) throw new EvidenceError("too_large")
            bytes.set(value, size)
            size += value.length
        }
    } finally {
        clearTimeout(timer)
        // Ends a download that stopped early; it changes nothing once the body was read to its end.
        controller.abort()
    }
}

/** The text exactly as it was hashed: invalid UTF-8 is refused, not repaired, and a byte order mark is kept. */
function decode(bytes: Uint8Array): string {
    try {
        return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)
    } catch (cause) {
        // A fatal decoder fails in one way only: on bytes that are not UTF-8.
        throw new EvidenceError("not_text", cause)
    }
}

/**
 * The text a (hash, CID) pair points to. Throws an EvidenceError when it cannot
 * be fetched or is not what was committed; its `reason` says which.
 */
export async function fetchCommitted(cid: string, hash: string): Promise<string> {
    // Both are checked before anything is sent: a malformed CID never reaches a URL.
    const url = getIpfsGatewayUrl(parseCid(cid, "CID"))
    const expected = parseHash(hash, "hash")
    const bytes = await download(url)
    if (await sha256Hex(bytes) !== expected) throw new EvidenceError("mismatch")
    return decode(bytes)
}
