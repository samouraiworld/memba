import type { MonitoringValidatorData } from "./gnomonitoring"
import { hexToBech32 } from "./dao/realmAddress"
import { queryRender } from "./dao/shared"
import { getExplorerBaseUrl } from "./config"

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
    /** Gnoweb profile URL (derived from gnoAddr) */
    profileUrl: string
    /** Last N block signatures (true = signed, false = missed). Most recent first. */
    lastBlockSignatures: boolean[]
    /** Validator start time (ISO string, from valopers registration) */
    startTime: string
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
            const rawAddr = v.address || ""
            // Gno's Tendermint RPC returns bech32 addresses (g1…) directly,
            // unlike standard Tendermint which returns 40-char hex.
            // Handle both cases for portability.
            let gnoAddr = ""
            try {
                if (rawAddr.startsWith("g1")) {
                    // Already bech32 — use directly
                    gnoAddr = rawAddr
                } else if (rawAddr.length === 40) {
                    // Standard hex → convert to bech32
                    gnoAddr = hexToBech32(rawAddr)
                }
            } catch { /* fallback: leave empty */ }

            return {
                address: rawAddr,
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
                profileUrl: gnoAddr ? `${getExplorerBaseUrl()}/r/demo/profile:u/${gnoAddr}` : "",
                lastBlockSignatures: [],
                startTime: "",
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
                startTime: match.firstSeen ?? v.startTime,
            }
        }
        return v
    })
}

// ── Valopers On-Chain Monikers (v2.13) ────────────────────────

/**
 * Fetch validator monikers from the on-chain valopers realm.
 *
 * Queries `gno.land/r/gnops/valopers` Render("") via ABCI — no CORS issues.
 * Output format (markdown):
 *   ` * [Moniker](/r/gnops/valopers:g1addr) - [profile](/r/demo/profile:u/g1addr)`
 *
 * Returns Map<bech32_address, moniker>.
 */
export async function fetchValoperMonikers(rpcUrl: string): Promise<Map<string, string>> {
    const monikerMap = new Map<string, string>()
    try {
        const raw = await queryRender(rpcUrl, "gno.land/r/gnops/valopers", "")
        if (!raw) return monikerMap

        // Parse markdown lines: ` * [Moniker](/r/gnops/valopers:g1addr) - [profile](...)`
        const lineRegex = /\*\s+\[([^\]]+)\]\(\/r\/gnops\/valopers:(g1[a-z0-9]+)\)/g
        let match: RegExpExecArray | null
        while ((match = lineRegex.exec(raw)) !== null) {
            const moniker = match[1].trim()
            const addr = match[2].trim()
            if (moniker && addr) {
                monikerMap.set(addr.toLowerCase(), moniker)
            }
        }
    } catch {
        // Best-effort: valopers query may fail on some chains
    }
    return monikerMap
}

/**
 * Merge on-chain valopers monikers into validator list.
 * This is the PRIMARY moniker source — gnomonitoring is secondary.
 * Only sets moniker if the validator doesn't already have one.
 */
export function mergeValoperMonikers(
    validators: ValidatorInfo[],
    monikerMap: Map<string, string>,
): ValidatorInfo[] {
    if (monikerMap.size === 0) return validators

    return validators.map(v => {
        const moniker = v.gnoAddr ? monikerMap.get(v.gnoAddr.toLowerCase()) : undefined
        if (moniker && !v.moniker) {
            return { ...v, moniker }
        }
        return v
    })
}

// ── Network Stats ─────────────────────────────────────────────

/**
 * Fetch network overview stats (block height, avg time, validator count).
 * Pass pre-fetched validators to avoid redundant RPC call (I7 fix).
 *
 * @param rpcUrl      - Tendermint RPC base URL
 * @param prefetchedValidators - Optional pre-fetched validators to avoid extra /validators call
 * @param signal      - Optional AbortSignal for request cancellation
 */
export async function getNetworkStats(
    rpcUrl: string,
    prefetchedValidators?: ValidatorInfo[],
    signal?: AbortSignal,
): Promise<NetworkStats> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const status = await rpcCall(rpcUrl, "/status", {}, signal) as any
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
        const valResult = await rpcCall(rpcUrl, "/validators", { per_page: "1" }, signal) as any
        totalValidators = parseInt(valResult?.total || "0", 10)
        totalVotingPower = parseInt(valResult?.validators?.[0]?.voting_power || "0", 10)
    }

    // Calculate avg block time from last 10 blocks
    let avgBlockTime = 0
    if (latestHeight > 10) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const recentBlock = await rpcCall(rpcUrl, "/block", { height: String(latestHeight - 10) }, signal) as any
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

// ── Last Block Signatures (batch) ─────────────────────────────

/**
 * Batch-fetch last N block commit signatures for all validators.
 *
 * Gno's Tendermint RPC uses `last_commit.precommits` (not `signatures`)
 * and `validator_address` is in bech32 format (g1…), not hex.
 *
 * Returns Map<bech32Addr (lowercase), boolean[]> where true = signed.
 * Array order: most recent block first.
 * Graceful degradation: returns empty map on failure.
 */
export async function fetchLastBlockSignatures(
    rpcUrl: string,
    blockCount: number = 20,
): Promise<Map<string, boolean[]>> {
    const result = new Map<string, boolean[]>()
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const status = await rpcCall(rpcUrl, "/status") as any
        const latestHeight = parseInt(status?.sync_info?.latest_block_height || "0", 10)
        if (latestHeight < 2) return result

        const startHeight = Math.max(2, latestHeight - blockCount + 1)
        const heights: number[] = []
        for (let h = latestHeight; h >= startHeight; h--) heights.push(h)

        // Fetch blocks in parallel
        const blocks = await Promise.all(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            heights.map(h => rpcCall(rpcUrl, "/block", { height: String(h) }).catch(() => null) as Promise<any>)
        )

        // Collect all unique validator addresses from precommits
        // Gno uses `precommits` field (not `signatures`), with bech32 addresses
        const allAddrs = new Set<string>()
        for (const block of blocks) {
            const precommits = block?.block?.last_commit?.precommits || []
            for (const pc of precommits) {
                if (pc?.validator_address) allAddrs.add(pc.validator_address.toLowerCase())
            }
        }

        // Initialize arrays
        for (const addr of allAddrs) result.set(addr, [])

        // Fill signatures (most recent block first = index 0)
        for (const block of blocks) {
            const precommits = block?.block?.last_commit?.precommits || []
            const sigAddrs = new Set(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                precommits.map((pc: any) => pc?.validator_address?.toLowerCase()).filter(Boolean)
            )
            for (const addr of allAddrs) {
                result.get(addr)!.push(sigAddrs.has(addr))
            }
        }
    } catch {
        // Graceful degradation — return empty map
    }
    return result
}

// ── Hacker Mode Types ─────────────────────────────────────────

/** Hard cap for block heatmap fetches. Prevents accidental heavy RPC load. */
export const MAX_HACKER_BLOCKS = 100

/**
 * Node identity and status from Tendermint `/status`.
 * Used by ConnectSection and NodeStatePanel in Hacker View.
 */
export interface NodeStatus {
    /** Node moniker */
    moniker: string
    /** Software version */
    version: string
    /** Node ID (hex) */
    nodeId: string
    /** P2P listen address */
    listenAddr: string
    /** RPC address */
    rpcAddr: string
    /** Validator bech32 address (if this is a validator node) */
    validatorAddr: string
    /** Validator pubkey (base64) */
    pubkey: string
    /** Whether the node is catching up */
    catchingUp: boolean
    /** Genesis file SHA256 hash (from sync_info where available) */
    genesisHash: string
    /** Chain ID / network */
    chainId: string
    /** Latest block time ISO string */
    nodeTime: string
    /** Number of peers from node_info */
    peerCount: number
}

/**
 * Fetch node identity from `/status`.
 * Resilient: returns null on any error.
 */
export async function getNodeStatus(
    rpcUrl: string,
    signal?: AbortSignal,
): Promise<NodeStatus | null> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const st = await rpcCall(rpcUrl, "/status", {}, signal) as any
        if (!st) return null
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ni: any = st.node_info || {}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const vi: any = st.validator_info || {}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const si: any = st.sync_info || {}

        // Convert validator hex address to bech32 if present
        let validatorAddr = ""
        try {
            if (vi.address) validatorAddr = hexToBech32(vi.address)
        } catch { /* ignore */ }

        return {
            moniker: ni.moniker || "",
            version: ni.version || "",
            nodeId: ni.id || "",
            listenAddr: ni.listen_addr || "",
            rpcAddr: ni.other?.rpc_address || "",
            validatorAddr,
            pubkey: vi.pub_key?.value || "",
            catchingUp: si.catching_up === true,
            genesisHash: si.latest_app_hash || "", // sha256 not in /status, use app_hash as proxy
            chainId: ni.network || "",
            nodeTime: si.latest_block_time || "",
            peerCount: 0, // will be overridden by /net_info peerCount
        }
    } catch {
        return null
    }
}

/**
 * Parsed live consensus state from Tendermint `/dump_consensus_state`.
 * Available on all Gno networks exposing the standard Tendermint RPC.
 * May be `null` on chains/nodes that restrict the endpoint.
 */
export interface HackerConsensusState {
    /** Chain ID */
    chainId: string
    /** Current consensus Height */
    height: number
    /** Current consensus Round (0-based) */
    round: number
    /** Current consensus Step (1=Propose, 2=Prevote, 3=Precommit) */
    step: number
    /** Human-readable step label */
    stepLabel: "Propose" | "Prevote" | "Precommit" | "Commit" | "Unknown"
    /** Current block proposer address (bech32 or moniker if resolved) */
    proposer: string
    /** Total validators in the valset */
    valsetSize: number
    /** Minimum validators required for BFT consensus (ceil(2/3 * valsetSize)) */
    minBft: number
    /** How many validators can fail before consensus breaks (valsetSize - minBft) */
    faultTolerance: number
    /** Whether this round can still add new validators */
    canAddValidator: boolean
    /** Count of received Pre-votes for this round */
    prevoteCount: number
    /** Count of received Pre-commits for this round */
    precommitCount: number
    /** Timestamp when current round started (ISO string) */
    roundStartTime: string
    /** AppHash of the last committed block */
    appHash: string
    /** Genesis time (ISO string) */
    genesisTime: string
    /** Node's own uptime since process start (seconds) */
    nodeUptime: number | null
    /** Latest block time (ISO string) */
    latestBlockTime: string
}

/**
 * A single peer as returned by `/net_info`.
 * IP address is exposed as-is — public RPC nodes expose this publicly.
 */
export interface PeerInfo {
    /** Peer node ID (hex) */
    nodeId: string
    /** Peer IP address */
    ip: string
    /** P2P address string (full `nodeId@ip:port`) */
    p2pAddr: string
    /** Peer's reported moniker */
    moniker: string
    /** Peer's reported network/chain ID */
    network: string
    /** Whether this is a persistent peer */
    isOutbound: boolean
    /** Peer's current block height (if reported by its RPC) */
    remoteHeight: number | null
    /** RPC address (may be empty if not exposed) */
    rpcAddr: string
}

/** Network peer topology from `/net_info`. */
export interface NetInfo {
    /** Whether the node is currently listening for connections */
    listening: boolean
    /** Full list of connected peers */
    peers: PeerInfo[]
    /** Total peer count */
    peerCount: number
}

/**
 * A single block's health data for the heatmap.
 * Values are derived from `last_commit.precommits`.
 */
export interface BlockSample {
    /** Block height */
    height: number
    /** Number of validators that signed this block */
    signerCount: number
    /** Total validators in the active set at time of commit */
    valsetSize: number
    /** True if all validators signed (perfect block) */
    perfect: boolean
    /** Health ratio: signerCount / valsetSize (0.0–1.0) */
    healthRatio: number
    /** Block timestamp (ISO string) */
    time: string
}

// ── Hacker Mode Telemetry Fetchers ────────────────────────────

/**
 * Fetch and parse live consensus state from `/dump_consensus_state`.
 *
 * Resilient: returns `null` on any error (CORS, timeout, restricted endpoint)
 * so the UI can gracefully fall back without crashing.
 *
 * @param rpcUrl  The RPC endpoint to query (use `getTelemetryRpcUrl()` for Hacker Mode).
 * @param signal  AbortSignal for cancellation.
 */
export async function getConsensusState(
    rpcUrl: string,
    signal?: AbortSignal,
): Promise<HackerConsensusState | null> {
    try {
        // Fetch consensus state and status in parallel for efficiency
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [cs, st] = await Promise.all([
            rpcCall(rpcUrl, "/dump_consensus_state", {}, signal) as Promise<any>,
            rpcCall(rpcUrl, "/status", {}, signal) as Promise<any>,
        ])

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rs: any = cs?.round_state || {}

        // Parse H/R/S — format: "HEIGHT/ROUND/STEP"
        const hrsRaw: string = rs["height/round/step"] || "0/0/0"
        const [hStr, rStr, sStr] = hrsRaw.split("/")
        const height = parseInt(hStr || "0", 10)
        const round = parseInt(rStr || "0", 10)
        const step = parseInt(sStr || "0", 10)

        const stepLabels: HackerConsensusState["stepLabel"][] = [
            "Unknown", "Propose", "Prevote", "Precommit", "Commit",
        ]
        const stepLabel = stepLabels[step] ?? "Unknown"

        // Parse proposer address
        const proposer: string = rs.proposer?.address || rs.proposal?.proposer_address || ""

        // Parse valset size and compute BFT thresholds
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const validators: any[] = rs.validators?.validators || []
        const valsetSize = validators.length || 0
        const minBft = valsetSize > 0 ? Math.ceil((valsetSize * 2) / 3) : 0
        const faultTolerance = valsetSize - minBft

        // Count prevotes and precommits bitmask
        // Gnockpit uses the `votes` array that maps bit positions to validators
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prevotesBitmask: string = (rs.votes || []).find((v: any) =>
            v?.round === round && v?.vote_type?.toLowerCase() === "prevote"
        )?.prevotes_bit_array || ""
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const precommitsBitmask: string = (rs.votes || []).find((v: any) =>
            v?.round === round && v?.vote_type?.toLowerCase() === "precommit"
        )?.precommits_bit_array || ""

        // Count '1' bits: "BA{9:xxxxxxx_xx}" format
        const countBits = (bitmask: string): number => (bitmask.match(/1/g) || []).length
        const prevoteCount = countBits(prevotesBitmask)
        const precommitCount = countBits(precommitsBitmask)

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const syncInfo: any = st?.sync_info || {}
        const latestBlockTime: string = syncInfo.latest_block_time || ""
        const appHash: string = syncInfo.latest_app_hash || ""

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const nodeInfo: any = st?.node_info || {}
        const chainId: string = nodeInfo.network || ""

        // genesis_time not directly in /status in all Gno versions, but parse if available
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const genesisTime: string = (cs as any)?.genesis?.genesis_time || ""

        return {
            chainId,
            height,
            round,
            step,
            stepLabel,
            proposer,
            valsetSize,
            minBft,
            faultTolerance,
            canAddValidator: true, // conservative default — actual enforcement is on-chain
            prevoteCount,
            precommitCount,
            roundStartTime: rs.start_time || "",
            appHash,
            genesisTime,
            nodeUptime: null, // only available from node sidecar — N/A in pure RPC mode
            latestBlockTime,
        }
    } catch {
        // Endpoint unavailable, CORS blocked, or chain does not expose consensus state
        return null
    }
}

/**
 * Fetch live peer information from `/net_info`.
 *
 * Resilient: returns `null` if the endpoint is unavailable or restricted.
 * Note: peer IPs are intentionally exposed — they are public P2P addresses.
 *
 * @param rpcUrl  The RPC endpoint to query.
 * @param signal  AbortSignal for cancellation.
 */
export async function getNetPeers(
    rpcUrl: string,
    signal?: AbortSignal,
): Promise<NetInfo | null> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await rpcCall(rpcUrl, "/net_info", {}, signal) as any
        if (!result) return null

        const listening: boolean = result.listening === true
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawPeers: any[] = result.peers || []

        const peers: PeerInfo[] = rawPeers.map((p) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const ni: any = p.node_info || {}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const conn: any = p.remote_ip || ""
            const nodeId: string = ni.id || ""
            const ip: string = conn || ""
            const listenAddr: string = ni.listen_addr || ""
            const rpcAddr: string = ni.other?.rpc_address || ""

            // Extract port from listen_addr for reconstruction if needed
            const p2pAddr = nodeId && ip ? `${nodeId}@${ip}` : ""

            return {
                nodeId,
                ip,
                p2pAddr,
                moniker: ni.moniker || "",
                network: ni.network || "",
                isOutbound: p.is_outbound === true,
                remoteHeight: null, // not provided by /net_info directly
                rpcAddr: rpcAddr === "tcp://0.0.0.0:26657" ? "" : rpcAddr, // filter generic defaults
                listenAddr,
            }
        })

        return { listening, peers, peerCount: peers.length }
    } catch {
        return null
    }
}

/**
 * Batch-fetch up to `blockCount` recent blocks and compute per-block health data
 * for the 100-block heatmap visualization.
 *
 * **Chunked concurrency (default: 10 per round-trip)**
 * Instead of firing all N requests simultaneously (which public RPCs may rate-limit),
 * blocks are fetched in sequential chunks of `chunkSize` concurrent requests.
 * With 100 blocks and chunkSize=10 → 10 round-trips of 10 parallel requests each.
 *
 * Failed blocks are silently skipped — heatmap shows gaps rather than crashing.
 *
 * @param rpcUrl        RPC endpoint to query.
 * @param latestHeight  Tip height to start from.
 * @param blockCount    Number of blocks to fetch (capped at MAX_HACKER_BLOCKS=100).
 * @param signal        AbortSignal for cancellation.
 * @param chunkSize     Concurrent requests per batch (default 10). Tune per RPC limits.
 */
export async function fetchBlockHeatmap(
    rpcUrl: string,
    latestHeight: number,
    blockCount: number = 100,
    signal?: AbortSignal,
    chunkSize: number = 10,
): Promise<BlockSample[]> {
    const n = Math.min(blockCount, MAX_HACKER_BLOCKS)
    if (latestHeight < 2 || n < 1) return []

    const startHeight = Math.max(2, latestHeight - n + 1)
    const heights: number[] = []
    for (let h = latestHeight; h >= startHeight; h--) heights.push(h)

    // ── Chunked fetch ──
    // Split heights into groups of chunkSize, process each group sequentially
    // but requests within each group fire concurrently.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allBlocks: (any | null)[] = []
    for (let i = 0; i < heights.length; i += chunkSize) {
        if (signal?.aborted) break
        const chunk = heights.slice(i, i + chunkSize)
        const chunkResults = await Promise.all(
            chunk.map(h =>
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                rpcCall(rpcUrl, "/block", { height: String(h) }, signal).catch(() => null) as Promise<any>
            )
        )
        allBlocks.push(...chunkResults)
    }

    const samples: BlockSample[] = []
    for (const block of allBlocks) {
        if (!block) continue
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const header: any = block?.block?.header || {}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const precommits: any[] = block?.block?.last_commit?.precommits || []
        const signerCount = precommits.filter(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (pc: any) => pc?.validator_address && pc?.type !== 0
        ).length
        const height = parseInt(header.height || "0", 10)
        const time: string = header.time || ""

        // Total precommit slots = valset size at this block (proxy — exact valset
        // size would require a separate /validators?height= call per block)
        const valsetSize = precommits.length || 0
        const healthRatio = valsetSize > 0 ? signerCount / valsetSize : 0

        samples.push({
            height,
            signerCount,
            valsetSize,
            perfect: signerCount === valsetSize && valsetSize > 0,
            healthRatio,
            time,
        })
    }

    // Return chronologically ascending (oldest → newest) for heatmap left→right rendering
    return samples.sort((a, b) => a.height - b.height)
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

/** Format an ISO date string as relative time ("27 days ago", "Today"). */
export function formatRelativeTime(isoStr: string): string {
    if (!isoStr) return "—"
    const diffMs = Date.now() - new Date(isoStr).getTime()
    if (diffMs < 0 || isNaN(diffMs)) return "—"
    const days = Math.floor(diffMs / 86_400_000)
    if (days < 1) return "Today"
    if (days === 1) return "1 day ago"
    return `${days} days ago`
}
