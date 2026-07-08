/**
 * gnoIcoSale — pure date/copy helpers for the gno.land public-sale announcement.
 *
 * Kept out of the component file so GnoIcoAnnouncement.tsx only exports a
 * component (react-refresh) and so these stay unit-testable in isolation.
 *
 * @module lib/gnoIcoSale
 */

/** Sale opens 2026-07-20 (UTC). */
export const SALE_START_MS = Date.UTC(2026, 6, 20, 0, 0, 0)

/** Whole days until the sale opens; 0 or negative once it's live. `now` is passed
 *  in so this is pure and testable (the caller supplies Date.now()). */
export function daysUntilSale(now: number): number {
    return Math.ceil((SALE_START_MS - now) / 86_400_000)
}

/** The status line shown under the title, based on time-to-open. Copy stays
 *  deliberately non-committal once the window opens: it points to the official
 *  portal for the real status rather than asserting the sale is participatable
 *  this instant (the day boundary here is UTC and the true open time lives on the
 *  sale site). */
export function saleStatusLabel(days: number): string {
    if (days > 1) return `Opens in ${days} days · July 20`
    if (days === 1) return "Opens tomorrow · July 20"
    if (days === 0) return "Opening today · July 20"
    return "Now open — visit the sale"
}
