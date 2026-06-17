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

import { describe, test, expect } from "vitest"
import { parseNetPeer, mergePeerLists, type PeerInfo } from "./validators"

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
