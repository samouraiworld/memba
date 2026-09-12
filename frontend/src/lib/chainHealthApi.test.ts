/**
 * gnomonitoring chain health — `GET /api/chain/{chainID}/health`.
 *
 * WHY THIS REPLACES OUR OWN PARSER. `getConsensusState` reads
 * /dump_consensus_state directly and has been dead on EVERY chain for the life
 * of the feature: `round_state.votes` is an object, the code calls `.find` on
 * it, the TypeError is swallowed by a catch, and ConsensusWidget renders
 * nothing. Two further bugs sit behind it — a composite `height/round/step` key
 * gno never sends, and two proposer paths that are both absent.
 *
 * /dump_consensus_state is a node-internal debug endpoint with no schema
 * stability guarantee; three drift bugs in one payload is the evidence. It is
 * also the page's only 2s loop, at two RPC calls a tick. gnomonitoring parses it
 * server-side, once, for everyone, behind a stable REST contract.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("./config", () => ({
    GNO_MONITORING_API_URL: "https://monitoring.example",
    GNO_MONITORING_CHAIN: "gnoland-1",
}))

const { fetchChainHealth, computeBftLiveness, __resetChainHealthCacheForTests } =
    await import("./chainHealthApi")

/** Captured from a live gnoland-1 response and verified field-for-field. */
function live(over: Record<string, unknown> = {}) {
    return {
        rpc_reachable: true, is_stuck: false, is_disabled: false,
        latest_block_height: 4440, latest_block_time: "2026-09-12T21:07:18Z",
        consensus_round: 0, peer_count: 13,
        mempool_tx_count: 0, mempool_total_bytes: 0,
        validator_set: [
            { address: "g1AAA", voting_power: 60, keep_running: true, server_type: "" },
            { address: "g1BBB", voting_power: 60, keep_running: true, server_type: "cloud" },
        ],
        precommit_bitmap: { g1AAA: true, g1BBB: false },
        ...over,
    }
}

function mockJson(body: unknown, ok = true, status = 200) {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok, status, json: () => Promise.resolve(body) } as unknown as Response)))
}

describe("fetchChainHealth", () => {
    beforeEach(() => __resetChainHealthCacheForTests())
    afterEach(() => vi.unstubAllGlobals())

    it("maps the live payload, lowercasing addresses for joinability", async () => {
        mockJson(live())
        const h = (await fetchChainHealth())!

        expect(h.rpcReachable).toBe(true)
        expect(h.isStuck).toBe(false)
        expect(h.latestBlockHeight).toBe(4440)
        expect(h.consensusRound).toBe(0)
        expect(h.peerCount).toBe(13)
        expect(h.validatorSet[0].address).toBe("g1aaa")
        expect(h.validatorSet[0].votingPower).toBe(60)
        expect(h.precommits.get("g1aaa")).toBe(true)
        expect(h.precommits.get("g1bbb")).toBe(false)
    })

    it("reports an empty server_type as unknown rather than an empty string", async () => {
        // mainnet's valopers realm carries no server_type yet; "" must not render
        // as a blank column that looks like data.
        mockJson(live())
        const h = (await fetchChainHealth())!
        expect(h.validatorSet[0].serverType).toBeNull()
        expect(h.validatorSet[1].serverType).toBe("cloud")
    })

    it("targets the active monitoring chain", async () => {
        mockJson(live())
        await fetchChainHealth()
        expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain("/api/chain/gnoland-1/health")
    })

    it("surfaces a stuck chain rather than hiding it behind a reachable RPC", async () => {
        mockJson(live({ is_stuck: true }))
        expect((await fetchChainHealth())!.isStuck).toBe(true)
    })

    it("returns null when the endpoint fails — not a fabricated healthy chain", async () => {
        mockJson(null, false, 400) // unknown chain id answers 400
        expect(await fetchChainHealth()).toBeNull()
    })

    it("survives a network error", async () => {
        vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))))
        await expect(fetchChainHealth()).resolves.toBeNull()
    })
})

// ── BFT liveness ────────────────────────────────────────────────
//
// tm2 quorum is `TotalVotingPower()*2/3 + 1` with INTEGER division
// (tm2/pkg/bft/types/vote_set.go:272). On the live 4-validator mainnet set this
// arithmetic is not academic: ejecting any one validator takes the network from
// tolerating one failure to tolerating none, by a single unit of voting power.
describe("computeBftLiveness", () => {
    const set = (n: number, vp = 60) => Array.from({ length: n }, (_, i) => ({ address: `g1${i}`, votingPower: vp, keepRunning: true, serverType: null }))

    it("computes quorum with integer division, exactly as tm2 does", () => {
        expect(computeBftLiveness(set(4)).quorum).toBe(161) // 240*2/3 + 1
        expect(computeBftLiveness(set(3)).quorum).toBe(121) // 180*2/3 + 1
    })

    it("reports the live mainnet set as tolerating exactly one failure", () => {
        const l = computeBftLiveness(set(4))
        expect(l.totalVotingPower).toBe(240)
        expect(l.faultTolerance).toBe(1)
    })

    it("shows that dropping to three validators tolerates NONE", () => {
        // 180 - 60 = 120, quorum 121 — short by one unit. Every survivor then
        // holds a unilateral halt, and governance cannot fix a halted chain.
        const l = computeBftLiveness(set(3))
        expect(l.faultTolerance).toBe(0)
    })

    it("counts tolerance against the LARGEST validators, not the smallest", () => {
        // Tolerance is a worst case: losing the biggest is what tests it.
        const mixed = [
            { address: "g1a", votingPower: 100, keepRunning: true, serverType: null },
            { address: "g1b", votingPower: 10, keepRunning: true, serverType: null },
            { address: "g1c", votingPower: 10, keepRunning: true, serverType: null },
            { address: "g1d", votingPower: 10, keepRunning: true, serverType: null },
        ]
        // total 130, quorum 87. Losing the 100 leaves 30 < 87 => 0.
        expect(computeBftLiveness(mixed).faultTolerance).toBe(0)
    })

    it("handles an empty or single-validator set without dividing by zero", () => {
        expect(computeBftLiveness([]).totalVotingPower).toBe(0)
        expect(computeBftLiveness([]).faultTolerance).toBe(0)
        expect(computeBftLiveness(set(1)).faultTolerance).toBe(0)
    })
})
