/**
 * Storage deposit for deploying a generated v2 DAO realm.
 *
 * The chain charges `storage_price` (100 ugnot per byte on gnoland-1) for the
 * bytes a package adds, and `max_deposit` caps what the deploy may lock. Under
 * gnoland-1's inert policy the deposit is charged when the package is enabled.
 *
 * MEASURED 2026-09-17 at gno 31b6650a with the final template (in-memory gnoland node, `gnokey maketx
 * addpkg`, then `vm/qstorage`), storage bytes per configuration:
 *   1 member, 2 roles, 1 category, short text ............  60,509
 *   1 member, 16x30-char roles and categories .............  64,894
 *   1 member, 64x3-byte name, 1000x3-byte description .....  66,626
 *   10 members, one role ...................................  91,403
 *   10 members, 16x30-char roles each ...................... 107,041
 *   25 members, two roles each, 440 chars of text .......... 145,090
 *   50 members, one role ................................... 227,799
 *   100 members, 16x30-char roles each ..................... 540,918
 *   100 members, no roles .................................. 391,881
 *   100 members, one 6-char role each ...................... 398,740
 *   50 members, 16x30-char roles each ...................... 299,677
 *   100 members, 16x30-char roles each, 16 categories,
 *     maximal name and description (largest possible) ...... 547,796
 * A text proposal added 6,647 bytes (paid by the proposer, not at deploy).
 *
 * The estimate below is a linear model that is at or above every measurement
 * (by 3 % to 24 %). The cap sent as max_deposit is twice the estimate, rounded
 * up to a whole GNOT, at least 2 GNOT and at most DAO_V2_MAX_DEPOSIT (twice the
 * largest measured deploy, rounded up to a whole GNOT).
 */

const UGNOT_PER_GNOT = 1_000_000
export const STORAGE_PRICE_UGNOT_PER_BYTE = 100

/** Largest measured deploy (547,796 bytes) x 100 ugnot x 2, rounded up to a whole GNOT. */
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

/**
 * Gas budget for the AddPackage transaction that deploys a DAO.
 *
 * MEASURED at gno 31b6650a (in-memory node, gnokey maketx addpkg), gas used:
 *   1 member, short text ....................... 44.9M
 *   1 member, 16x30-char roles and categories .. 47.4M
 *   1 member, maximal name and description ..... 53.1M
 *   10 members, one role ....................... 49.4M
 *   10 members, 16x30-char roles ............... 60.9M
 *   25 members, two roles, 440 chars of text ... 60.2M
 *   50 members, one role ....................... 75.3M
 *   50 members, 16x30-char roles .............. 129.9M
 *   100 members, no roles ..................... 108.6M
 *   100 members, one role ..................... 111.4M
 *   100 members, 16x30-char roles ............. 218.9M
 *   100 members, 16 roles, maximal text ....... 228.9M
 * A linear model at or above each point, times 1.3, rounded up to a whole
 * million and kept within [50M, 500M]. Use it where AddPackage type-checks and
 * initialises the package (permissionless chains, or an unknown policy).
 */
export function estimateDeployGas(c: DepositInput): number {
    const roleRefs = c.members.reduce((sum, m) => sum + m.roles.reduce((s, r) => s + 20_000 + 2_000 * utf8Bytes(r), 0), 0)
    const labels = [...c.roles, ...c.proposalCategories].reduce((sum, l) => sum + 2_000 * utf8Bytes(l), 0)
    const text = 3_000 * (utf8Bytes(c.name) + utf8Bytes(c.description))
    const raw = 43_000_000 + 750_000 * Math.max(0, c.members.length - 1) + roleRefs + labels + text
    const withHeadroom = Math.ceil((raw * 1.3) / 1_000_000) * 1_000_000
    return Math.min(500_000_000, Math.max(50_000_000, withHeadroom))
}

/**
 * Gas budget for the AddPackage transaction under the "inert" submission
 * policy (gnoland-1), where the package is stored without being type-checked
 * or initialised; the approver pays for enabling it.
 *
 * MEASURED at gno 31b6650a (in-memory node with the policy set to inert), gas used:
 *   1 member, short text ....................... 36.5M
 *   1 member, 16x30-char roles and categories .. 38.5M
 *   1 member, maximal name and description ..... 44.6M
 *   10 members, one role ....................... 37.5M
 *   10 members, 16x30-char roles ............... 45.0M
 *   25 members, two roles, 440 chars of text ... 40.4M
 *   50 members, one role ....................... 41.8M
 *   50 members, 16x30-char roles ............... 76.6M
 *   100 members, no roles ...................... 46.2M
 *   100 members, one role ...................... 48.4M
 *   100 members, 16x30-char roles ............. 116.1M
 *   100 members, 16 roles, maximal text ....... 126.0M
 * A linear model at or above each point, times 1.3, rounded up to a whole
 * million and kept within [30M, 500M].
 */
export function estimateSubmitGas(c: DepositInput): number {
    const roleRefs = c.members.reduce((sum, m) => sum + m.roles.reduce((s, r) => s + 15_000 + 1_000 * utf8Bytes(r), 0), 0)
    const labels = [...c.roles, ...c.proposalCategories].reduce((sum, l) => sum + 1_500 * utf8Bytes(l), 0)
    const text = 2_600 * (utf8Bytes(c.name) + utf8Bytes(c.description))
    const raw = 36_500_000 + 110_000 * Math.max(0, c.members.length - 1) + roleRefs + labels + text
    const withHeadroom = Math.ceil((raw * 1.3) / 1_000_000) * 1_000_000
    return Math.min(500_000_000, Math.max(30_000_000, withHeadroom))
}

/** Gas budget for deploying a DAO on a chain with this code submission policy. */
export function deployGasForPolicy(c: DepositInput, policy: string): number {
    return policy === "inert" ? estimateSubmitGas(c) : estimateDeployGas(c)
}

/** Human form, e.g. 13 GNOT, 6.2 GNOT or 0.058 GNOT. */
export function formatGnot(ugnot: number): string {
    const gnot = ugnot / UGNOT_PER_GNOT
    if (Number.isInteger(gnot)) return `${gnot} GNOT`
    return `${gnot < 1 ? gnot.toFixed(3) : gnot.toFixed(1)} GNOT`
}
