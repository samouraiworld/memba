/**
 * Tests for /net_info peer parsing and multi-node aggregation.
 *
 * Root cause covered (2026-06-17 audit):
 *  1. gno's /net_info has NO node_info.id — the node ID lives inside
 *     node_info.net_address ("<id>@<ip>:<port>"). The old parser read
 *     node_info.id and produced empty IDs.
 *  2. /net_info is node-local; a single public RPC sees only its direct
 *     peers (5), while the union across trusted nodes sees the full set (13).
 *
 * See docs/planning/VALIDATORS_MONITORING_AUDIT_AND_PLAN.md
 */

import { describe, test, expect, vi, afterEach } from "vitest"
import { parseNetPeer, mergePeerLists, getAggregatedNetPeers, type PeerInfo } from "./validators"

// Real shape of a gno test-13 /net_info peer (trimmed).
const RAW_SENTRY = {
    node_info: {
        net_address: "g142k7zc2qym3c0u6jmkf6rv26llgr2f4nakmlmt@54.145.44.95:26656",
        network: "test-13",
        moniker: "gno-core-sentry-01",
        other: { tx_index: "off", rpc_address: "tcp://127.0.0.1:26657" },
    },
    is_outbound: false,
    remote_ip: "54.145.44.95",
}

const RAW_VAL = {
    node_info: {
        net_address: "g1validator00000000000000000000000000000000@10.0.0.2:26656",
        network: "test-13",
        moniker: "gno-core-val-01",
        other: { rpc_address: "tcp://0.0.0.0:26657" },
    },
    is_outbound: true,
    remote_ip: "10.0.0.2",
}

describe("parseNetPeer", () => {
    test("extracts nodeId from net_address (not node_info.id)", () => {
        const p = parseNetPeer(RAW_SENTRY)
        expect(p.nodeId).toBe("g142k7zc2qym3c0u6jmkf6rv26llgr2f4nakmlmt")
    })

    test("uses remote_ip as the observed peer IP", () => {
        expect(parseNetPeer(RAW_SENTRY).ip).toBe("54.145.44.95")
    })

    test("p2pAddr is the full net_address", () => {
        expect(parseNetPeer(RAW_SENTRY).p2pAddr).toBe(
            "g142k7zc2qym3c0u6jmkf6rv26llgr2f4nakmlmt@54.145.44.95:26656",
        )
    })

    test("carries moniker, network and outbound flag", () => {
        const p = parseNetPeer(RAW_VAL)
        expect(p.moniker).toBe("gno-core-val-01")
        expect(p.network).toBe("test-13")
        expect(p.isOutbound).toBe(true)
    })

    test("strips loopback/wildcard default rpc addresses", () => {
        expect(parseNetPeer(RAW_SENTRY).rpcAddr).toBe("") // 127.0.0.1:26657
        expect(parseNetPeer(RAW_VAL).rpcAddr).toBe("") // 0.0.0.0:26657
    })

    test("a freshly parsed peer starts seen by one node", () => {
        expect(parseNetPeer(RAW_SENTRY).seenByCount).toBe(1)
    })

    test("does not throw on malformed input", () => {
        expect(() => parseNetPeer({})).not.toThrow()
        expect(parseNetPeer({}).nodeId).toBe("")
    })
})

describe("mergePeerLists (multi-node aggregation)", () => {
    const A = parseNetPeer(RAW_SENTRY)
    const B = parseNetPeer(RAW_VAL)
    const C = parseNetPeer({
        node_info: { net_address: "g1cccc@1.2.3.4:26656", moniker: "moul-1", network: "test-13" },
        is_outbound: true,
        remote_ip: "1.2.3.4",
    })

    test("unions peers across nodes, deduping by nodeId", () => {
        // Node1 sees A,B ; Node2 sees B,C  → union = A,B,C
        const merged = mergePeerLists([[A, B], [B, C]])
        const ids = merged.map((p) => p.nodeId).sort()
        expect(ids).toEqual([A.nodeId, B.nodeId, C.nodeId].sort())
        expect(merged).toHaveLength(3)
    })

    test("seenByCount reflects how many source nodes reported the peer", () => {
        const merged = mergePeerLists([[A, B], [B, C]])
        const byId = Object.fromEntries(merged.map((p) => [p.nodeId, p]))
        expect(byId[B.nodeId].seenByCount).toBe(2) // seen by both nodes
        expect(byId[A.nodeId].seenByCount).toBe(1)
        expect(byId[C.nodeId].seenByCount).toBe(1)
    })

    test("a node only reachable via one RPC still appears (the actual bug)", () => {
        // Primary RPC sees only sentries; aeddi-1 additionally sees the validator.
        const primary = [A]
        const aeddi = [A, B]
        const merged = mergePeerLists([primary, aeddi])
        expect(merged.some((p) => p.moniker === "gno-core-val-01")).toBe(true)
    })

    test("empty/failed node lists are tolerated", () => {
        const merged = mergePeerLists([[], [A], []])
        expect(merged).toHaveLength(1)
    })

    test("falls back to moniker+ip key when nodeId is missing", () => {
        const noId1: PeerInfo = { ...A, nodeId: "", moniker: "x", ip: "9.9.9.9" }
        const noId2: PeerInfo = { ...A, nodeId: "", moniker: "x", ip: "9.9.9.9" }
        const merged = mergePeerLists([[noId1], [noId2]])
        expect(merged).toHaveLength(1)
        expect(merged[0].seenByCount).toBe(2)
    })
})

// ── getAggregatedNetPeers routing (regression for the "always primary" bug) ──
// The original getNetPeers routed through the resilient RPC layer, which ignores
// the URL and always hits the global primary — so aggregation queried ONE node
// N times and returned its 5 peers instead of the network's ~14. These tests
// mock fetch per-URL and assert distinct nodes are actually contacted.

function netInfoResponse(peers: unknown[]) {
    return { ok: true, json: async () => ({ result: { listening: true, peers } }) } as unknown as Response
}
function peerRaw(id: string, moniker: string) {
    return {
        node_info: { net_address: `${id}@1.2.3.4:26656`, moniker, network: "test-13" },
        remote_ip: "1.2.3.4",
        is_outbound: false,
    }
}

describe("getAggregatedNetPeers (per-node routing)", () => {
    afterEach(() => vi.restoreAllMocks())

    test("queries each distinct node and unions their peers", async () => {
        const byUrl: Record<string, unknown[]> = {
            "https://a.example/net_info": [peerRaw("g1a", "A"), peerRaw("g1shared", "S")],
            "https://b.example/net_info": [peerRaw("g1b", "B"), peerRaw("g1shared", "S")],
        }
        const fetchMock = vi.fn(async (url: string | URL) => {
            const key = String(url)
            const match = Object.keys(byUrl).find((k) => key.startsWith(k))
            if (!match) throw new Error("unexpected url " + key)
            return netInfoResponse(byUrl[match])
        })
        vi.stubGlobal("fetch", fetchMock)

        const res = await getAggregatedNetPeers(["https://a.example", "https://b.example"])
        expect(res).not.toBeNull()
        expect(res!.peerCount).toBe(3) // A, B, shared (deduped)

        const urls = fetchMock.mock.calls.map((c) => String(c[0]))
        expect(urls.some((u) => u.startsWith("https://a.example"))).toBe(true)
        expect(urls.some((u) => u.startsWith("https://b.example"))).toBe(true)

        const shared = res!.peers.find((p) => p.nodeId === "g1shared")
        expect(shared!.seenByCount).toBe(2)
    })

    test("skips a node that fails, still returns the others", async () => {
        const fetchMock = vi.fn(async (url: string | URL) => {
            if (String(url).startsWith("https://dead.example")) throw new Error("network")
            return netInfoResponse([peerRaw("g1x", "X")])
        })
        vi.stubGlobal("fetch", fetchMock)

        const res = await getAggregatedNetPeers(["https://dead.example", "https://ok.example"])
        expect(res!.peerCount).toBe(1)
    })

    test("returns null only when every node fails", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down") }))
        const res = await getAggregatedNetPeers(["https://a.example", "https://b.example"])
        expect(res).toBeNull()
    })

    test("deduplicates repeated URLs so a node isn't queried twice", async () => {
        const fetchMock = vi.fn(async () => netInfoResponse([peerRaw("g1a", "A")]))
        vi.stubGlobal("fetch", fetchMock)
        await getAggregatedNetPeers(["https://a.example", "https://a.example"])
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })
})
