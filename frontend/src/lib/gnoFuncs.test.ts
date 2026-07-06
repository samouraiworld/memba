import { describe, it, expect } from "vitest"
import { parseQfuncs, simplifyType, resolveFnList, formatSignature, type GnoFunc } from "./gnoFuncs"

// Shape mirrors a real test13 `vm/qfuncs` payload: the interrealm-v2 realm
// transition param `cur` reports a giant inline interface type.
const REALM_IFACE =
    "interface {.seal func(); Address func() .uverse.address; IsCode func() bool; IsCurrent func() bool}"

const SAMPLE = JSON.stringify([
    { FuncName: "PauseRealm", Params: [{ Name: "cur", Type: REALM_IFACE }] },
    {
        FuncName: "CreatePost",
        Params: [
            { Name: "cur", Type: REALM_IFACE },
            { Name: "body", Type: "string" },
        ],
        Results: [{ Name: ".res.0", Type: "uint64" }], // internal name → stripped
    },
])

describe("simplifyType", () => {
    it("collapses the realm-transition interface to 'realm'", () => {
        expect(simplifyType(REALM_IFACE)).toBe("realm")
    })
    it("passes ordinary types through verbatim", () => {
        expect(simplifyType("string")).toBe("string")
        expect(simplifyType("  []byte ")).toBe("[]byte")
    })
    it("strips the internal `.uverse.` package qualifier from builtin types", () => {
        expect(simplifyType(".uverse.address")).toBe("address")
        expect(simplifyType(".uverse.realm")).toBe("realm")
        expect(simplifyType(".uverse.int")).toBe("int")
    })
    it("strips `.uverse.` inside nested/composite types", () => {
        expect(simplifyType("[].uverse.address")).toBe("[]address")
        expect(simplifyType("*.uverse.address")).toBe("*address")
        expect(simplifyType("map[.uverse.string].uverse.address")).toBe("map[string]address")
    })
})

describe("parseQfuncs", () => {
    it("parses FuncName + Params + Results and simplifies the realm param", () => {
        const fns = parseQfuncs(SAMPLE)
        expect(fns.map((f) => f.name)).toEqual(["PauseRealm", "CreatePost"])
        expect(fns[0].params).toEqual([{ name: "cur", type: "realm" }])
        expect(fns[1].params).toEqual([
            { name: "cur", type: "realm" },
            { name: "body", type: "string" },
        ])
        expect(fns[1].results).toEqual([{ name: "", type: "uint64" }])
    })

    it("returns [] for null / malformed / non-array / entries without a name", () => {
        expect(parseQfuncs(null)).toEqual([])
        expect(parseQfuncs("not json")).toEqual([])
        expect(parseQfuncs('{"not":"an array"}')).toEqual([])
        expect(parseQfuncs('[{"Params":[]}]')).toEqual([]) // no FuncName → skipped
    })

    it("cleans `.uverse.` qualifiers on bare params/results end-to-end", () => {
        const raw = JSON.stringify([
            {
                FuncName: "Grant",
                Params: [{ Name: "to", Type: ".uverse.address" }],
                Results: [{ Name: ".res.0", Type: ".uverse.realm" }],
            },
        ])
        const [fn] = parseQfuncs(raw)
        expect(fn.params).toEqual([{ name: "to", type: "address" }])
        expect(fn.results).toEqual([{ name: "", type: "realm" }])
    })
})

describe("resolveFnList", () => {
    const fromQfuncs: GnoFunc[] = [{ name: "CreatePost", params: [{ name: "body", type: "string" }], results: [] }]

    it("prefers authoritative qfuncs signatures when present", () => {
        expect(resolveFnList(fromQfuncs, ["Ignored"])).toBe(fromQfuncs)
    })
    it("falls back to source-parser exported names (no signatures) when qfuncs is empty", () => {
        expect(resolveFnList([], ["Alpha", "Beta"])).toEqual([
            { name: "Alpha", params: [], results: [] },
            { name: "Beta", params: [], results: [] },
        ])
    })
    it("falls back when qfuncs is null, and yields [] when both are empty", () => {
        expect(resolveFnList(null, ["Only"])).toEqual([{ name: "Only", params: [], results: [] }])
        expect(resolveFnList(null, [])).toEqual([])
        expect(resolveFnList([], [])).toEqual([])
    })
})

describe("formatSignature", () => {
    const cases: Array<[GnoFunc, string]> = [
        [{ name: "Pause", params: [{ name: "cur", type: "realm" }], results: [] }, "Pause(cur realm)"],
        [
            { name: "Add", params: [{ name: "a", type: "int" }, { name: "b", type: "int" }], results: [{ name: "", type: "int" }] },
            "Add(a int, b int) int",
        ],
        [
            { name: "Get", params: [], results: [{ name: "", type: "string" }, { name: "", type: "bool" }] },
            "Get() (string, bool)",
        ],
    ]
    it.each(cases)("formats %o", (fn, want) => {
        expect(formatSignature(fn)).toBe(want)
    })
})
