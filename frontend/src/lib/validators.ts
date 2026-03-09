import type { MonitoringValidatorData } from "./gnomonitoring"
import { hexToBech32 } from "./dao/realmAddress"

// ── Types ─────────────────────────────────────────────────────

export interface ValidatorInfo {
    /** Hex-encoded address (from consensus) */
    address: string
    /** Bech32 gno address (derived from hex address via hexToBech32) */
    gnoAddr: string
    /** Human-readable name / moniker (from gnomonitoring) */
    moniker: string
    /** Base64-encoded public key */
    pubkey: string
    /** Public key type (e.g. "tendermint/PubKeyEd25519") */
    pubkeyType: string
    /** Voting power weight */
    votingPower: number
    /** Voting power as percentage of total */
    powerPercent: number
    /** Rank by voting power (1 = highest) */
    rank: number
    /** Whether this validator is in the active set */
    active: boolean
    /** Proposer priority (affects block proposal order) */
    proposerPriority: number
    /** Participation rate % (from gnomonitoring, 0-100) */
    participationRate: number | null
    /** Uptime % (from gnomonitoring, 0-100) */
    uptimePercent: number | null
}

export interface NetworkStats {
    /** Latest block height */
    blockHeight: number
    /** Average block time in seconds (from last 10 blocks) */
    avgBlockTime: number
    /** Total validators in the active set */
    totalValidators: number
    /** Total voting power */
    totalVotingPower: number
    /** Chain ID */
    chainId: string
    /** Whether the node is catching up (syncing) */
    catchingUp: boolean
    /** Latest block time (ISO string) */
    latestBlockTime: string
}

export interface ValidatorUptime {
    /** Blocks signed out of total checked */
    signed: number
    /** Total blocks checked */
    total: number
    /** Uptime percentage (0-100) */
    percent: number
}

// ── RPC Helpers ───────────────────────────────────────────────

/** Make a Tendermint JSON-RPC call. */
async function rpcCall(
    rpcUrl: string,
    method: string,
    params: Record<string, string> = {},
    signal?: AbortSignal,
): Promise<unknown> {
    const url = new URL(rpcUrl)
    url.pathname = method
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))

    const res = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
        signal,
    })
    if (!res.ok) throw new Error(`RPC ${method} failed: ${res.status}`)
    const json = await res.json()
    if (json.error) throw new Error(`RPC error: ${json.error.message || json.error}`)
    return json.result
}

// ── Validators ────────────────────────────────────────────────

/** Fetch all validators from the active consensus set (auto-paginated). */
export async function getValidators(rpcUrl: string): Promise<ValidatorInfo[]> {
    const PER_PAGE = 100

    // Page 1 — also gives us the total count
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await rpcCall(rpcUrl, "/validators", { per_page: String(PER_PAGE), page: "1" }) as any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let validators: any[] = result?.validators || []
    const total = parseInt(result?.total || "0", 10)

    // Auto-paginate: fetch remaining pages in parallel if total > PER_PAGE
    if (total > PER_PAGE) {
        const totalPages = Math.ceil(total / PER_PAGE)
        const pagePromises: Promise<unknown>[] = []
        for (let p = 2; p <= totalPages; p++) {
            pagePromises.push(
                rpcCall(rpcUrl, "/validators", { per_page: String(PER_PAGE), page: String(p) })
            )
        }
        const pages = await Promise.all(pagePromises)
        for (const page of pages) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const pageVals = (page as any)?.validators || []
            validators = validators.concat(pageVals)
        }
    }

    const totalPower = validators.reduce((sum: number, v: { voting_power: string }) =>
        sum + parseInt(v.voting_power || "0", 10), 0)

    return validators
        .map((v) => {
            const hexAddr = v.address || ""
            // Derive bech32 g1... address from hex (Tendermint hex = raw 20-byte address)
            let gnoAddr = ""
            try {
                if (hexAddr.length === 40) gnoAddr = hexToBech32(hexAddr)
            } catch { /* fallback: leave empty */ }

            return {
                address: hexAddr,
                gnoAddr,
                moniker: "",
                pubkey: v.pub_key?.value || "",
                pubkeyType: v.pub_key?.type || "unknown",
                votingPower: parseInt(v.voting_power || "0", 10),
                powerPercent: totalPower > 0
                    ? (parseInt(v.voting_power || "0", 10) / totalPower) * 100
                    : 0,
                rank: 0, // assigned below
                active: true,
                proposerPriority: parseInt(v.proposer_priority || "0", 10),
                participationRate: null,
                uptimePercent: null,
            }
        })
        .sort((a, b) => b.votingPower - a.votingPower)
        .map((v, i) => ({ ...v, rank: i + 1 }))
}

/**
 * Merge Tendermint validator data with gnomonitoring data.
 *
 * Address matching strategy:
 * - Tendermint RPC returns hex addresses (20 bytes, e.g. "A1B2C3...")
 * - gnomonitoring returns bech32 addresses (e.g. "g16tfqqk6w...")
 * - We derive the bech32 address from hex via hexToBech32() during getValidators()
 * - Then do a direct bech32 match: validator.gnoAddr vs monitoring.addr
 */
export function mergeWithMonitoringData(
    validators: ValidatorInfo[],
    monitoringMap: Map<string, MonitoringValidatorData>,
): ValidatorInfo[] {
    if (monitoringMap.size === 0) return validators

    return validators.map(v => {
        // Direct match using the bech32 address we derived from hex
        const match = v.gnoAddr ? monitoringMap.get(v.gnoAddr.toLowerCase()) : undefined
        if (match) {
            return {
                ...v,
                moniker: match.moniker,
                participationRate: match.participationRate,
                uptimePercent: match.uptime,
            }
        }
        return v
    })
}

// ── Network Stats ─────────────────────────────────────────────

/**
 * Fetch network overview stats (block height, avg time, validator count).
 * Pass pre-fetched validators to avoid redundant RPC call (I7 fix).
 */
export async function getNetworkStats(
    rpcUrl: string,
    prefetchedValidators?: ValidatorInfo[],
): Promise<NetworkStats> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const status = await rpcCall(rpcUrl, "/status") as any
    const latestHeight = parseInt(status?.sync_info?.latest_block_height || "0", 10)
    const latestBlockTime = status?.sync_info?.latest_block_time || ""
    const catchingUp = status?.sync_info?.catching_up || false
    const chainId = status?.node_info?.network || "unknown"

    // Validator count: use prefetched data when available, skip redundant RPC
    let totalValidators = 0
    let totalVotingPower = 0
    if (prefetchedValidators && prefetchedValidators.length > 0) {
        totalValidators = prefetchedValidators.length
        totalVotingPower = prefetchedValidators.reduce((sum, v) => sum + v.votingPower, 0)
    } else {
        // Fallback: fetch validator count via RPC (no prefetched data)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const valResult = await rpcCall(rpcUrl, "/validators", { per_page: "1" }) as any
        totalValidators = parseInt(valResult?.total || "0", 10)
        totalVotingPower = parseInt(valResult?.validators?.[0]?.voting_power || "0", 10)
    }

    // Calculate avg block time from last 10 blocks
    let avgBlockTime = 0
    if (latestHeight > 10) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const recentBlock = await rpcCall(rpcUrl, "/block", { height: String(latestHeight - 10) }) as any
            const oldTime = new Date(recentBlock?.block?.header?.time || 0).getTime()
            const newTime = new Date(latestBlockTime).getTime()
            if (oldTime > 0 && newTime > oldTime) {
                avgBlockTime = (newTime - oldTime) / 10_000 // 10 blocks → seconds
            }
        } catch {
            avgBlockTime = 0
        }
    }

    return {
        blockHeight: latestHeight,
        avgBlockTime: Math.round(avgBlockTime * 100) / 100,
        totalValidators,
        totalVotingPower,
        chainId,
        catchingUp,
        latestBlockTime,
    }
}

// ── Validator Uptime ──────────────────────────────────────────

/**
 * Calculate validator uptime by checking signatures in recent blocks.
 * Checks the last `blocks` blocks (default: 50) for the validator's signature.
 */
export async function getValidatorUptime(
    rpcUrl: string,
    validatorAddress: string,
    blocks = 50,
): Promise<ValidatorUptime> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const status = await rpcCall(rpcUrl, "/status") as any
    const latestHeight = parseInt(status?.sync_info?.latest_block_height || "0", 10)

    const checkCount = Math.min(blocks, latestHeight - 1)
    let signed = 0

    // Check a sample of blocks (every 5th to reduce RPC calls)
    const step = Math.max(1, Math.floor(checkCount / 10))
    let checked = 0

    for (let h = latestHeight; h > latestHeight - checkCount && h > 1; h -= step) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const block = await rpcCall(rpcUrl, "/block", { height: String(h) }) as any
            const sigs = block?.block?.last_commit?.signatures || []
            const found = sigs.some(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (s: any) => s.validator_address?.toLowerCase() === validatorAddress.toLowerCase(),
            )
            if (found) signed++
            checked++
        } catch {
            // skip failed blocks
        }
    }

    const percent = checked > 0 ? Math.round((signed / checked) * 10000) / 100 : 0
    return { signed, total: checked, percent }
}

// ── Formatting ────────────────────────────────────────────────

/** Format voting power with K/M suffix for compact display. */
export function formatVotingPower(power: number): string {
    if (power >= 1_000_000) return `${(power / 1_000_000).toFixed(1)}M`
    if (power >= 1_000) return `${(power / 1_000).toFixed(1)}K`
    return power.toString()
}

/** Format block time as human-readable (e.g. "2.5s"). */
export function formatBlockTime(seconds: number): string {
    if (seconds <= 0) return "—"
    return `${seconds.toFixed(1)}s`
}

/** Truncate validator hex address for display. */
export function truncateValidatorAddr(address: string): string {
    if (address.length <= 12) return address
    return `${address.slice(0, 6)}…${address.slice(-6)}`
}
