import { MIN_MINT_PRICE } from "./launchpad"

/** Sanity ceiling for a mint price (1e9 GNOT). The realm enforces the true max;
 *  this only catches fat-finger / overflow input client-side. */
export const MAX_MINT_PRICE_UGNOT = 1_000_000_000_000_000

export function gnotToUgnot(gnot: number): number {
    return Math.round(gnot * 1_000_000)
}

export function ugnotToGnot(ugnot: number): number {
    return ugnot / 1_000_000
}

/**
 * Validate a user-entered mint price (in GNOT) against the realm's rule:
 * 0 (free) or >= MIN_MINT_PRICE (0.001 GNOT), <= sanity ceiling.
 * Returns the ugnot value to pass to buildSetMintConfigMsg.
 */
export function validateMintPrice(input: string): { ok: boolean; ugnot: number; error?: string } {
    const trimmed = input.trim()
    if (trimmed === "" || trimmed === "0") return { ok: true, ugnot: 0 }

    const gnot = Number(trimmed)
    if (!Number.isFinite(gnot) || gnot < 0) {
        return { ok: false, ugnot: 0, error: "Enter a number in GNOT (e.g. 1.5), or 0 for a free mint." }
    }

    const ugnot = gnotToUgnot(gnot)
    if (ugnot > 0 && ugnot < MIN_MINT_PRICE) {
        return { ok: false, ugnot, error: "Minimum paid price is 0.001 GNOT. Use 0 for a free mint." }
    }
    if (ugnot > MAX_MINT_PRICE_UGNOT) {
        return { ok: false, ugnot, error: "That price is too high." }
    }
    return { ok: true, ugnot }
}
