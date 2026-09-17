import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./shared", async (orig) => ({
    ...(await orig<typeof import("./shared")>()),
    queryEval: vi.fn(),
    queryRender: vi.fn(),
}))

import { queryEval, queryRender } from "./shared"
import { AbciQueryError } from "../rpcFallback"
import { NETWORKS } from "../config"
import { capabilitiesFor, clearDaoKindCache, isGovDAOPath, resolveDaoKind, GOVDAO_PATHS, type DaoKind } from "./kind"

const evalMock = vi.mocked(queryEval)
const renderMock = vi.mocked(queryRender)

const notDeclared = (expr: string) => new AbciQueryError("vm/qeval", { "@type": "/vm.UnauthorizedUserError" }, `name ${expr} not declared`)
const qstr = (s: string) => `(${JSON.stringify(s)} string)`

type Answers = { template?: string; api?: string; weighted?: string; render?: string }

function chain(answers: Answers) {
    evalMock.mockImplementation(async (_rpc, _path, expr) => {
        if (expr === "GetTemplateVersion()") { if (answers.template === undefined) throw notDeclared(expr); return answers.template }
        if (expr === "GetAPIVersion()") { if (answers.api === undefined) throw notDeclared(expr); return answers.api }
        if (expr === "GetConfigJSON()") { if (answers.weighted === undefined) throw notDeclared(expr); return answers.weighted }
        throw notDeclared(expr)
    })
    renderMock.mockImplementation(async () => {
        if (answers.render === undefined) throw new AbciQueryError("vm/qrender", "not found", "package not found")
        return answers.render
    })
}

const ctx = (realmPath: string, chainId = "pearl-1") => ({ rpcUrl: "https://rpc.example", chainId, realmPath })

const ALL_KINDS: DaoKind[] = ["govdao", "memba-v2", "memba-v1", "daokit", "weighted", "unknown"]

describe("DAO kind", () => {
    beforeEach(() => {
        clearDaoKindCache()
        evalMock.mockReset()
        renderMock.mockReset()
    })

    it("recognizes GovDAO only by exact path", () => {
        expect(GOVDAO_PATHS.has("gno.land/r/gov/dao")).toBe(true)
        expect(GOVDAO_PATHS.size).toBe(1)
        expect(isGovDAOPath("gno.land/r/gov/dao")).toBe(true)
        expect(isGovDAOPath("gno.land/r/g1evil/gov/dao")).toBe(false)
        expect(isGovDAOPath("gno.land/r/gov/dao/impl/v0")).toBe(false)
        expect(isGovDAOPath("gno.land/r/gov/dao/v3")).toBe(false)
        expect(isGovDAOPath("gno.land/r/alice/gov/daoz")).toBe(false)
    })

    it("never offers propose on GovDAO and never treasury anywhere", () => {
        const govdao = capabilitiesFor("govdao", NETWORKS.mainnet)
        expect(govdao.propose).toEqual([])
        expect(govdao.vote).toBe(true)
        expect(govdao.execute).toBe(true)
        for (const kind of ALL_KINDS) {
            expect(capabilitiesFor(kind, NETWORKS.mainnet).treasury).toBe(false)
            expect(capabilitiesFor(kind, NETWORKS.pearl).treasury).toBe(false)
        }
    })

    it("gives unknown contracts no write capability", () => {
        const c = capabilitiesFor("unknown", NETWORKS.pearl)
        expect(c.propose).toEqual([]); expect(c.vote).toBe(false); expect(c.execute).toBe(false)
    })

    it("keeps daokit and weighted DAOs read-only in the shell", () => {
        for (const kind of ["daokit", "weighted"] as const) {
            const c = capabilitiesFor(kind, NETWORKS.pearl)
            expect(c.propose).toEqual([]); expect(c.vote).toBe(false); expect(c.execute).toBe(false)
        }
    })

    it("offers text proposals only on v1 and all five kinds on v2", () => {
        expect(capabilitiesFor("memba-v1", NETWORKS.pearl).propose).toEqual(["text"])
        expect(capabilitiesFor("memba-v2", NETWORKS.pearl).propose).toEqual(["text", "add_member", "remove_member", "change_role", "archive"])
    })

    it("never offers channels on mainnet", () => {
        for (const kind of ALL_KINDS) expect(capabilitiesFor(kind, NETWORKS.mainnet).channels).toBe(false)
    })

    it("resolves the exact GovDAO path without probing", async () => {
        chain({})
        expect(await resolveDaoKind(ctx("gno.land/r/gov/dao", "gnoland-1"))).toBe("govdao")
        expect(evalMock).not.toHaveBeenCalled()
    })

    it("resolves a version-2 template by its version marker", async () => {
        chain({ template: qstr("memba-dao/2"), api: qstr("2.0") })
        expect(await resolveDaoKind(ctx("gno.land/r/alice/team"))).toBe("memba-v2")
    })

    it("resolves a version-1 template by its API version", async () => {
        chain({ api: qstr("1.0") })
        expect(await resolveDaoKind(ctx("gno.land/r/alice/team"))).toBe("memba-v1")
    })

    it("does not accept an unexpected template marker as version 2", async () => {
        chain({ template: qstr("memba-dao/3") })
        expect(await resolveDaoKind(ctx("gno.land/r/alice/team"))).toBe("unknown")
    })

    it("resolves a daokit realm from its own sub-page links", async () => {
        chain({ render: "# Memba DAO\n\n[Proposals](/r/samcrew/memba_dao:proposals) [Members](/r/samcrew/memba_dao:members)" })
        expect(await resolveDaoKind(ctx("gno.land/r/samcrew/memba_dao"))).toBe("daokit")
    })

    it("does not treat links to another realm's sub-pages as daokit", async () => {
        chain({ render: "# Lookalike\n\n[Proposals](/r/samcrew/memba_dao:proposals)" })
        expect(await resolveDaoKind(ctx("gno.land/r/alice/lookalike"))).toBe("unknown")
    })

    it("resolves a weighted host from its validated config", async () => {
        const config = {
            schema: "memba-weighted-host/v1", kind: "config", realmPath: "gno.land/r/samcrew/founders",
            rosterSize: 7, totalPoints: 8, founderWeight: 2, developerWeight: 1, votingPeriodSeconds: 604800, maxProposalPage: 50,
            mutableRoles: ["admin", "finance"],
            roleChanges: { category: "critical", weightedPoints: 6, weightedPeople: 4, weightedDelaySeconds: 86400, independentDevelopers: 5, independentDelaySeconds: 259200 },
            capabilities: { roleProposals: true, memberReplacement: false, migration: false, treasuryExecution: false, applicationActions: false },
        }
        chain({ weighted: qstr(JSON.stringify(config)), render: "# Founders" })
        expect(await resolveDaoKind(ctx("gno.land/r/samcrew/founders"))).toBe("weighted")
        // A config for a different realm path is not accepted.
        clearDaoKindCache()
        chain({ weighted: qstr(JSON.stringify({ ...config, realmPath: "gno.land/r/samcrew/other" })), render: "# Founders" })
        expect(await resolveDaoKind(ctx("gno.land/r/samcrew/founders"))).toBe("unknown")
    })

    it("a realm whose path contains /gov/dao but is not exact resolves to its probed kind", async () => {
        chain({ api: qstr("1.0") })
        expect(await resolveDaoKind(ctx("gno.land/r/alice/gov/dao"))).toBe("memba-v1")
        clearDaoKindCache()
        chain({ render: "# GovDAO" })
        expect(await resolveDaoKind(ctx("gno.land/r/bob/gov/dao"))).toBe("unknown")
    })

    it("keys the cache by chain id as well as realm path", async () => {
        chain({ api: qstr("1.0") })
        expect(await resolveDaoKind(ctx("gno.land/r/alice/team", "pearl-1"))).toBe("memba-v1")
        chain({ template: qstr("memba-dao/2") })
        // Same path, same chain → cached answer, no new probe.
        const calls = evalMock.mock.calls.length
        expect(await resolveDaoKind(ctx("gno.land/r/alice/team", "pearl-1"))).toBe("memba-v1")
        expect(evalMock.mock.calls.length).toBe(calls)
        // Same path, different chain → probed again.
        expect(await resolveDaoKind(ctx("gno.land/r/alice/team", "gnoland-1"))).toBe("memba-v2")
    })

    it("does not cache a transport failure as unknown", async () => {
        evalMock.mockRejectedValueOnce(new Error("all RPC endpoints failed"))
        await expect(resolveDaoKind(ctx("gno.land/r/alice/team"))).rejects.toThrow(/RPC/)
        chain({ api: qstr("1.0") })
        expect(await resolveDaoKind(ctx("gno.land/r/alice/team"))).toBe("memba-v1")
    })

    it("returns unknown for malformed realm paths without querying", async () => {
        chain({ api: qstr("1.0") })
        expect(await resolveDaoKind(ctx("gno.land/r/alice/team.GetAPIVersion()//x"))).toBe("unknown")
        expect(await resolveDaoKind(ctx("gno.land/r/../gov/dao"))).toBe("unknown")
        expect(evalMock).not.toHaveBeenCalled()
    })

    it("honours an aborted signal", async () => {
        chain({ api: qstr("1.0") })
        const ac = new AbortController(); ac.abort()
        await expect(resolveDaoKind(ctx("gno.land/r/alice/team"), ac.signal)).rejects.toThrow()
    })
})
