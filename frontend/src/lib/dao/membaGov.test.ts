import { beforeEach, describe, expect, it, vi } from "vitest"
import native from "./testdata/memba-gov/native.json"
import { qevalWire } from "./testdata/weighted"
import { directRpcCall } from "../rpcFallback"
import { GovNotFound, readBridgeApproval, readGovProposal, readGovRoster, readGovSnapshot, readTargetManifest } from "./membaGov"
vi.mock("../rpcFallback", async importOriginal => ({ ...await importOriginal<typeof import("../rpcFallback")>(), directRpcCall: vi.fn() }))

const ctx = { rpcUrl: "https://selected.invalid", chainId: "onyx-1" }
const wire = (value: unknown) => ({ response: { ResponseBase: { Data: btoa(qevalWire(value)), Error: null } } })
let answers: Record<string, unknown>
let network: string
const asked: string[] = []
const manifests: Record<string, string> = {
    "gno.land/r/samcrew/memba_bridge_v1/gnomod.toml": 'module = "gno.land/r/samcrew/memba_bridge_v1"\ngno = "0.9"\n',
    "gno.land/r/alice/app/gnomod.toml": 'module = "gno.land/r/alice/app"\ngno = "0.9"\nprivate = true\n',
}

beforeEach(() => {
    vi.clearAllMocks()
    asked.length = 0
    network = ctx.chainId
    answers = {
        "gno.land/r/samcrew/memba_gov.RosterJSON()": structuredClone(native.roster),
        "gno.land/r/samcrew/memba_gov.ProposalsJSON(0, 20)": structuredClone(native.page0),
        "gno.land/r/samcrew/memba_gov.ProposalsJSON(22, 20)": structuredClone(native.page22),
        "gno.land/r/samcrew/memba_gov.ConstantsJSON()": structuredClone(native.const),
        "gno.land/r/samcrew/memba_gov.ProposalJSON(1)": structuredClone(native.one),
        "gno.land/r/samcrew/memba_gov.ProposalJSON(99)": null,
    }
    vi.mocked(directRpcCall).mockImplementation(async (_url, method, params) => {
        if (method === "status") return { node_info: { network } }
        const expr = new TextDecoder().decode(Uint8Array.from(params!.data.slice(2).match(/../g)!, h => parseInt(h, 16)))
        asked.push(expr)
        if (expr.startsWith("gno.land/r/samcrew/memba_bridge_v1.Approval(")) {
            if (expr.includes("Grant")) return { response: { ResponseBase: { Data: null, Error: { msg: "x" }, Log: "VM panic: memba_bridge: role already in that state\nstack..." } } }
            return wire(native.approval)
        }
        if (params!.path === '"vm/qfile"') {
            const manifest = manifests[expr]
            if (expr.includes("busy")) return { response: { ResponseBase: { Data: null, Error: { msg: "x" }, Log: "rate limited" } } }
            return { response: { ResponseBase: manifest === undefined ? { Data: null, Error: { msg: "x" }, Log: `file "${expr}" is not available` } : { Data: btoa(manifest), Error: null } } }
        }
        if (!(expr in answers)) throw new Error(`unexpected read ${expr}`)
        return wire(answers[expr])
    })
})

describe("memba_gov reads", () => {
    it("reads the roster, a page and the policy as the realm writes them", async () => {
        const s = await readGovSnapshot(ctx)
        expect(s.roster.members.map(m => m.id)).toEqual(["zxxma", "mikecito", "david", "lours"])
        expect(s.roster.invitations.some(i => i.id === "mikael")).toBe(true)
        expect(s.page.total).toBe("42")
        expect(s.page.proposals.map(p => p.id).slice(0, 2)).toEqual(["42", "41"])
        expect(s.constants.maxSeats).toBe(25)
        const next = await readGovSnapshot(ctx, "22")
        expect(next.page.proposals.map(p => p.id)).toEqual(Array.from({ length: 20 }, (_, i) => String(21 - i)))
        expect((await readGovRoster(ctx)).persons).toBe(4)
        await expect(readGovProposal(ctx, "99")).rejects.toBeInstanceOf(GovNotFound)
        answers["gno.land/r/samcrew/memba_gov.ConstantsJSON()"] = { ...native.const, seedInviteTTL: 7776000 }
        expect((await readGovSnapshot(ctx)).constants.maxSeats).toBe(25) // a new constant does not hide the DAO
        const one = await readGovProposal(ctx, "1")
        expect(one.ballots.map(b => b.vote)).toEqual(["yes", "yes", "yes"])
    })

    it("refuses an RPC for another chain, a page with a gap, and an altered roster", async () => {
        network = "gnoland-1"
        await expect(readGovSnapshot(ctx)).rejects.toThrow("RPC network does not match")
        network = ctx.chainId
        const page = answers["gno.land/r/samcrew/memba_gov.ProposalsJSON(0, 20)"] as typeof native.page0
        page.proposals.splice(3, 1)
        await expect(readGovSnapshot(ctx)).rejects.toThrow("Invalid proposal page")
        answers["gno.land/r/samcrew/memba_gov.ProposalsJSON(0, 20)"] = structuredClone(native.page0)
        ;(answers["gno.land/r/samcrew/memba_gov.RosterJSON()"] as typeof native.roster).weight = 9
        await expect(readGovSnapshot(ctx)).rejects.toThrow()
        answers["gno.land/r/samcrew/memba_gov.RosterJSON()"] = { ...structuredClone(native.roster), extra: 1 }
        await expect(readGovSnapshot(ctx)).rejects.toThrow()
    })

    it("says whether a target realm exists here and whether its creator can replace its code", async () => {
        expect(await readTargetManifest(ctx, "gno.land/r/samcrew/memba_bridge_v1")).toBe("public")
        expect(await readTargetManifest(ctx, "gno.land/r/alice/app")).toBe("private")
        expect(await readTargetManifest(ctx, "gno.land/r/nobody/here")).toBe("absent")
        await expect(readTargetManifest(ctx, "gno.land/r/busy/node")).rejects.toThrow("Chain read failed") // not proof of absence
        await expect(readTargetManifest(ctx, "gno.land/r/x/../y\"")).rejects.toThrow("Invalid target")
    })

    it("asks the bridge for the exact approval of a call, and says why it refuses one", async () => {
        const a = await readBridgeApproval(ctx, "s:6:SetFee|s:7:service|i:300")
        expect(a).toEqual(native.approval)
        expect(asked).toContain('gno.land/r/samcrew/memba_bridge_v1.Approval("s:6:SetFee|s:7:service|i:300")')
        await expect(readBridgeApproval(ctx, "s:5:Grant|s:13:memba_feed_v1|a:g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"))
            .rejects.toThrow("The bridge refuses this call: role already in that state")
        await expect(readBridgeApproval(ctx, 's:4:x"); Evil(')).resolves.toBeDefined() // quoted as one string literal
        expect(asked.at(-1)).toBe('gno.land/r/samcrew/memba_bridge_v1.Approval("s:4:x\\"); Evil(")')
        await expect(readBridgeApproval(ctx, "s:1:é")).rejects.toThrow("Invalid call")
    })
})
