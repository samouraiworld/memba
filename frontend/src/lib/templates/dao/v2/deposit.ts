/**
 * Storage deposit for deploying a generated v2 DAO realm.
 *
 * The chain charges `storage_price` (100 ugnot per byte on gnoland-1) for the
 * bytes a package adds, and `max_deposit` caps what the deploy may lock. Under
 * gnoland-1's inert policy the deposit is charged when the package is enabled.
 *
 * MEASURED 2026-09-17 at gno 31b6650a (in-memory gnoland node, `gnokey maketx
 * addpkg`, then `vm/qstorage`), storage bytes per configuration:
 *   1 member, 2 roles, 1 category, short text ............  60,230
 *   1 member, 16x30-char roles and categories .............  64,133
 *   1 member, 64x3-byte name, 1000x3-byte description .....  65,873
 *   100 members, no roles .................................. 391,743
 *   100 members, one 6-char role each ...................... 399,480
 *   50 members, 16x30-char roles each ...................... 298,669
 *   100 members, 16x30-char roles each, 16 categories,
 *     maximal name and description (largest possible) ...... 546,792
 * A text proposal added 6,647 bytes (paid by the proposer, not at deploy).
 *
 * The estimate below is a linear model that is at or above every measurement
 * (by 3 % to 23 %). The cap sent as max_deposit is twice the estimate, rounded
 * up to a whole GNOT, at least 2 GNOT and at most DAO_V2_MAX_DEPOSIT (twice the
 * largest measured deploy, rounded up to a whole GNOT).
 */

const UGNOT_PER_GNOT = 1_000_000
export const STORAGE_PRICE_UGNOT_PER_BYTE = 100

/** Largest measured deploy (546,792 bytes) x 100 ugnot x 2, rounded up to a whole GNOT. */
export const DAO_V2_MAX_DEPOSIT_UGNOT = 110 * UGNOT_PER_GNOT
export const DAO_V2_MAX_DEPOSIT = `${DAO_V2_MAX_DEPOSIT_UGNOT}ugnot`
export const DAO_V2_MIN_DEPOSIT_UGNOT = 2 * UGNOT_PER_GNOT

export interface DepositInput {
    name: string
    description: string
    roles: string[]
    proposalCategories: string[]
    members: { roles: string[] }[]
}

const utf8Bytes = (s: string) => new TextEncoder().encode(s).length

/** Conservative estimate of the storage bytes a deploy adds. */
export function estimateDAOStorageBytes(c: DepositInput): number {
    const base = 62_000
    const perExtraMember = 3_500
    const roleRefs = c.members.reduce((sum, m) => sum + m.roles.reduce((s, r) => s + 100 + 2 * utf8Bytes(r), 0), 0)
    const labels = [...c.roles, ...c.proposalCategories].reduce((sum, l) => sum + 3 * utf8Bytes(l), 0)
    const text = 2 * (utf8Bytes(c.name) + utf8Bytes(c.description))
    return base + perExtraMember * Math.max(0, c.members.length - 1) + roleRefs + labels + text
}

/** Estimated deposit in ugnot. */
export function estimateDAODepositUgnot(c: DepositInput): number {
    return estimateDAOStorageBytes(c) * STORAGE_PRICE_UGNOT_PER_BYTE
}

/** The max_deposit cap for this configuration, in ugnot. */
export function daoDepositCapUgnot(c: DepositInput): number {
    const doubled = 2 * estimateDAODepositUgnot(c)
    const wholeGnot = Math.ceil(doubled / UGNOT_PER_GNOT) * UGNOT_PER_GNOT
    return Math.min(DAO_V2_MAX_DEPOSIT_UGNOT, Math.max(DAO_V2_MIN_DEPOSIT_UGNOT, wholeGnot))
}

/** Human form, e.g. 6.2 GNOT or 13 GNOT. */
export function formatGnot(ugnot: number): string {
    const gnot = ugnot / UGNOT_PER_GNOT
    return `${Number.isInteger(gnot) ? gnot : gnot.toFixed(1)} GNOT`
}
