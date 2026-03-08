/**
 * Jitsi Meet helpers (v2.9).
 *
 * Supports two modes:
 * 1. **JaaS** (8x8.vc) — lobby-free, API key gives room config control.
 *    Set `VITE_JAAS_APP_ID` in .env to enable.
 * 2. **Fallback** — meet.jit.si public instance (lobby may be enforced).
 *
 * Room names include a deterministic 5-char hash suffix derived from the
 * DAO slug to prevent predictability while keeping rooms shareable.
 *
 * @module components/ui/jitsiHelpers
 */

/** JaaS App ID (set via VITE_JAAS_APP_ID env var). Empty = fallback to meet.jit.si. */
export const JAAS_APP_ID = import.meta.env.VITE_JAAS_APP_ID || ""

/** Jitsi domain — JaaS when configured, else public instance. */
export const JITSI_DOMAIN = JAAS_APP_ID ? "8x8.vc" : "meet.jit.si"

/** Whether JaaS is active (lobby-free, full room control). */
export const IS_JAAS = !!JAAS_APP_ID

/**
 * Simple deterministic hash → 5-char hex string.
 * Uses djb2 algorithm for fast, collision-resistant hashing.
 */
export function shortHash(input: string): string {
    let hash = 5381
    for (let i = 0; i < input.length; i++) {
        hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0
    }
    // Convert to unsigned, take last 5 hex chars
    return (hash >>> 0).toString(16).slice(-5).padStart(5, "0")
}

/**
 * Generate a deterministic, URL-safe Jitsi room name with hash suffix.
 *
 * Format: `memba-{slug}-{channel}-{5-char-hash}`
 * The hash is derived from the full `daoSlug + channelName` to make
 * room names unpredictable while keeping them reproducible.
 */
export function jitsiRoomName(daoSlug: string, channelName: string): string {
    const base = `memba-${daoSlug}-${channelName}`
    const hash = shortHash(base)
    const safe = base.replace(/[^a-zA-Z0-9-_]/g, "-").toLowerCase()
    return `${safe}-${hash}`
}

/**
 * Build the full Jitsi iframe URL.
 * JaaS: `https://8x8.vc/{appId}/{roomName}#config...`
 * Fallback: `https://meet.jit.si/{roomName}#config...`
 */
export function jitsiIframeSrc(roomName: string, configParams: string): string {
    if (IS_JAAS) {
        return `https://${JITSI_DOMAIN}/${JAAS_APP_ID}/${roomName}#${configParams}`
    }
    return `https://${JITSI_DOMAIN}/${roomName}#${configParams}`
}
