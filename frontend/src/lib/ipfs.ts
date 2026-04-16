/**
 * IPFS Client — Provider-agnostic IPFS pinning for avatar uploads.
 *
 * v2.1a: Primary provider is Lighthouse (5GB free tier).
 * Uses the Lighthouse REST API directly (no SDK dependency).
 *
 * Image preprocessing:
 * - Resize to 256×256 max before upload
 * - File size cap: 512KB after resize
 * - MIME validation: image/jpeg, image/png, image/webp, image/gif
 *
 * @module lib/ipfs
 */

// ── Types ─────────────────────────────────────────────────────

export interface IpfsPinResult {
    /** Content identifier on IPFS. */
    cid: string
    /** Full gateway URL for the pinned content. */
    url: string
}

// ── Constants ─────────────────────────────────────────────────

const MAX_UPLOAD_BYTES = 512 * 1024 // 512KB
const MAX_DIMENSION = 256
const LIGHTHOUSE_UPLOAD_URL = "https://node.lighthouse.storage/api/v0/add"
const IPFS_GATEWAYS = [
    "https://gateway.lighthouse.storage/ipfs",
    "https://ipfs.io/ipfs",
    "https://dweb.link/ipfs",
] as const

const ACCEPTED_MIMES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
])

// ── Validation ────────────────────────────────────────────────

/** Check if a MIME type is supported for avatar uploads. */
export function isValidImageMime(mime: string): boolean {
    return ACCEPTED_MIMES.has(mime)
}

/** Validate a CID (CIDv1 base32 bafy... or CIDv0 Qm... format check). */
export function isValidCid(cid: string): boolean {
    return /^(bafy[a-z2-7]{55,}|Qm[a-zA-Z0-9]{44,})$/.test(cid)
}

// ── IPFS Gateway URL ──────────────────────────────────────────

/** Get the primary gateway URL for a CID. */
export function getIpfsGatewayUrl(cid: string): string {
    return `${IPFS_GATEWAYS[0]}/${cid}`
}

/** Get all gateway URLs for a CID (primary first, fallbacks after). */
export function getIpfsGatewayUrls(cid: string): string[] {
    return IPFS_GATEWAYS.map(gw => `${gw}/${cid}`)
}

/**
 * Fetch from IPFS with automatic gateway fallback.
 * Tries each gateway in order until one succeeds.
 */
export async function fetchFromIpfs(cid: string): Promise<Response> {
    const urls = getIpfsGatewayUrls(cid)
    let lastError: Error | null = null
    for (const url of urls) {
        try {
            const resp = await fetch(url, { signal: AbortSignal.timeout(8000) })
            if (resp.ok) return resp
        } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err))
        }
    }
    throw lastError || new Error("All IPFS gateways failed")
}

/** Resolve an avatar URL — handles ipfs:// protocol and CIDs. */
export function resolveAvatarUrl(url: string): string {
    if (!url) return ""
    if (url.startsWith("ipfs://")) return getIpfsGatewayUrl(url.replace("ipfs://", ""))
    if (isValidCid(url)) return getIpfsGatewayUrl(url)
    return url // regular HTTP URL
}

/**
 * Handle avatar image load error by trying the next IPFS gateway.
 * Attach to `<img onError>`. Cycles through gateways once per CID.
 */
export function handleAvatarError(e: React.SyntheticEvent<HTMLImageElement>): void {
    const img = e.currentTarget
    const src = img.src
    // Find which gateway index we're currently on
    const idx = IPFS_GATEWAYS.findIndex(gw => src.startsWith(gw))
    if (idx >= 0 && idx < IPFS_GATEWAYS.length - 1) {
        // Extract CID from current URL and try next gateway
        const cid = src.replace(`${IPFS_GATEWAYS[idx]}/`, "")
        img.src = `${IPFS_GATEWAYS[idx + 1]}/${cid}`
    }
    // If we've exhausted all gateways or URL isn't IPFS, do nothing (let it fail)
}

// ── Image Preprocessing ───────────────────────────────────────

/**
 * Resize an image to max 256×256 and convert to WebP.
 * Uses OffscreenCanvas if available, falls back to regular canvas.
 * Returns a Blob ready for upload.
 */
export async function preprocessImage(file: File): Promise<Blob> {
    if (!isValidImageMime(file.type)) {
        throw new Error(`Unsupported image type: ${file.type}`)
    }

    // Create image bitmap
    const bitmap = await createImageBitmap(file)
    const { width, height } = bitmap

    // Calculate target dimensions (fit within MAX_DIMENSION × MAX_DIMENSION)
    let targetW = width
    let targetH = height
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        const scale = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height)
        targetW = Math.round(width * scale)
        targetH = Math.round(height * scale)
    }

    // Draw to canvas (OffscreenCanvas preferred, HTMLCanvasElement fallback for Safari < 16.4)
    let blob: Blob
    if (typeof OffscreenCanvas !== "undefined") {
        const canvas = new OffscreenCanvas(targetW, targetH)
        const ctx = canvas.getContext("2d")
        if (!ctx) throw new Error("Canvas 2D context not available")
        ctx.drawImage(bitmap, 0, 0, targetW, targetH)
        bitmap.close()
        blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.85 })
    } else {
        // Fallback for browsers without OffscreenCanvas (Safari < 16.4)
        const canvas = document.createElement("canvas")
        canvas.width = targetW
        canvas.height = targetH
        const ctx = canvas.getContext("2d")
        if (!ctx) throw new Error("Canvas 2D context not available")
        ctx.drawImage(bitmap, 0, 0, targetW, targetH)
        bitmap.close()
        blob = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob(
                (b) => b ? resolve(b) : reject(new Error("toBlob failed")),
                "image/webp",
                0.85,
            )
        })
    }

    if (blob.size > MAX_UPLOAD_BYTES) {
        throw new Error(`Image too large after resize (${(blob.size / 1024).toFixed(0)}KB). Max: ${MAX_UPLOAD_BYTES / 1024}KB`)
    }

    return blob
}

// ── Lighthouse Upload ─────────────────────────────────────────

/**
 * Upload a file to IPFS via the backend proxy.
 * The proxy keeps the Lighthouse API key server-side.
 *
 * @param file - File or Blob to upload
 * @returns Pin result with CID and gateway URL
 */
async function uploadViaProxy(file: File | Blob): Promise<IpfsPinResult> {
    const { API_BASE_URL } = await import("./config")
    const backendUrl = API_BASE_URL || ""

    const formData = new FormData()
    const filename = file instanceof File ? file.name : "avatar.webp"
    formData.append("file", file, filename)

    // v6 SEC-02: auth required to prevent API key abuse
    const tokenRaw = localStorage.getItem("memba_auth_token")
    const headers: Record<string, string> = {}
    if (tokenRaw) {
        headers["Authorization"] = `Bearer ${tokenRaw}`
    }

    const response = await fetch(`${backendUrl}/api/upload/avatar`, {
        method: "POST",
        headers,
        body: formData,
    })

    if (!response.ok) {
        const text = await response.text().catch(() => "Unknown error")
        throw new Error(`Avatar upload failed (${response.status}): ${text}`)
    }

    const data = await response.json()
    const cid = data.cid

    if (!cid) {
        throw new Error("Upload returned no CID")
    }

    return {
        cid,
        url: getIpfsGatewayUrl(cid),
    }
}

/**
 * Upload a file to IPFS via Lighthouse REST API.
 * Does NOT require the @lighthouse-web3/sdk — uses direct HTTP multipart.
 *
 * @param file - File or Blob to upload
 * @param apiKey - Lighthouse API key (from VITE_LIGHTHOUSE_API_KEY)
 * @returns Pin result with CID and gateway URL
 */
export async function uploadToLighthouse(file: File | Blob, apiKey: string): Promise<IpfsPinResult> {
    // If no API key provided, use the backend proxy instead
    if (!apiKey) {
        return uploadViaProxy(file)
    }

    const formData = new FormData()
    const filename = file instanceof File ? file.name : "avatar.webp"
    formData.append("file", file, filename)

    const response = await fetch(LIGHTHOUSE_UPLOAD_URL, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
    })

    if (!response.ok) {
        const text = await response.text().catch(() => "Unknown error")
        throw new Error(`Lighthouse upload failed (${response.status}): ${text}`)
    }

    const data = await response.json()
    const cid = data.Hash || data.hash || data.cid

    if (!cid) {
        throw new Error("Lighthouse upload returned no CID")
    }

    return {
        cid,
        url: getIpfsGatewayUrl(cid),
    }
}

// ── High-level Upload Flow ────────────────────────────────────

/**
 * Full avatar upload pipeline:
 * 1. Validate MIME type
 * 2. Resize to 256×256 max, convert to WebP
 * 3. Upload to Lighthouse IPFS
 * 4. Return CID + gateway URL
 */
export async function uploadAvatar(file: File, apiKey: string): Promise<IpfsPinResult> {
    // 1. Validate
    if (!isValidImageMime(file.type)) {
        throw new Error(`Unsupported image type: ${file.type}. Use JPEG, PNG, WebP, or GIF.`)
    }

    // 2. Preprocess
    const processed = await preprocessImage(file)

    // 3. Upload
    const result = await uploadToLighthouse(processed, apiKey)

    return result
}
