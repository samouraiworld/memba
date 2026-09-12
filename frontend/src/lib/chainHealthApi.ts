/**
 * Chain health from gnomonitoring — `GET /api/chain/{chainID}/health`.
 *
 * WHY THIS EXISTS RATHER THAN OUR OWN PARSER.
 *
 * `getConsensusState` in validators.ts reads /dump_consensus_state directly and
 * has been dead on EVERY chain for the life of the feature: `round_state.votes`
 * is an object, the code calls `.find` on it, the resulting TypeError is
 * swallowed by a catch, and ConsensusWidget renders nothing at all — leaving a
 * hole in the hacker layout where live consensus should be. Two further parse
 * bugs sit behind it: a composite `height/round/step` key gno never sends, and
 * two proposer paths that are both absent from the payload.
 *
 * /dump_consensus_state is a node-internal DEBUG endpoint with no schema
 * stability guarantee — three drift bugs in one payload is the evidence, and any
 * fix has a shelf life measured in gno releases. It was also the page's only 2s
 * loop, at two RPC calls per tick, against a single host on mainnet.
 *
 * gnomonitoring parses it server-side, once, for everyone, behind a REST
 * contract, and adds what we could not compute client-side at all: a
 * per-validator precommit bitmap, a stuck-chain flag, and peer/mempool state.
 *
 * Schema captured from a live gnoland-1 response and verified field-for-field on
 * 2026-09-12. ⚠️ `valset_changes` is NOT part of this payload despite appearing
 * in an earlier inventory — do not build on it without re-measuring.
 */

import { GNO_MONITORING_API_URL, GNO_MONITORING_CHAIN } from "./config"

const FETCH_TIMEOUT_MS = 8_000
const CACHE_TTL_MS = 5_000

export interface ChainValidator {
    /** Lowercased so it joins against roster and precommit keys. */
    address: string
    votingPower: number
    keepRunning: boolean
    /** From the valopers realm. null when unset — mainnet carries no
     *  server_type yet, and "" must not render as though it were data. */
    serverType: string | null
}

export interface ChainHealth {
    rpcReachable: boolean
    /** The chain is reachable but not advancing — a liveness failure an RPC
     *  200 cannot express. */
    isStuck: boolean
    isDisabled: boolean
    latestBlockHeight: number
    latestBlockTime: string
    consensusRound: number
    peerCount: number
    mempoolTxCount: number
    mempoolTotalBytes: number
    validatorSet: ChainValidator[]
    /** Live "who has precommitted this round", keyed by lowercased address. */
    precommits: Map<string, boolean>
}

export interface BftLiveness {
    validatorCount: number
    totalVotingPower: number
    /** tm2: TotalVotingPower()*2/3 + 1, integer division. */
    quorum: number
    /** How many validators can fail simultaneously — worst case, i.e. counting
     *  the LARGEST first — while the remainder still reaches quorum. */
    faultTolerance: number
}

/**
 * BFT liveness for a validator set.
 *
 * Mirrors tm2 exactly (`tm2/pkg/bft/types/vote_set.go:272`):
 *   quorum := voteSet.valSet.TotalVotingPower()*2/3 + 1
 * Integer division matters — reproducing it with floating-point math gives a
 * different answer at the boundary, and the boundary is where this is read.
 *
 * On a small set the result is stark rather than academic: at 4 x 60 = 240 the
 * quorum is 161 and one failure is survivable; at 3 x 60 = 180 the quorum is
 * 121 and 180-60 = 120 is short by ONE unit, so no failure is survivable and
 * every remaining validator holds a unilateral halt. A halted chain cannot
 * govern itself back, because governance needs committed transactions.
 */
export function computeBftLiveness(validators: readonly ChainValidator[]): BftLiveness {
    const powers = validators.map(v => v.votingPower).sort((a, b) => b - a)
    const total = powers.reduce((a, b) => a + b, 0)
    const quorum = total > 0 ? Math.floor((total * 2) / 3) + 1 : 0

    // Worst case: remove the heaviest validators first.
    let tolerated = 0
    let remaining = total
    for (const p of powers) {
        remaining -= p
        if (remaining < quorum) break
        tolerated++
    }
    return { validatorCount: validators.length, totalVotingPower: total, quorum, faultTolerance: tolerated }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function num(v: any, fallback = 0): number {
    const n = typeof v === "number" ? v : Number(v)
    return Number.isFinite(n) ? n : fallback
}

let cache: { at: number; value: ChainHealth | null } | null = null

/** Test seam — module-level cache would otherwise leak between cases. */
export function __resetChainHealthCacheForTests(): void {
    cache = null
}

/**
 * Fetch chain health for the active monitoring chain.
 *
 * Returns null when the endpoint cannot be reached or answers with anything
 * other than a well-formed payload — never a fabricated healthy chain. An
 * unknown chain id answers HTTP 400 here, which is exactly the signal that the
 * chain is not configured upstream rather than that it is unhealthy.
 */
export async function fetchChainHealth(signal?: AbortSignal): Promise<ChainHealth | null> {
    if (!GNO_MONITORING_API_URL) return null
    if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value

    const url = new URL(`/api/chain/${encodeURIComponent(GNO_MONITORING_CHAIN)}/health`, GNO_MONITORING_API_URL)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal

    try {
        const res = await fetch(url.toString(), { signal: combined, headers: { Accept: "application/json" } })
        if (!res.ok) return null

        const b = await res.json()
        if (!b || typeof b !== "object" || Array.isArray(b)) return null

        const precommits = new Map<string, boolean>()
        for (const [addr, v] of Object.entries(b.precommit_bitmap ?? {})) {
            precommits.set(addr.toLowerCase(), v === true)
        }

        const value: ChainHealth = {
            rpcReachable: b.rpc_reachable === true,
            isStuck: b.is_stuck === true,
            isDisabled: b.is_disabled === true,
            latestBlockHeight: num(b.latest_block_height),
            latestBlockTime: typeof b.latest_block_time === "string" ? b.latest_block_time : "",
            consensusRound: num(b.consensus_round),
            peerCount: num(b.peer_count),
            mempoolTxCount: num(b.mempool_tx_count),
            mempoolTotalBytes: num(b.mempool_total_bytes),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            validatorSet: (Array.isArray(b.validator_set) ? b.validator_set : []).map((v: any) => ({
                address: String(v?.address ?? "").toLowerCase(),
                votingPower: num(v?.voting_power),
                keepRunning: v?.keep_running === true,
                serverType: typeof v?.server_type === "string" && v.server_type !== "" ? v.server_type : null,
            })),
            precommits,
        }
        cache = { at: Date.now(), value }
        return value
    } catch {
        return null
    } finally {
        clearTimeout(timeout)
    }
}
