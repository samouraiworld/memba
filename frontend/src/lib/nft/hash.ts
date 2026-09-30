/**
 * SHA-256 as the NFT realms write it: 64 lowercase hex digits of the exact
 * bytes. Text is hashed as its UTF-8 encoding.
 *
 * @module lib/nft/hash
 */

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data
    // The digest gets a buffer of its own holding exactly these bytes. A view may sit at an
    // offset of a larger buffer, or over a shared one, and a runtime can then refuse it or
    // hash the wrong range.
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", copy.buffer))
    return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")
}
