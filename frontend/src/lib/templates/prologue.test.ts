/**
 * Template Prologue Tests — verifies shared code generation utilities.
 */

import { describe, it, expect } from "vitest"
import {
    generateImportBlock,
    generateGnomodToml,
    generatePackageDecl,
    buildDeployMsg,
} from "./prologue"
import { toAdenaMessages } from "../grc20"

describe("generateImportBlock", () => {
    it("generates a single stdlib import", () => {
        const result = generateImportBlock(["chain/runtime"])
        expect(result).toContain('"chain/runtime"')
        expect(result).toMatch(/^import \(/)
    })

    it("separates stdlib and external imports", () => {
        const result = generateImportBlock(["strconv", "gno.land/p/nt/avl/v0"])
        // stdlib first, then a blank line, then external
        const lines = result.split("\n")
        const strconvIdx = lines.findIndex(l => l.includes('"strconv"'))
        const avlIdx = lines.findIndex(l => l.includes('"gno.land/p/nt/avl/v0"'))
        expect(strconvIdx).toBeLessThan(avlIdx)
    })

    it("groups multiple stdlib imports together", () => {
        const result = generateImportBlock(["chain/runtime", "strconv", "strings"])
        expect(result).toContain('"chain/runtime"')
        expect(result).toContain('"strconv"')
        expect(result).toContain('"strings"')
    })

    it("groups multiple external imports together", () => {
        const result = generateImportBlock(["gno.land/p/nt/avl/v0", "gno.land/p/nt/ufmt/v0"])
        expect(result).toContain('"gno.land/p/nt/avl/v0"')
        expect(result).toContain('"gno.land/p/nt/ufmt/v0"')
    })
})

describe("generateGnomodToml", () => {
    it("uses module field (NOT pkgpath)", () => {
        const result = generateGnomodToml("gno.land/r/samcrew/memba_dao")
        expect(result).toContain('module = "gno.land/r/samcrew/memba_dao"')
        expect(result).toContain('gno = "0.9"')
        expect(result).not.toContain("pkgpath")
    })
})

describe("generatePackageDecl", () => {
    it("extracts package name from realm path", () => {
        expect(generatePackageDecl("gno.land/r/samcrew/memba_dao")).toBe("package memba_dao")
    })

    it("handles nested paths", () => {
        expect(generatePackageDecl("gno.land/r/samcrew/lab/myoft")).toBe("package myoft")
    })
})

describe("buildDeployMsg", () => {
    it("creates valid MsgAddPackage", () => {
        const msg = buildDeployMsg(
            "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5",
            "gno.land/r/samcrew/test_dao",
            '// code here',
        )
        expect(msg.type).toBe("/vm.m_addpkg")
        expect(msg.value.creator).toBe("g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5")
        expect(msg.value.package.name).toBe("test_dao")
        expect(msg.value.package.path).toBe("gno.land/r/samcrew/test_dao")
    })

    it("sorts files alphabetically", () => {
        const msg = buildDeployMsg("g1test", "gno.land/r/samcrew/test_dao", "// code")
        const names = msg.value.package.files.map(f => f.name)
        const sorted = [...names].sort()
        expect(names).toEqual(sorted)
    })

    it("includes gnomod.toml with correct module path", () => {
        const msg = buildDeployMsg("g1test", "gno.land/r/samcrew/test_dao", "// code")
        const gnomod = msg.value.package.files.find(f => f.name === "gnomod.toml")
        expect(gnomod).toBeDefined()
        expect(gnomod!.body).toContain('module = "gno.land/r/samcrew/test_dao"')
    })

    // The chain reads `max_deposit`; an unknown `deposit` key was silently ignored.
    it("sends the cap as max_deposit, with an empty send and no deposit key", () => {
        const msg = buildDeployMsg("g1test", "gno.land/r/test/dao", "// code", "13000000ugnot")
        expect(msg.value.max_deposit).toBe("13000000ugnot")
        expect(msg.value.send).toBe("")
        expect(Object.keys(msg.value).sort()).toEqual(["creator", "max_deposit", "package", "send"])
        expect(msg.value).not.toHaveProperty("deposit")
    })

    it("defaults max_deposit to empty (no explicit cap)", () => {
        const msg = buildDeployMsg("g1test", "gno.land/r/test/dao", "// code")
        expect(msg.value.max_deposit).toBe("")
    })

    it.each(["0ugnot", "10GNOT", "1000", "-5ugnot", "1ugnot,1foo", " 5ugnot"])("refuses a malformed max_deposit: %s", (value) => {
        expect(() => buildDeployMsg("g1test", "gno.land/r/test/dao", "// code", value)).toThrow(/max deposit/i)
    })

    it("the wallet payload keeps max_deposit unchanged", () => {
        const msg = buildDeployMsg("g1test", "gno.land/r/test/dao", "// code", "13000000ugnot")
        const [payload] = toAdenaMessages([msg])
        expect(payload).toEqual(msg)
        expect((payload.value as Record<string, unknown>).max_deposit).toBe("13000000ugnot")
        expect(payload.value).not.toHaveProperty("deposit")
    })
})

// ── Path validation at the shared choke point ────────────────
//
// These three all interpolate realmPath into bytes that become an immutable
// realm: the package declaration, the gnomod manifest, and the deploy message.
// Each generator already validates its own path, but buildDeployMsg's doc
// comment steers callers here directly, so the choke point validates too —
// otherwise the next flow built on it silently inherits no protection.
describe("realm path validation", () => {
    const INJECTIONS: [string, string][] = [
        ["a newline breaking out of the package declaration", "gno.land/r/x/c\n\nfunc Backdoor() {}"],
        ["a quote breaking out of the gnomod module value", 'gno.land/r/x/c"\nevil = "1'],
        ["path traversal", "gno.land/r/x/../../evil"],
        ["a non-realm path", "https://evil.example/r/x/c"],
        ["empty", ""],
    ]

    it.each(INJECTIONS)("generatePackageDecl rejects %s", (_label, path) => {
        expect(() => generatePackageDecl(path)).toThrow(/Invalid realmPath/)
    })

    it.each(INJECTIONS)("generateGnomodToml rejects %s", (_label, path) => {
        expect(() => generateGnomodToml(path)).toThrow(/Invalid realmPath/)
    })

    it.each(INJECTIONS)("buildDeployMsg rejects %s", (_label, path) => {
        expect(() => buildDeployMsg("g1test", path, "// code")).toThrow(/Invalid realmPath/)
    })

    it("still accepts the paths it always did", () => {
        // Guard against over-tightening: the valid shapes the existing tests
        // above rely on must keep working, including a nested path.
        expect(generatePackageDecl("gno.land/r/samcrew/memba_dao")).toBe("package memba_dao")
        expect(generatePackageDecl("gno.land/r/samcrew/lab/myoft")).toBe("package myoft")
        expect(generateGnomodToml("gno.land/r/samcrew/memba_dao")).toContain('module = "gno.land/r/samcrew/memba_dao"')
        expect(() => buildDeployMsg("g1test", "gno.land/r/test/dao", "// code")).not.toThrow()
    })
})

