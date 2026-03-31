/**
 * nftTemplate.test.ts — Comprehensive tests for the NFT collection template.
 *
 * Covers:
 * 1. Chain API compliance (runtime.*, banker.*, no std.* usage)
 * 2. Security patterns (access control, bounds checks, state management)
 * 3. GRC721 core (ownership, transfers, approvals, mint/burn)
 * 4. Royalty (ERC2981 compliance)
 * 5. Render helpers (gallery display, token pages)
 * 6. Config embedding & string escaping
 * 7. MsgCall builders (deployment message structure)
 */

import { describe, it, expect } from "vitest"
import {
    generateNFTCollectionCode,
    buildDeployNFTCollectionMsg,
    type NFTCollectionConfig,
} from "./nftTemplate"

// ── Fixtures ──────────────────────────────────────────────────

const DEFAULT_CONFIG: NFTCollectionConfig = {
    realmPath: "gno.land/r/test/nft",
    name: "Test NFT Collection",
    symbol: "TNFT",
    description: "A test NFT collection for unit testing",
    adminAddress: "g1adminaddr1234",
    maxSupply: 100,
    royaltyPercent: 5,
    publicMint: true,
    mintPrice: 1000000,
}

function getCode(): string {
    return generateNFTCollectionCode(DEFAULT_CONFIG)
}

function getImportBlock(code: string): string {
    return code.match(/import \([\s\S]*?\)/)?.[0] || ""
}

function getFuncBody(code: string, funcName: string, nextFuncName?: string): string {
    const start = code.indexOf(`func ${funcName}`)
    if (start === -1) return ""
    const end = nextFuncName ? code.indexOf(`func ${nextFuncName}`) : code.length
    return code.slice(start, end === -1 ? code.length : end)
}

// ── 1. Chain API Compliance ───────────────────────────────────

describe("generateNFTCollectionCode — chain API compliance", () => {
    it("generates valid package declaration from realm path", () => {
        expect(getCode()).toContain("package nft")
    })

    it("imports chain/banker and chain/runtime, NOT std", () => {
        const importBlock = getImportBlock(getCode())
        expect(importBlock).toContain('"chain/banker"')
        expect(importBlock).toContain('"chain/runtime"')
        expect(importBlock).not.toContain('"std"')
    })

    it("uses runtime.PreviousRealm().Address() for caller identity", () => {
        const code = getCode()
        expect(code).toContain("runtime.PreviousRealm().Address()")
        expect(code).not.toContain("std.PreviousRealm()")
        expect(code).not.toContain("chain.PreviousRealm()")
        expect(code).not.toContain(".Addr()")
    })

    it("uses banker.OriginSend() for payment checks", () => {
        const code = getCode()
        expect(code).toContain("banker.OriginSend()")
        expect(code).not.toContain("std.GetOrigSend")
        expect(code).not.toContain("chain.OrigSend")
    })

    it("uses address type (not std.Address)", () => {
        const code = getCode()
        expect(code).toContain("func BalanceOf(owner address)")
        expect(code).toContain("func OwnerOf(tokenId string) address")
        expect(code).not.toContain("std.Address")
    })

    it("does NOT contain any deprecated std.* API anywhere", () => {
        expect(getCode()).not.toMatch(/\bstd\.\w/)
    })

    it("does NOT import std package", () => {
        const importBlock = getImportBlock(getCode())
        expect(importBlock).not.toContain('"std"')
    })

    it("uses custom package name derived from realm path", () => {
        const config = { ...DEFAULT_CONFIG, realmPath: "gno.land/r/org/my_nft_v2" }
        expect(generateNFTCollectionCode(config)).toContain("package my_nft_v2")
    })
})

// ── 2. Config Embedding ──────────────────────────────────────

describe("generateNFTCollectionCode — config embedding", () => {
    it("embeds collection name", () => {
        expect(getCode()).toContain(`CollectionName   = "${DEFAULT_CONFIG.name}"`)
    })

    it("embeds collection symbol", () => {
        expect(getCode()).toContain(`CollectionSymbol = "${DEFAULT_CONFIG.symbol}"`)
    })

    it("embeds collection description", () => {
        expect(getCode()).toContain(`CollectionDesc   = "${DEFAULT_CONFIG.description}"`)
    })

    it("embeds admin address", () => {
        expect(getCode()).toContain(`AdminAddress     = "${DEFAULT_CONFIG.adminAddress}"`)
    })

    it("embeds maxSupply", () => {
        expect(getCode()).toContain(`MaxSupply        = ${DEFAULT_CONFIG.maxSupply}`)
    })

    it("embeds royaltyPercent", () => {
        expect(getCode()).toContain(`RoyaltyPercent   = ${DEFAULT_CONFIG.royaltyPercent}`)
    })

    it("embeds publicMint boolean", () => {
        expect(getCode()).toContain(`PublicMint       = ${DEFAULT_CONFIG.publicMint}`)
    })

    it("embeds mintPrice as int64", () => {
        expect(getCode()).toContain(`MintPrice        = int64(${DEFAULT_CONFIG.mintPrice})`)
    })

    it("escapes quotes in collection name", () => {
        const config = { ...DEFAULT_CONFIG, name: 'My "Special" NFT' }
        const code = generateNFTCollectionCode(config)
        expect(code).toContain('My \\"Special\\" NFT')
    })

    it("escapes newlines in description", () => {
        const config = { ...DEFAULT_CONFIG, description: "Line1\nLine2" }
        const code = generateNFTCollectionCode(config)
        expect(code).toContain("Line1\\nLine2")
    })
})

// ── 3. Security Patterns ─────────────────────────────────────

describe("nftTemplate security — access control", () => {
    it("Mint restricts to admin when publicMint=false", () => {
        const config = { ...DEFAULT_CONFIG, publicMint: false }
        const code = generateNFTCollectionCode(config)
        const mintBody = getFuncBody(code, "Mint", "Burn")
        expect(mintBody).toContain('!PublicMint && string(caller) != AdminAddress')
        expect(mintBody).toContain('panic("only admin can mint")')
    })

    it("Burn restricts to owner or admin", () => {
        const burnBody = getFuncBody(getCode(), "Burn", "RoyaltyInfo")
        expect(burnBody).toContain("caller != owner && string(caller) != AdminAddress")
        expect(burnBody).toContain('panic("only owner or admin can burn")')
    })

    it("TransferFrom checks owner == from", () => {
        const body = getFuncBody(getCode(), "TransferFrom", "Approve")
        expect(body).toContain("owner != from")
        expect(body).toContain('panic("transfer from incorrect owner")')
    })

    it("TransferFrom rejects self-transfers", () => {
        const body = getFuncBody(getCode(), "TransferFrom", "Approve")
        expect(body).toContain("from == to")
        expect(body).toContain('panic("cannot transfer to self")')
    })

    it("TransferFrom checks caller is approved or owner", () => {
        const body = getFuncBody(getCode(), "TransferFrom", "Approve")
        expect(body).toContain("isApprovedOrOwner(caller, tokenId)")
    })

    it("Approve rejects approval to current owner", () => {
        const body = getFuncBody(getCode(), "Approve", "SetApprovalForAll")
        expect(body).toContain('panic("approval to current owner")')
    })

    it("Approve checks caller is owner or operator-approved", () => {
        const body = getFuncBody(getCode(), "Approve", "SetApprovalForAll")
        expect(body).toContain("caller != owner && !IsApprovedForAll(owner, caller)")
    })
})

describe("nftTemplate security — supply & pricing", () => {
    it("Mint respects maxSupply limit when > 0", () => {
        const mintBody = getFuncBody(getCode(), "Mint", "Burn")
        expect(mintBody).toContain("MaxSupply > 0 && mintCount >= int64(MaxSupply)")
    })

    it("Mint checks payment when MintPrice > 0", () => {
        const mintBody = getFuncBody(getCode(), "Mint", "Burn")
        expect(mintBody).toContain("MintPrice > 0")
        expect(mintBody).toContain("banker.OriginSend()")
        expect(mintBody).toContain('insufficient payment')
    })

    it("Mint rejects duplicate tokenIds", () => {
        const mintBody = getFuncBody(getCode(), "Mint", "Burn")
        expect(mintBody).toContain("owners.Get(tokenId)")
        expect(mintBody).toContain('panic("token already exists:')
    })

    it("generates valid code for unlimited supply (maxSupply=0)", () => {
        const config = { ...DEFAULT_CONFIG, maxSupply: 0 }
        const code = generateNFTCollectionCode(config)
        expect(code).toContain("MaxSupply        = 0")
    })

    it("generates valid code for free mint (mintPrice=0)", () => {
        const config = { ...DEFAULT_CONFIG, mintPrice: 0 }
        const code = generateNFTCollectionCode(config)
        expect(code).toContain("MintPrice        = int64(0)")
    })
})

// ── 4. GRC721 Core ───────────────────────────────────────────

describe("GRC721 core functions", () => {
    it("has BalanceOf with address parameter", () => {
        expect(getCode()).toContain("func BalanceOf(owner address) int64")
    })

    it("has OwnerOf returning address", () => {
        expect(getCode()).toContain("func OwnerOf(tokenId string) address")
    })

    it("has TokenURI query", () => {
        expect(getCode()).toContain("func TokenURI(tokenId string) string")
    })

    it("has TotalSupply counter", () => {
        expect(getCode()).toContain("func TotalSupply() int64")
    })

    it("has Name and Symbol accessors", () => {
        const code = getCode()
        expect(code).toContain("func Name() string")
        expect(code).toContain("func Symbol() string")
    })

    it("TransferFrom clears approval after transfer", () => {
        const body = getFuncBody(getCode(), "TransferFrom", "Approve")
        expect(body).toContain("approvals.Remove(tokenId)")
    })

    it("TransferFrom updates owner mapping", () => {
        const body = getFuncBody(getCode(), "TransferFrom", "Approve")
        expect(body).toContain("owners.Set(tokenId, to)")
    })

    it("TransferFrom updates balances", () => {
        const body = getFuncBody(getCode(), "TransferFrom", "Approve")
        expect(body).toContain("decBalance(from)")
        expect(body).toContain("incBalance(to)")
    })

    it("SetApprovalForAll uses composite key", () => {
        const body = getFuncBody(getCode(), "SetApprovalForAll", "GetApproved")
        expect(body).toContain('string(caller) + ":" + string(operator)')
    })

    it("Mint stores owner, URI, name, and updates balance", () => {
        const body = getFuncBody(getCode(), "Mint", "Burn")
        expect(body).toContain("owners.Set(tokenId, to)")
        expect(body).toContain("tokenURIs.Set(tokenId, uri)")
        expect(body).toContain("tokenNames.Set(tokenId, name)")
        expect(body).toContain("incBalance(to)")
    })

    it("Burn removes from all trees", () => {
        const body = getFuncBody(getCode(), "Burn", "RoyaltyInfo")
        expect(body).toContain("owners.Remove(tokenId)")
        expect(body).toContain("approvals.Remove(tokenId)")
        expect(body).toContain("tokenURIs.Remove(tokenId)")
        expect(body).toContain("tokenNames.Remove(tokenId)")
        expect(body).toContain("decBalance(owner)")
    })
})

// ── 5. Royalty (ERC2981) ─────────────────────────────────────

describe("RoyaltyInfo ERC2981", () => {
    it("returns tuple (address, int64)", () => {
        expect(getCode()).toContain("func RoyaltyInfo(tokenId string, salePrice int64) (address, int64)")
    })

    it("returns empty address and zero when RoyaltyPercent=0", () => {
        const config = { ...DEFAULT_CONFIG, royaltyPercent: 0 }
        const code = generateNFTCollectionCode(config)
        const body = getFuncBody(code, "RoyaltyInfo", "Render")
        expect(body).toContain('return "", 0')
    })

    it("calculates royalty as (salePrice * RoyaltyPercent) / 100", () => {
        const body = getFuncBody(getCode(), "RoyaltyInfo", "Render")
        expect(body).toContain("(salePrice * int64(RoyaltyPercent)) / 100")
    })

    it("returns admin address as royalty recipient", () => {
        const body = getFuncBody(getCode(), "RoyaltyInfo", "Render")
        expect(body).toContain("address(AdminAddress), royalty")
    })
})

// ── 6. Render Helpers ────────────────────────────────────────

describe("Render function", () => {
    it("dispatches on path prefix", () => {
        const code = getCode()
        expect(code).toContain('strings.HasPrefix(path, "token/")')
    })

    it("home page includes collection name and description", () => {
        const body = getFuncBody(getCode(), "renderHome", "renderToken")
        expect(body).toContain("CollectionName")
        expect(body).toContain("CollectionDesc")
    })

    it("home page shows symbol and supply info", () => {
        const body = getFuncBody(getCode(), "renderHome", "renderToken")
        expect(body).toContain("CollectionSymbol")
        expect(body).toContain("mintCount")
    })

    it("token page returns 404 for non-existent token", () => {
        const body = getFuncBody(getCode(), "renderToken", "isApprovedOrOwner")
        expect(body).toContain("Token not found")
    })

    it("token page shows owner and URI", () => {
        const body = getFuncBody(getCode(), "renderToken", "isApprovedOrOwner")
        expect(body).toContain("Owner")
        expect(body).toContain("Token URI")
    })

    it("truncAddr truncates addresses longer than 13 chars", () => {
        const code = getCode()
        expect(code).toContain("func truncAddr(addr address) string")
        expect(code).toContain("len(s) > 13")
        expect(code).toContain('s[:10] + "..."')
    })

    it("unknown paths return 404", () => {
        const code = getCode()
        const renderBody = getFuncBody(code, "Render(path string)", "renderHome")
        expect(renderBody).toContain("404")
    })
})

// ── 7. MsgCall Builders ──────────────────────────────────────

describe("buildDeployNFTCollectionMsg", () => {
    const caller = "g1testcaller"
    const realmPath = "gno.land/r/org/my_nft"

    it("returns /vm.m_addpkg type", () => {
        const msg = buildDeployNFTCollectionMsg(caller, realmPath, "code")
        expect(msg.type).toBe("/vm.m_addpkg")
    })

    it("sets creator to callerAddress", () => {
        const msg = buildDeployNFTCollectionMsg(caller, realmPath, "code")
        expect(msg.value.creator).toBe(caller)
    })

    it("extracts package name from realm path", () => {
        const msg = buildDeployNFTCollectionMsg(caller, realmPath, "code")
        expect(msg.value.package.name).toBe("my_nft")
    })

    it("sets package path to realmPath", () => {
        const msg = buildDeployNFTCollectionMsg(caller, realmPath, "code")
        expect(msg.value.package.path).toBe(realmPath)
    })

    it("creates single .gno file with code", () => {
        const code = getCode()
        const msg = buildDeployNFTCollectionMsg(caller, realmPath, code)
        expect(msg.value.package.files).toHaveLength(1)
        expect(msg.value.package.files[0].name).toBe("my_nft.gno")
        expect(msg.value.package.files[0].body).toBe(code)
    })

    it("deposit is empty string", () => {
        const msg = buildDeployNFTCollectionMsg(caller, realmPath, "code")
        expect(msg.value.deposit).toBe("")
    })

    it("defaults package name to nft_collection for bare path", () => {
        const msg = buildDeployNFTCollectionMsg(caller, "", "code")
        expect(msg.value.package.name).toBe("nft_collection")
    })
})
