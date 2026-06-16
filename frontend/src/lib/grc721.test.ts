/**
 * grc721.test.ts — unit tests for GRC721 helpers.
 *
 * Covers:
 *  1. Existing MsgCall builders (broadcast-type regression)
 *  2. New collectionID-aware read helpers (parser/query shape assertions)
 *  3. parseCollectionRenderV2 — parses the live memba_nft_v2 Render("genesis") format
 *  4. parseTokenRender — parses Render("genesis/<tid>")
 *  5. isApprovedForAll result parsing
 */

import { describe, it, expect, vi } from "vitest"
import {
    buildMintMsg,
    buildTransferMsg,
    buildApproveMsg,
    buildBurnMsg,
    buildListForSaleMsg,
    buildBuyMsg,
    parseCollectionRenderV2,
    parseTokenRender,
    parseOwnerOfResult,
    parseTokenURIResult,
    parseIsApprovedForAllResult,
    type NFTCollectionV2,
    type NFTTokenInfo,
} from "./grc721"
import { toAdenaMessages } from "./grc20"

// ── Sample on-chain Render output ────────────────────────────

/** Matches `Render("genesis")` from gno.land/r/samcrew/memba_nft_v2 */
const GENESIS_COLLECTION_RENDER = `# Memba Genesis

Symbol: MGEN
Supply: 3
Royalty BPS: 500
Royalty Recipient: g1multisig0000000000000000000000000
`

/** Matches `Render("genesis/1")` */
const TOKEN_1_RENDER = `# Token 1

Owner: g1multisig0000000000000000000000000
URI: ipfs://bafybeigenesistoken1metadata
`

/** Token with no URI (edge case) */
const TOKEN_NO_URI_RENDER = `# Token 2

Owner: g1buyer0000000000000000000000000000
`

/** qeval result format for OwnerOf */
const QEVAL_OWNER_RESULT = `("g1multisig0000000000000000000000000" string)`

/** qeval result format for TokenURI */
const QEVAL_URI_RESULT = `("ipfs://bafybeigenesistoken1metadata" string)`

/** qeval result format for IsApprovedForAll = true */
const QEVAL_APPROVED_TRUE = `(true bool)`

/** qeval result format for IsApprovedForAll = false */
const QEVAL_APPROVED_FALSE = `(false bool)`

// ── parseCollectionRenderV2 ──────────────────────────────────

describe("parseCollectionRenderV2", () => {
    it("parses name from h1 heading", () => {
        const info = parseCollectionRenderV2(GENESIS_COLLECTION_RENDER, "gno.land/r/samcrew/memba_nft_v2", "genesis")
        expect(info.name).toBe("Memba Genesis")
    })

    it("parses symbol", () => {
        const info = parseCollectionRenderV2(GENESIS_COLLECTION_RENDER, "gno.land/r/samcrew/memba_nft_v2", "genesis")
        expect(info.symbol).toBe("MGEN")
    })

    it("parses supply as number", () => {
        const info = parseCollectionRenderV2(GENESIS_COLLECTION_RENDER, "gno.land/r/samcrew/memba_nft_v2", "genesis")
        expect(info.totalSupply).toBe(3)
    })

    it("parses royaltyBPS", () => {
        const info = parseCollectionRenderV2(GENESIS_COLLECTION_RENDER, "gno.land/r/samcrew/memba_nft_v2", "genesis")
        expect(info.royaltyBPS).toBe(500)
    })

    it("parses royalty recipient address", () => {
        const info = parseCollectionRenderV2(GENESIS_COLLECTION_RENDER, "gno.land/r/samcrew/memba_nft_v2", "genesis")
        expect(info.royaltyRecipient).toBe("g1multisig0000000000000000000000000")
    })

    it("stores collectionPath and collectionID", () => {
        const info = parseCollectionRenderV2(GENESIS_COLLECTION_RENDER, "gno.land/r/samcrew/memba_nft_v2", "genesis")
        expect(info.collectionPath).toBe("gno.land/r/samcrew/memba_nft_v2")
        expect(info.collectionID).toBe("genesis")
    })

    it("returns 0 royaltyBPS when not present", () => {
        const info = parseCollectionRenderV2("# Test\nSymbol: TST\nSupply: 1\n", "gno.land/r/test/nft", "test")
        expect(info.royaltyBPS).toBe(0)
        expect(info.royaltyRecipient).toBe("")
    })

    it("uses realm last segment as fallback name", () => {
        const info = parseCollectionRenderV2("no heading\n", "gno.land/r/test/my_collection", "col1")
        expect(info.name).toBe("my_collection")
    })

    it("handles bold markdown symbol line", () => {
        const render = "# Test\n**Symbol:** TBOL\nSupply: 2\n"
        const info = parseCollectionRenderV2(render, "gno.land/r/test/nft", "test")
        expect(info.symbol).toBe("TBOL")
    })

    it("handles bold markdown supply line", () => {
        const render = "# Test\nSymbol: T\n**Supply:** 5\n"
        const info = parseCollectionRenderV2(render, "gno.land/r/test/nft", "test")
        expect(info.totalSupply).toBe(5)
    })
})

// ── parseTokenRender ─────────────────────────────────────────

describe("parseTokenRender", () => {
    it("parses owner address", () => {
        const token = parseTokenRender(TOKEN_1_RENDER, "1")
        expect(token.owner).toBe("g1multisig0000000000000000000000000")
    })

    it("parses URI", () => {
        const token = parseTokenRender(TOKEN_1_RENDER, "1")
        expect(token.tokenURI).toBe("ipfs://bafybeigenesistoken1metadata")
    })

    it("sets tokenId", () => {
        const token = parseTokenRender(TOKEN_1_RENDER, "1")
        expect(token.tokenId).toBe("1")
    })

    it("returns empty URI when not present", () => {
        const token = parseTokenRender(TOKEN_NO_URI_RENDER, "2")
        expect(token.tokenURI).toBe("")
        expect(token.owner).toBe("g1buyer0000000000000000000000000000")
    })
})

// ── qeval result parsers ─────────────────────────────────────

describe("parseOwnerOfResult", () => {
    it("extracts g1 address from qeval OwnerOf result", () => {
        const owner = parseOwnerOfResult(QEVAL_OWNER_RESULT)
        expect(owner).toBe("g1multisig0000000000000000000000000")
    })

    it("returns null for empty string", () => {
        expect(parseOwnerOfResult("")).toBeNull()
    })

    it("returns null for non-address result", () => {
        expect(parseOwnerOfResult("(nil address)")).toBeNull()
    })
})

describe("parseTokenURIResult", () => {
    it("extracts URI string from qeval TokenURI result", () => {
        const uri = parseTokenURIResult(QEVAL_URI_RESULT)
        expect(uri).toBe("ipfs://bafybeigenesistoken1metadata")
    })

    it("returns null for empty string", () => {
        expect(parseTokenURIResult("")).toBeNull()
    })
})

describe("parseIsApprovedForAllResult", () => {
    it("returns true when approved", () => {
        expect(parseIsApprovedForAllResult(QEVAL_APPROVED_TRUE)).toBe(true)
    })

    it("returns false when not approved", () => {
        expect(parseIsApprovedForAllResult(QEVAL_APPROVED_FALSE)).toBe(false)
    })

    it("returns false for empty string", () => {
        expect(parseIsApprovedForAllResult("")).toBe(false)
    })
})

// ── Existing builder regression ───────────────────────────────

describe("grc721 builders — broadcast path", () => {
    const caller = "g1testcaller"
    const realm = "gno.land/r/test/nft"

    it("every GRC721 builder survives toAdenaMessages", () => {
        const market = "gno.land/r/test/nft_market"
        const msgs = [
            buildMintMsg(caller, realm, caller, "tok-1", "ipfs://uri"),
            buildTransferMsg(caller, realm, caller, "g1to", "tok-1"),
            buildApproveMsg(caller, realm, "g1op", "tok-1"),
            buildBurnMsg(caller, realm, "tok-1"),
            buildListForSaleMsg(caller, market, realm, "tok-1", 1000000),
            buildBuyMsg(caller, market, realm, "tok-1", 1000000),
        ]
        expect(() => toAdenaMessages(msgs)).not.toThrow()
        expect(toAdenaMessages(msgs).every((m) => m.type === "/vm.m_call")).toBe(true)
    })

    it("buildMintMsg emits vm/MsgCall with Mint func", () => {
        const msg = buildMintMsg(caller, realm, caller, "tok-1", "ipfs://uri")
        expect(msg.type).toBe("vm/MsgCall")
        expect(msg.value.func).toBe("Mint")
    })
})
