import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { directRpcCall } from "../rpcFallback"
import {
    assertPathAvailable,
    clearPolicyCache,
    codeSubmissionPolicy,
    listPendingDAOs,
    packageStatus,
    recheckPendingDAOs,
    savePendingDAO,
    waitForPackage,
} from "./packageStatus"
import { assertCanDeployTo, NAMESPACE_REFUSED, realmNamespace } from "./namespace"

vi.mock("../rpcFallback", async (importOriginal) => ({ ...(await importOriginal<typeof import("../rpcFallback")>()), directRpcCall: vi.fn() }))

// Real gnoland-1 / pearl-1 answers captured read-only (see testdata/package-status/README.md).
const fixture = (name: string) => readFileSync(join(import.meta.dirname, "testdata", "package-status", `${name}.txt`), "utf8").trim()
const LIVE_PATH = "gno.land/r/sys/users"
const INERT_PATH = "gno.land/r/g1n4pl5uc4yt5r96m9w6fmdznx3x0jyg8l6arhmt/zdex/v1"
const ABSENT_PATH = "gno.land/r/nonexistent/zzz_memba_probe"
const SIGNER = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"

const ctx = { rpcUrl: "https://selected.invalid", chainId: "gnoland-1" }
let network = ctx.chainId
let answer: (path: string, data: string) => string | null
const queries: { path: string; data: string }[] = []

const encode = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)))
const decodeHex = (h: string) => new TextDecoder().decode(Uint8Array.from(h.slice(2).match(/../g) ?? [], (x) => parseInt(x, 16)))

beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    clearPolicyCache()
    network = ctx.chainId
    queries.length = 0
    answer = (path, data) => {
        if (path === "vm/qpkgmeta_json") return data === LIVE_PATH ? fixture("live") : data === INERT_PATH ? fixture("inert") : fixture("absent").replace(ABSENT_PATH, data)
        if (path === "params/vm:p:code_submission_policy") return fixture("policy-inert")
        return null
    }
    vi.mocked(directRpcCall).mockImplementation(async (_url, method, params) => {
        if (method === "status") return { node_info: { network } }
        const path = JSON.parse(params!.path)
        const data = params!.data ? decodeHex(params!.data) : ""
        queries.push({ path, data })
        const reply = answer(path, data)
        return { response: { ResponseBase: reply === null ? { Data: null, Error: { msg: "fail" } } : { Data: encode(reply), Error: null } } }
    })
})

describe("packageStatus", () => {
    it("parses the three live response shapes", async () => {
        expect(await packageStatus(ctx, LIVE_PATH)).toMatchObject({ status: "live", creator: "g1r929wt2qplfawe4lvqv9zuwfdcz4vxdun7qh8l" })
        expect(await packageStatus(ctx, INERT_PATH)).toMatchObject({ status: "inert", pending: true, max_deposit: "12000000ugnot", reason: "waiting for a package approver to enable it" })
        expect(await packageStatus(ctx, ABSENT_PATH)).toEqual({ path: ABSENT_PATH, status: "absent" })
    })

    it("refuses a wrong chain, an unknown shape and an answer for another path", async () => {
        network = "pearl-1"
        await expect(packageStatus(ctx, LIVE_PATH)).rejects.toThrow("network")
        network = ctx.chainId
        answer = () => '{"path":"gno.land/r/sys/users","status":"deleted"}'
        await expect(packageStatus(ctx, LIVE_PATH)).rejects.toThrow()
        answer = () => fixture("live")
        await expect(packageStatus(ctx, "gno.land/r/other/pkg")).rejects.toThrow("another path")
    })

    it("refuses a path that is live or waiting for approval, and allows an absent one", async () => {
        await expect(assertPathAvailable(ctx, LIVE_PATH)).rejects.toThrow("already used")
        await expect(assertPathAvailable(ctx, INERT_PATH)).rejects.toThrow("already used")
        await expect(assertPathAvailable(ctx, "gno.land/r/nym-alice123/team")).resolves.toBeUndefined()
    })

    it("a failed status query is an error, never an available path", async () => {
        answer = () => null
        await expect(assertPathAvailable(ctx, ABSENT_PATH)).rejects.toThrow("failed")
    })

    it("reads and caches the code submission policy per chain", async () => {
        expect(await codeSubmissionPolicy(ctx)).toBe("inert")
        expect(await codeSubmissionPolicy(ctx)).toBe("inert")
        expect(queries.filter((q) => q.path.startsWith("params/")).length).toBe(1)
        answer = () => fixture("policy-permissionless")
        expect(await codeSubmissionPolicy({ ...ctx, chainId: "pearl-1" }).catch(() => "wrong chain refused")).toBe("wrong chain refused")
        network = "pearl-1"
        expect(await codeSubmissionPolicy({ ...ctx, chainId: "pearl-1" })).toBe("permissionless")
    })
})

describe("waitForPackage", () => {
    const fast = { intervalMs: 3000, timeoutMs: 120_000 }
    function clock() {
        let t = 0
        return { now: () => t, sleep: async (ms: number) => { t += ms } }
    }

    it("returns live as soon as the approver enabled the package", async () => {
        let polls = 0
        answer = (path, data) => path === "vm/qpkgmeta_json" ? (++polls >= 2 ? fixture("live").replace(LIVE_PATH, data) : fixture("inert").replace(INERT_PATH, data)) : null
        const result = await waitForPackage(ctx, "gno.land/r/nym-alice123/team", { ...fast, ...clock() })
        expect(result.outcome).toBe("live")
        expect(polls).toBe(2)
    })

    it("still parked at the timeout is pending, with the chain's reason", async () => {
        const c = clock()
        const result = await waitForPackage(ctx, INERT_PATH, { ...fast, ...c })
        expect(result).toMatchObject({ outcome: "pending", meta: { reason: "waiting for a package approver to enable it" } })
        expect(c.now()).toBe(120_000)
    })

    it("absent after submission, or unreadable, is a failure", async () => {
        expect((await waitForPackage(ctx, ABSENT_PATH, { ...fast, ...clock() })).outcome).toBe("failed")
        answer = () => null
        expect(await waitForPackage(ctx, ABSENT_PATH, { ...fast, ...clock() })).toMatchObject({ outcome: "failed", error: expect.stringContaining("failed") })
    })
})

describe("pending DAOs", () => {
    it("are kept per chain and re-checked until live", async () => {
        savePendingDAO({ chainId: "gnoland-1", path: INERT_PATH, name: "Parked", txHash: "AA", reason: "r", submittedAt: 1 })
        savePendingDAO({ chainId: "gnoland-1", path: LIVE_PATH, name: "Enabled", txHash: "BB", reason: "r", submittedAt: 2 })
        savePendingDAO({ chainId: "pearl-1", path: LIVE_PATH, name: "Other chain", txHash: "CC", reason: "r", submittedAt: 3 })
        const live: string[] = []
        const still = await recheckPendingDAOs(ctx, (p) => live.push(p.name))
        expect(live).toEqual(["Enabled"])
        expect(still.map((p) => p.name)).toEqual(["Parked"])
        expect(listPendingDAOs("gnoland-1").map((p) => p.name)).toEqual(["Parked"])
        expect(listPendingDAOs("gnoland-1")[0].reason).toBe("waiting for a package approver to enable it")
        expect(listPendingDAOs("pearl-1")).toHaveLength(1)
    })

    it("ignores corrupt storage", () => {
        localStorage.setItem("memba_pending_daos", '[{"chainId":1}]')
        expect(listPendingDAOs("gnoland-1")).toEqual([])
    })
})

describe("assertCanDeployTo", () => {
    beforeEach(() => {
        answer = (path, data) => {
            if (path !== "vm/qeval") return null
            const m = /^gno\.land\/r\/sys\/names\.IsAuthorizedAddressForNamespace\(address\("(g1[a-z0-9]{38})"\), "([^"]+)"\)$/.exec(data)
            if (!m) return null
            return m[1] === SIGNER && (m[2] === SIGNER || m[2] === "nym-alice123") ? fixture("names-true") : fixture("names-false")
        }
    })

    it("allows the signer's own address and a name the chain says the signer holds", async () => {
        await expect(assertCanDeployTo(ctx, SIGNER, `gno.land/r/${SIGNER}/team`)).resolves.toBeUndefined()
        await expect(assertCanDeployTo(ctx, SIGNER, "gno.land/r/nym-alice123/team")).resolves.toBeUndefined()
        expect(queries.at(-1)?.data).toBe(`gno.land/r/sys/names.IsAuthorizedAddressForNamespace(address("${SIGNER}"), "nym-alice123")`)
    })

    it("refuses someone else's namespace", async () => {
        await expect(assertCanDeployTo(ctx, SIGNER, "gno.land/r/nym-bobby123/team")).rejects.toThrow(NAMESPACE_REFUSED)
        await expect(assertCanDeployTo(ctx, SIGNER, "gno.land/r/g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c/team")).rejects.toThrow(NAMESPACE_REFUSED)
    })

    it("fails closed on an unreadable answer and validates inputs before querying", async () => {
        answer = () => "(1 int)"
        await expect(assertCanDeployTo(ctx, SIGNER, "gno.land/r/nym-alice123/team")).rejects.toThrow("Could not verify")
        queries.length = 0
        await expect(assertCanDeployTo(ctx, SIGNER, 'gno.land/r/x"), evil("/team')).rejects.toThrow("Invalid realm path")
        await expect(assertCanDeployTo(ctx, "g1notvalid", "gno.land/r/nym-alice123/team")).rejects.toThrow("wallet")
        expect(queries).toEqual([])
        expect(realmNamespace("gno.land/r/nym-alice123/team")).toBe("nym-alice123")
    })
})
