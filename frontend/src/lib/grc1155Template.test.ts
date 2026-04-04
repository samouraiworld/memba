/**
 * grc1155Template.test.ts — Tests for GRC1155 code generation.
 *
 * v3.1: Validates generated Gno code structure.
 */

import { describe, it, expect } from "vitest"
import { generateGRC1155Code, buildDeployGRC1155Msg, type GRC1155CollectionConfig } from "./grc1155Template"

const BASE_CONFIG: GRC1155CollectionConfig = {
    realmPath: "gno.land/r/user/my_editions",
    name: "My Editions",
    uri: "https://metadata.example.com/editions/",
    description: "A test GRC1155 collection",
    adminAddress: "g1testadmin000000000000000000000000000000",
    maxPerToken: 100,
    publicMint: true,
    mintPriceUgnot: 500000,
}

describe("generateGRC1155Code", () => {
    it("generates valid Gno package declaration", () => {
        const code = generateGRC1155Code(BASE_CONFIG)
        expect(code).toMatch(/^package my_editions\n/)
    })

    it("includes collection name constant", () => {
        const code = generateGRC1155Code(BASE_CONFIG)
        expect(code).toContain('Name         = "My Editions"')
    })

    it("includes URI constant", () => {
        const code = generateGRC1155Code(BASE_CONFIG)
        expect(code).toContain("https://metadata.example.com/editions/")
    })

    it("includes admin address", () => {
        const code = generateGRC1155Code(BASE_CONFIG)
        expect(code).toContain("g1testadmin")
    })

    it("includes max per token config", () => {
        const code = generateGRC1155Code(BASE_CONFIG)
        expect(code).toContain("MaxPerToken  = 100")
    })

    it("includes public mint config", () => {
        const code = generateGRC1155Code(BASE_CONFIG)
        expect(code).toContain("PublicMint   = true")
    })

    it("includes mint price", () => {
        const code = generateGRC1155Code(BASE_CONFIG)
        expect(code).toContain("MintPrice    = int64(500000)")
    })

    it("includes Mint function", () => {
        const code = generateGRC1155Code(BASE_CONFIG)
        expect(code).toContain("func Mint(cur realm")
    })

    it("includes SafeTransferFrom function", () => {
        const code = generateGRC1155Code(BASE_CONFIG)
        expect(code).toContain("func SafeTransferFrom(cur realm")
    })

    it("includes SetApprovalForAll function", () => {
        const code = generateGRC1155Code(BASE_CONFIG)
        expect(code).toContain("func SetApprovalForAll(cur realm")
    })

    it("includes BalanceOf query", () => {
        const code = generateGRC1155Code(BASE_CONFIG)
        expect(code).toContain("func BalanceOf(owner address")
    })

    it("includes Render function", () => {
        const code = generateGRC1155Code(BASE_CONFIG)
        expect(code).toContain("func Render(path string) string")
    })

    it("includes renderToken subroute", () => {
        const code = generateGRC1155Code(BASE_CONFIG)
        expect(code).toContain('strings.HasPrefix(path, "token/")')
    })

    it("generates admin-only mint mode", () => {
        const code = generateGRC1155Code({ ...BASE_CONFIG, publicMint: false })
        expect(code).toContain("PublicMint   = false")
    })

    it("handles unlimited max per token", () => {
        const code = generateGRC1155Code({ ...BASE_CONFIG, maxPerToken: 0 })
        expect(code).toContain("MaxPerToken  = 0")
    })

    it("escapes special characters in strings", () => {
        const code = generateGRC1155Code({ ...BASE_CONFIG, name: 'Test "Quotes"' })
        expect(code).toContain('Name         = "Test \\"Quotes\\""')
    })

    it("imports required packages", () => {
        const code = generateGRC1155Code(BASE_CONFIG)
        expect(code).toContain('"gno.land/p/nt/avl/v0"')
        expect(code).toContain('"gno.land/p/nt/ufmt/v0"')
        expect(code).toContain('"chain/runtime"')
    })

    it("includes MintExisting function", () => {
        const code = generateGRC1155Code(BASE_CONFIG)
        expect(code).toContain("func MintExisting(cur realm")
    })

    it("includes TotalSupply query", () => {
        const code = generateGRC1155Code(BASE_CONFIG)
        expect(code).toContain("func TotalSupply(tid string) int64")
    })
})

describe("buildDeployGRC1155Msg", () => {
    it("builds correct MsgAddPkg", () => {
        const msg = buildDeployGRC1155Msg("g1caller", BASE_CONFIG)
        expect(msg.type).toBe("/vm.m_addpkg")
        expect(msg.value.creator).toBe("g1caller")
        expect(msg.value.package.name).toBe("my_editions")
        expect(msg.value.package.path).toBe("gno.land/r/user/my_editions")
        expect(msg.value.package.files).toHaveLength(1)
        expect(msg.value.package.files[0].name).toBe("my_editions.gno")
        expect(msg.value.package.files[0].body).toContain("package my_editions")
    })
})
