/**
 * Tests for the Network Nodes roster (Phase 2b).
 *
 * The roster is peer-based: consensus validators, valopers and peers live in
 * three different address spaces (consensus addr ≠ valoper addr ≠ P2P node-id),
 * so they cannot be joined by address. We therefore present the full node roster
 * from /net_info, tagging each node's role via moniker heuristics + the valoper
 * moniker set. See docs/planning/VALIDATORS_MONITORING_AUDIT_AND_PLAN.md §2b.
 */

import { describe, test, expect } from "vitest"
import { deriveNodeRole, buildNodeRoster, parseNetPeer, type NetInfo } from "./validators"

const peer = (moniker: string, nodeId = "g1" + moniker.replace(/\W/g, "")) =>
    parseNetPeer({
        node_info: { net_address: `${nodeId}@1.2.3.4:26656`, moniker, network: "test-13" },
        remote_ip: "1.2.3.4",
        is_outbound: false,
    })

describe("deriveNodeRole", () => {
    const valopers = new Set(["gfanton-1", "aeddi-1"])

    test("detects validators by moniker pattern", () => {
        expect(deriveNodeRole("gno-core-val-01", valopers)).toBe("validator")
        expect(deriveNodeRole("gno-core-val-02", valopers)).toBe("validator")
    })

    test("detects validators registered in the valoper set", () => {
        expect(deriveNodeRole("gfanton-1", valopers)).toBe("validator")
        expect(deriveNodeRole("aeddi-1", valopers)).toBe("validator")
    })

    test("classifies sentry / rpc / snapshot nodes", () => {
        expect(deriveNodeRole("gno-core-sentry-01", valopers)).toBe("sentry")
        expect(deriveNodeRole("samourai-dev-sentry-1", valopers)).toBe("sentry")
        expect(deriveNodeRole("onbloc-test13-rpc-i-026d", valopers)).toBe("rpc")
        expect(deriveNodeRole("gno-core-snapshot-01", valopers)).toBe("snapshot")
    })

    test("falls back to generic node", () => {
        expect(deriveNodeRole("samourai-crew-1", valopers)).toBe("node")
        expect(deriveNodeRole("moul-1", valopers)).toBe("node")
        expect(deriveNodeRole("", valopers)).toBe("node")
    })

    test("does not false-positive 'val' inside an unrelated word", () => {
        expect(deriveNodeRole("interval-node", new Set())).toBe("node")
        expect(deriveNodeRole("naval-1", new Set())).toBe("node")
    })
})

describe("buildNodeRoster", () => {
    const valopers = new Set(["gfanton-1"])
    const netInfo: NetInfo = {
        listening: true,
        peerCount: 5,
        peers: [
            peer("moul-1"),
            peer("gno-core-rpc-i-01"),
            peer("gno-core-val-01"),
            peer("gfanton-1"),
            peer("gno-core-sentry-01"),
        ],
    }

    test("returns one row per peer with a role", () => {
        const rows = buildNodeRoster(netInfo, valopers)
        expect(rows).toHaveLength(5)
        expect(rows.every(r => typeof r.role === "string")).toBe(true)
    })

    test("orders validators first, generic nodes last", () => {
        const rows = buildNodeRoster(netInfo, valopers)
        expect(rows[0].role).toBe("validator")
        expect(rows[rows.length - 1].role).toBe("node")
    })

    test("groups validators together (val-01 and gfanton-1)", () => {
        const roles = buildNodeRoster(netInfo, valopers).map(r => r.role)
        const firstNode = roles.indexOf("node")
        // every validator index is before the first generic node
        roles.forEach((r, i) => { if (r === "validator") expect(i).toBeLessThan(firstNode) })
        expect(roles.filter(r => r === "validator")).toHaveLength(2)
    })

    test("preserves peer fields (nodeId, ip, seenByCount)", () => {
        const row = buildNodeRoster(netInfo, valopers).find(r => r.moniker === "gno-core-val-01")!
        expect(row.nodeId).toBeTruthy()
        expect(row.ip).toBe("1.2.3.4")
        expect(row.seenByCount).toBe(1)
    })

    test("null netInfo yields an empty roster", () => {
        expect(buildNodeRoster(null, valopers)).toEqual([])
    })
})
