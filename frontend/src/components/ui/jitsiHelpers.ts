/**
 * Jitsi Meet helpers (v2.5c).
 *
 * Extracted from JitsiMeet.tsx to satisfy react-refresh/only-export-components.
 * Shared between JitsiMeet.tsx and JitsiMeet.test.ts.
 *
 * @module components/ui/jitsiHelpers
 */

/** Jitsi public instance domain. */
export const JITSI_DOMAIN = "meet.jit.si"

/** Generate a deterministic, URL-safe Jitsi room name. */
export function jitsiRoomName(daoSlug: string, channelName: string): string {
    // Prefix with "memba-" to avoid collisions with global Jitsi rooms
    const base = `memba-${daoSlug}-${channelName}`
    return base.replace(/[^a-zA-Z0-9-_]/g, "-").toLowerCase()
}
