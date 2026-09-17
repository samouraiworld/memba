import { describe, expect, it } from "vitest"
import govdao from "./testdata/funcs/govdao-gnoland-1.json"
import membaV1 from "./testdata/funcs/memba-v1.json"
import membaV2 from "./testdata/funcs/memba-v2.json"
import { buildDaoMsg, type DaoAction } from "./builders"
import type { DaoKind } from "./kind"
import { isValidGnoAddressChecksum } from "./address"

type Fixture = Array<{ FuncName: string; Params: Array<{ Name: string }> | null }>

const names = (fx: Fixture) => new Set(fx.map(f => f.FuncName))
/** MsgCall args exclude the crossing `cur realm` parameter. */
const arity = (fx: Fixture, func: string) => (fx.find(f => f.FuncName === func)?.Params ?? []).filter(p => p.Name !== "cur").length

const CALLER = "g1manfred47kzduec920z88wfr64ylksmdcedlf5"
const TARGET = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"

const ALL_ACTIONS: DaoAction[] = [
    { type: "vote", id: 1, vote: "YES" },
    { type: "execute", id: 1 },
    { type: "propose-text", title: "t", description: "d", category: "governance" },
    { type: "propose-add-member", title: "t", description: "d", target: TARGET, power: 1, roles: ["member"] },
    { type: "propose-remove-member", title: "t", description: "d", target: TARGET },
    { type: "propose-change-role", title: "t", description: "d", target: TARGET, roles: ["dev"] },
    { type: "propose-archive", title: "t", description: "d" },
]

const SUPPORTED: Record<DaoKind, { fixture: Fixture | null; actions: DaoAction["type"][] }> = {
    govdao: { fixture: govdao as Fixture, actions: ["vote", "execute"] },
    "memba-v1": { fixture: membaV1 as Fixture, actions: ["vote", "execute", "propose-text", "propose-add-member", "propose-remove-member", "propose-change-role"] },
    "memba-v2": { fixture: membaV2 as Fixture, actions: ["vote", "execute", "propose-text", "propose-add-member", "propose-remove-member", "propose-change-role", "propose-archive"] },
    daokit: { fixture: null, actions: [] },
    weighted: { fixture: null, actions: [] },
    unknown: { fixture: null, actions: [] },
}

describe("builders only call functions the target exports", () => {
    it("test addresses are valid", () => {
        expect(isValidGnoAddressChecksum(CALLER)).toBe(true)
        expect(isValidGnoAddressChecksum(TARGET)).toBe(true)
    })

    it("GovDAO vote/execute names exist on gnoland-1", () => {
        for (const action of [{ type: "vote", id: 1, vote: "YES" }, { type: "execute", id: 1 }] as const) {
            const msg = buildDaoMsg("govdao", "gno.land/r/gov/dao", action, CALLER)
            expect(names(govdao as Fixture)).toContain(msg.value.func)
        }
    })

    it("refuses propose on GovDAO", () => {
        expect(() => buildDaoMsg("govdao", "gno.land/r/gov/dao", { type: "propose-text", title: "t", description: "d", category: "governance" }, CALLER)).toThrow(/not supported/)
    })

    it("refuses any write on unknown and daokit kinds", () => {
        expect(() => buildDaoMsg("unknown", "gno.land/r/x/y", { type: "execute", id: 1 }, CALLER)).toThrow(/not supported/)
        expect(() => buildDaoMsg("daokit", "gno.land/r/x/y", { type: "execute", id: 1 }, CALLER)).toThrow(/not supported/)
        expect(() => buildDaoMsg("weighted", "gno.land/r/samcrew/x", { type: "vote", id: 1, vote: "NO" }, CALLER)).toThrow(/not supported/)
    })

    it("refuses the GovDAO kind on any path other than GovDAO", () => {
        expect(() => buildDaoMsg("govdao", "gno.land/r/alice/gov/dao", { type: "vote", id: 1, vote: "YES" }, CALLER)).toThrow(/not supported/)
    })

    for (const [kind, spec] of Object.entries(SUPPORTED) as Array<[DaoKind, typeof SUPPORTED[DaoKind]]>) {
        it(`${kind}: every built message targets an exported function with the right argument count`, () => {
            const realm = kind === "govdao" ? "gno.land/r/gov/dao" : "gno.land/r/alice/team"
            for (const action of ALL_ACTIONS) {
                if (!spec.actions.includes(action.type)) {
                    expect(() => buildDaoMsg(kind, realm, action, CALLER), `${kind} ${action.type}`).toThrow(/not supported/)
                    continue
                }
                const msg = buildDaoMsg(kind, realm, action, CALLER)
                expect(msg.type).toBe("vm/MsgCall")
                expect(msg.value.pkg_path).toBe(realm)
                expect(msg.value.caller).toBe(CALLER)
                expect(msg.value.send).toBe("")
                expect(names(spec.fixture!), `${kind} ${action.type}`).toContain(msg.value.func)
                expect((msg.value.args as string[]).length, `${kind} ${msg.value.func}`).toBe(arity(spec.fixture!, msg.value.func as string))
            }
        })
    }

    it("never builds unilateral role or archive calls for version-1 DAOs", () => {
        const funcs = ALL_ACTIONS.flatMap(a => { try { return [buildDaoMsg("memba-v1", "gno.land/r/alice/team", a, CALLER).value.func] } catch { return [] } })
        for (const f of ["AssignRole", "RemoveRole", "Archive"]) expect(funcs).not.toContain(f)
    })

    it("validates ids, votes, targets and power before building", () => {
        const realm = "gno.land/r/alice/team"
        expect(() => buildDaoMsg("memba-v2", realm, { type: "vote", id: -1, vote: "YES" }, CALLER)).toThrow()
        expect(() => buildDaoMsg("memba-v2", realm, { type: "vote", id: 1.5, vote: "YES" }, CALLER)).toThrow()
        expect(() => buildDaoMsg("memba-v2", realm, { type: "vote", id: 1, vote: "MAYBE" as "YES" }, CALLER)).toThrow()
        expect(() => buildDaoMsg("memba-v2", realm, { type: "propose-remove-member", title: "t", description: "d", target: "g1notanaddress" }, CALLER)).toThrow()
        // A single flipped character breaks the checksum.
        expect(() => buildDaoMsg("memba-v2", realm, { type: "propose-remove-member", title: "t", description: "d", target: TARGET.slice(0, -1) + "4" }, CALLER)).toThrow()
        expect(() => buildDaoMsg("memba-v2", realm, { type: "propose-add-member", title: "t", description: "d", target: TARGET, power: 0, roles: ["member"] }, CALLER)).toThrow()
        expect(() => buildDaoMsg("memba-v2", realm, { type: "propose-add-member", title: "t", description: "d", target: TARGET, power: 1, roles: ["bad role"] }, CALLER)).toThrow()
        expect(() => buildDaoMsg("memba-v2", "gno.land/r/alice/team.Evil()", { type: "execute", id: 1 }, CALLER)).toThrow()
        expect(() => buildDaoMsg("memba-v2", realm, { type: "execute", id: 1 }, "")).toThrow()
    })

    it("serializes GovDAO and v2 arguments in ABI order", () => {
        expect(buildDaoMsg("govdao", "gno.land/r/gov/dao", { type: "vote", id: 4, vote: "NO" }, CALLER).value).toMatchObject({ func: "MustVoteOnProposalSimple", args: ["4", "NO"] })
        expect(buildDaoMsg("govdao", "gno.land/r/gov/dao", { type: "execute", id: 4 }, CALLER).value).toMatchObject({ func: "ExecuteOrRejectProposal", args: ["4"] })
        expect(buildDaoMsg("memba-v2", "gno.land/r/alice/team", { type: "propose-add-member", title: "Add", description: "why", target: TARGET, power: 3, roles: ["dev", "ops"] }, CALLER).value)
            .toMatchObject({ func: "ProposeAddMember", args: ["Add", "why", TARGET, "3", "dev,ops"] })
        expect(buildDaoMsg("memba-v1", "gno.land/r/alice/team", { type: "propose-add-member", title: "Add", description: "why", target: TARGET, power: 3, roles: ["dev", "ops"] }, CALLER).value)
            .toMatchObject({ func: "ProposeAddMember", args: [TARGET, "3", "dev,ops"] })
    })
})
