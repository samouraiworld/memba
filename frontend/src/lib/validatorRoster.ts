/**
 * One sample of the validator roster: the consensus set at a single verified
 * node and height, named from the valoper registry, enriched with monitoring
 * data and recent block signatures, with each validator's health computed from
 * them. The classic Validators page and the Memba OS Validators window both
 * poll this, under the same query key.
 *
 * @module lib/validatorRoster
 */
import { GNO_RPC_URL } from "./config"
import { fetchAllMonitoringData } from "./gnomonitoring"
import { computeHealthStatus, computeNetworkHealth, type NetworkHealthSummary } from "./validatorHealth"
import {
    fetchLastBlockSignatures,
    fetchValoperMonikers,
    getNetworkStats,
    getValidatorRpcSnapshot,
    getValidators,
    mergeValoperMonikers,
    mergeWithMonitoringData,
    type NetworkStats,
    type ValidatorInfo,
    type ValidatorRpcSnapshot,
} from "./validators"

/** How often a roster view polls. */
export const ROSTER_REFRESH_MS = 30_000

// Blocks of signing history read per roster sample. The health engine only
// reads the leading run, so 100 bought nothing here and cost 100 /block calls
// on every poll — the profile keeps the full 100 where the detail is read.
export const ROSTER_SIGNATURE_WINDOW = 20

export interface ValidatorRoster {
    validators: ValidatorInfo[]
    stats: NetworkStats
    networkHealth: NetworkHealthSummary
    /** Lowercased monikers of the registered operators. */
    valoperMonikers: Set<string>
    /** Signing addresses (g1…) in the consensus set. */
    activeSigning: Set<string>
    /** False when the recent block signatures could not be read: health then rests on monitoring alone. */
    signaturesRead: boolean
    snapshot: ValidatorRpcSnapshot
}

/**
 * Core fetch fan-out, sequential stats (stats needs the prefetched validators),
 * then the three-stage merge: valoper monikers first (the on-chain source),
 * then monitoring enrichment, then signatures and health.
 */
export async function fetchValidatorRoster(signal?: AbortSignal): Promise<ValidatorRoster> {
    const snapshot = await getValidatorRpcSnapshot(signal)
    const [vals, monitoringMap, valoperMap, sigMap] = await Promise.all([
        getValidators(GNO_RPC_URL, snapshot, signal),
        fetchAllMonitoringData(signal),
        fetchValoperMonikers(GNO_RPC_URL, snapshot, signal),
        fetchLastBlockSignatures(GNO_RPC_URL, ROSTER_SIGNATURE_WINDOW, 10, snapshot, signal),
    ])
    const stats = await getNetworkStats(GNO_RPC_URL, vals, signal, snapshot)
    const enriched = mergeWithMonitoringData(mergeValoperMonikers(vals, valoperMap), monitoringMap)
    // A validator that signed NOTHING in the window is absent from sigMap:
    // gno nil-pads precommits, so a missed block carries no address and a
    // fully-down validator is undiscoverable from block data alone. Seed it
    // from the roster instead, or the one validator most worth flagging is
    // the one that reads as "no data".
    // Guarded on a non-empty map: if the fetch failed outright we know
    // nothing, and must not manufacture a window of misses.
    const sigWindow = Math.max(0, ...[...sigMap.values()].map(a => a.length))
    const validators = enriched.map(v => {
        const own = sigMap.get(v.gnoAddr.toLowerCase())
        const withSigs = {
            ...v,
            lastBlockSignatures: own ?? (sigWindow > 0 ? new Array<boolean>(sigWindow).fill(false) : []),
        }
        const healthMeta = computeHealthStatus(withSigs)
        return { ...withSigs, healthStatus: healthMeta.status, healthMeta }
    })
    return {
        validators,
        stats,
        networkHealth: computeNetworkHealth(validators),
        valoperMonikers: new Set([...valoperMap.values()].map(m => m.toLowerCase())),
        activeSigning: new Set(validators.map(v => v.gnoAddr)),
        signaturesRead: sigWindow > 0,
        snapshot,
    }
}
