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

describe("generateImportBlock", () => {
    it("generates a single stdlib import", () => {
        const result = generateImportBlock(["chain/runtime"])
        expect(result).toContain('"chain/runtime"')
        expect(result).toMatch(/^import \(/)
    })

    it("separates stdlib and external imports", () => {
        const result = generateImportBlock(["strconv", "gno.land/p/demo/avl"])
        // stdlib first, then a blank line, then external
        const lines = result.split("\n")
        const strconvIdx = lines.findIndex(l => l.includes('"strconv"'))
        const avlIdx = lines.findIndex(l => l.includes('"gno.land/p/demo/avl"'))
        expect(strconvIdx).toBeLessThan(avlIdx)
    })

    it("groups multiple stdlib imports together", () => {
        const result = generateImportBlock(["chain/runtime", "strconv", "strings"])
        expect(result).toContain('"chain/runtime"')
        expect(result).toContain('"strconv"')
        expect(result).toContain('"strings"')
    })

    it("groups multiple external imports together", () => {
        const result = generateImportBlock(["gno.land/p/demo/avl", "gno.land/p/demo/ufmt"])
        expect(result).toContain('"gno.land/p/demo/avl"')
        expect(result).toContain('"gno.land/p/demo/ufmt"')
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

    it("passes deposit amount", () => {
        const msg = buildDeployMsg("g1test", "gno.land/r/test/dao", "// code", "1000000ugnot")
        expect(msg.value.deposit).toBe("1000000ugnot")
    })

    it("defaults deposit to empty string", () => {
        const msg = buildDeployMsg("g1test", "gno.land/r/test/dao", "// code")
        expect(msg.value.deposit).toBe("")
    })
})
