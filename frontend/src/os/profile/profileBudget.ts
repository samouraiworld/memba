/**
 * Gas limit and storage-deposit cap for profile publishing, from `.app/simulate`
 * on gnoland-1 (heights 447,631 to 447,670, 2026-09-30).
 *
 * One `SetStringField` call on r/demo/profile used 6.11M to 6.21M gas whatever
 * the value size (empty to 3.7 KB); six maximal calls in one transaction used
 * 10.12M. A key written for the first time stores about 2,100 bytes plus the
 * value (empty: 2,099; a 2,000-byte Bio: 4,107; a 3,675-byte layout: 5,795).
 * Rewriting an existing key stores only its growth (300 more bytes: 303) and
 * the chain refunds a shorter value.
 *
 * The gas limit is at least twice the measurement. Each call's deposit cap is
 * twice its storage estimate, rounded up to 0.01 GNOT: the chain locks only the
 * bytes a call adds, so the cap is a ceiling, not a price. Without `max_deposit`
 * the chain would accept up to its 100 GNOT default.
 *
 * The realm has no delete: clearing a field frees its value bytes, and the
 * entry itself (about 0.21 GNOT) stays locked. The storage price is the chain
 * parameter read on 2026-09-17 (v2Budget STORAGE_PRICE_UGNOT); a governance
 * change to it would need these caps re-derived, while the gas price is read
 * live for every quote.
 */
import { depositCapUgnot, STORAGE_PRICE_UGNOT } from "../../lib/dao/v2Budget"
import { feeForGasWanted, type GasPrice } from "../../lib/grc20"

const GAS_BASE = 12_000_000
const GAS_PER_CALL = 2_000_000
const NEW_KEY_BYTES = 2_200
const REWRITE_SLACK_BYTES = 64

const encoder = new TextEncoder()
const bytes = (value: string) => encoder.encode(value).length

export interface StoredValueChange {
    before: string
    after: string
    /** The key has never been written, so the call stores a new entry. */
    created: boolean
}

/** Upper-bound estimate of the bytes one call adds to the realm. */
export function profileStorageBytes({ before, after, created }: StoredValueChange): number {
    return created ? NEW_KEY_BYTES + bytes(after) : Math.max(0, bytes(after) - bytes(before)) + REWRITE_SLACK_BYTES
}

/** What one publish can cost: the deposit the chain is expected to lock, its cap, and the network fee. */
export function profilePublishCosts(changes: readonly StoredValueChange[], price: GasPrice) {
    const storage = changes.map(profileStorageBytes)
    const gasWanted = GAS_BASE + GAS_PER_CALL * changes.length
    return {
        gasWanted,
        feeUgnot: feeForGasWanted(gasWanted, price),
        depositUgnot: storage.reduce((sum, size) => sum + size * STORAGE_PRICE_UGNOT, 0),
        depositCapUgnot: storage.reduce((sum, size) => sum + depositCapUgnot(size), 0),
    }
}
