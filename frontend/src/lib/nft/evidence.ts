/**
 * The public text behind an on-chain commitment, and pinning a new one. The curation realm records a
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
import { API_BASE_URL } from "../config"
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

/** What a curation call commits for a text: where it is pinned, and the SHA-256 of its exact UTF-8 bytes. */
export interface Commitment {
    cid: string
    hash: string
}

/** The backend's limit for one statement or reason. */
export const MAX_EVIDENCE_BYTES = 16 * 1024

/**
 * Pins a statement or a reason as UTF-8 text through the backend's
 * authenticated proxy and returns the pair a curation call commits. Pinned
 * text is public. The answer is checked before anything is signed with it:
 * the hash must be the SHA-256 of the bytes sent, and the CID one the realm
 * accepts.
 */
export async function pinEvidence(text: string): Promise<Commitment> {
    const bytes = new TextEncoder().encode(text)
    if (text.trim() === "") throw new Error("Write the text first.")
    if (bytes.length > MAX_EVIDENCE_BYTES) throw new Error("The text is longer than 16 KB.")
    const token = localStorage.getItem("memba_auth_token")
    let response: Response
    try {
        response = await fetch(`${API_BASE_URL || ""}/api/upload/curation-evidence`, {
            method: "POST",
            headers: { "Content-Type": "text/plain; charset=utf-8", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: bytes,
        })
    } catch (cause) {
        throw new Error("The text could not be pinned: the server did not answer. Try again.", { cause })
    }
    if (response.status === 401) throw new Error("Sign in again to pin the text.")
    if (!response.ok) throw new Error(`The text could not be pinned (${response.status}). Try again.`)
    const answer: unknown = await response.json().catch(() => null)
    const fields = (answer ?? {}) as { cid?: unknown; sha256?: unknown }
    const commitment = { cid: parseCid(fields.cid, "pinned CID"), hash: parseHash(fields.sha256, "pinned hash") }
    if (commitment.hash !== await sha256Hex(bytes)) throw new Error("The pinned text's hash does not match the text sent.")
    return commitment
}
