/**
 * launchpad.test.ts — Unit tests for memba_collections launchpad builders + parsers.
 *
 * Phase 2 (Model A): creators register collections INTO the shared
 * memba_collections registry. Every builder produces an Amino vm/MsgCall whose
 * args/send EXACTLY match the on-chain ABI (arg order is load-bearing). The
 * allowlist proof crosses the ABI as a comma-joined hex string (vm/MsgCall
 * cannot encode a []string).
 */

import { describe, it, expect } from "vitest"
import {
    buildCreateCollectionMsg,
    buildSetMintPhaseMsg,
    buildSetMintConfigMsg,
    buildAdminMintMsg,
    buildMintPublicMsg,
    buildMintAllowlistMsg,
    buildSetRoyaltyMsg,
    buildSetCollectionAdminMsg,
    buildAcceptCollectionAdminMsg,
    buildWithdrawProceedsMsg,
    parseCollectionList,
    parseCollectionDetail,
    joinProof,
    Phase,
    CREATE_FEE_UGNOT,
    ROYALTY_SENTINEL,
} from "./launchpad"

const PATH = "gno.land/r/samcrew/memba_collections"
const CALLER = "g1caller000000000000000000000000000000"
const RECIP = "g1recip0000000000000000000000000000000"
const CUSTODY = "g1custody00000000000000000000000000000"

describe("launchpad builders — CreateCollection", () => {
    it("orders args slug,name,symbol,royaltyBPS,recip,custody,maxSupply,maxPerWallet and attaches the create fee", () => {
        const msg = buildCreateCollectionMsg(CALLER, PATH, {
            slug: "genesis",
            name: "Memba Genesis",
            symbol: "MGEN",
            royaltyBPS: 500,
            royaltyRecip: RECIP,
            mintCustody: CUSTODY,
            maxSupply: 100,
            maxPerWallet: 5,
        })
        expect(msg.type).toBe("vm/MsgCall")
        expect(msg.value).toMatchObject({
            caller: CALLER,
            pkg_path: PATH,
            func: "CreateCollection",
            send: `${CREATE_FEE_UGNOT}ugnot`,
            args: ["genesis", "Memba Genesis", "MGEN", "500", RECIP, CUSTODY, "100", "5"],
        })
    })

    it("supports the royalty sentinel (-1 → realm default) and a custom create fee", () => {
        const msg = buildCreateCollectionMsg(
            CALLER,
            PATH,
            {
                slug: "s",
                name: "n",
                symbol: "N",
                royaltyBPS: ROYALTY_SENTINEL,
                royaltyRecip: "",
                mintCustody: "",
                maxSupply: 0,
                maxPerWallet: 0,
            },
            2_000_000,
        )
        expect(msg.value.send).toBe("2000000ugnot")
        expect((msg.value.args as string[])[3]).toBe("-1")
        // empty recip/custody pass through as "" (realm defaults them to creator)
        expect((msg.value.args as string[])[4]).toBe("")
        expect((msg.value.args as string[])[5]).toBe("")
    })
})

describe("launchpad builders — mint config", () => {
    it("SetMintPhase args = id,phase,allowlistRoot", () => {
        const msg = buildSetMintPhaseMsg(CALLER, PATH, "g1/c", Phase.Allowlist, "abc123")
        expect(msg.value.func).toBe("SetMintPhase")
        expect(msg.value.args).toEqual(["g1/c", "1", "abc123"])
        expect(msg.value.send).toBe("")
    })

    it("SetMintConfig args = id,price,denom,maxSupply,maxPerWallet,startBlock,cooldown", () => {
        const msg = buildSetMintConfigMsg(CALLER, PATH, "g1/c", {
            mintPrice: 1_000_000,
            payDenom: "",
            maxSupply: 100,
            maxPerWallet: 5,
            mintStartBlock: 0,
            mintCooldownBlocks: 0,
        })
        expect(msg.value.func).toBe("SetMintConfig")
        expect(msg.value.args).toEqual(["g1/c", "1000000", "", "100", "5", "0", "0"])
    })
})

describe("launchpad builders — mints", () => {
    it("AdminMint args = id,to,tokenURI, no send", () => {
        const msg = buildAdminMintMsg(CALLER, PATH, "g1/c", RECIP, "ipfs://x/1")
        expect(msg.value.func).toBe("Mint")
        expect(msg.value.args).toEqual(["g1/c", RECIP, "ipfs://x/1"])
        expect(msg.value.send).toBe("")
    })

    it("MintPublic attaches native price as ugnot send", () => {
        const msg = buildMintPublicMsg(CALLER, PATH, "g1/c", "ipfs://x", 1_000_000)
        expect(msg.value.func).toBe("MintPublic")
        expect(msg.value.args).toEqual(["g1/c", "ipfs://x"])
        expect(msg.value.send).toBe("1000000ugnot")
    })

    it("MintPublic sends nothing for a GRC20-priced mint (nativePrice 0)", () => {
        const msg = buildMintPublicMsg(CALLER, PATH, "g1/c", "ipfs://x", 0)
        expect(msg.value.send).toBe("")
    })

    it("MintAllowlist joins the proof array into a comma-separated string", () => {
        const msg = buildMintAllowlistMsg(CALLER, PATH, "g1/c", ["aa", "bb", "cc"], 2, "ipfs://x", 1_000_000)
        expect(msg.value.func).toBe("MintAllowlist")
        expect(msg.value.args).toEqual(["g1/c", "aa,bb,cc", "2", "ipfs://x"])
        expect(msg.value.send).toBe("1000000ugnot")
    })

    it("MintAllowlist with an empty proof (single-leaf tree) passes an empty string", () => {
        const msg = buildMintAllowlistMsg(CALLER, PATH, "g1/c", [], 1, "u", 0)
        expect((msg.value.args as string[])[1]).toBe("")
        expect(msg.value.send).toBe("")
    })

    it("joinProof is the canonical comma encoder", () => {
        expect(joinProof([])).toBe("")
        expect(joinProof(["aa"])).toBe("aa")
        expect(joinProof(["aa", "bb"])).toBe("aa,bb")
    })
})

describe("launchpad builders — admin / royalty / proceeds", () => {
    it("SetRoyalty args = id,recip,bps", () => {
        const msg = buildSetRoyaltyMsg(CALLER, PATH, "g1/c", RECIP, 250)
        expect(msg.value.func).toBe("SetRoyalty")
        expect(msg.value.args).toEqual(["g1/c", RECIP, "250"])
    })

    it("SetCollectionAdmin + AcceptCollectionAdmin (2-step)", () => {
        expect(buildSetCollectionAdminMsg(CALLER, PATH, "g1/c", RECIP).value.args).toEqual(["g1/c", RECIP])
        expect(buildAcceptCollectionAdminMsg(CALLER, PATH, "g1/c").value.args).toEqual(["g1/c"])
    })

    it("WithdrawProceeds args = id,denom", () => {
        const msg = buildWithdrawProceedsMsg(CALLER, PATH, "g1/c", "ugnot")
        expect(msg.value.func).toBe("WithdrawProceeds")
        expect(msg.value.args).toEqual(["g1/c", "ugnot"])
    })
})

describe("launchpad parsers", () => {
    const LIST = `# Memba Collections

- **Memba Genesis** (g1abc/genesis) — phase 2, minted 3
- **Cool Art** (g1def/art) — phase 0, minted 0

_Page 1 — 2 of 2 collections._
`
    it("parseCollectionList extracts name, id, creator, slug, phase, minted", () => {
        const rows = parseCollectionList(LIST)
        expect(rows).toHaveLength(2)
        expect(rows[0]).toEqual({
            name: "Memba Genesis",
            id: "g1abc/genesis",
            creator: "g1abc",
            slug: "genesis",
            phase: 2,
            minted: 3,
        })
        expect(rows[1].slug).toBe("art")
        expect(rows[1].minted).toBe(0)
    })

    it("parseCollectionList returns [] for the empty registry", () => {
        expect(parseCollectionList("# Memba Collections\n\n_No collections yet._\n")).toEqual([])
    })

    const DETAIL = `# Memba Genesis (MGEN)

- ID: \`g1abc/genesis\`
- Creator: g1abc
- Admin: g1admin
- Royalty: 500 bps → g1recip
- Phase: 2
- Mint price: 1000000 ugnot
- Supply: 3 / 100
- ⚠️ Paused
`
    it("parseCollectionDetail extracts the full structured view", () => {
        const d = parseCollectionDetail(DETAIL)
        expect(d).toMatchObject({
            name: "Memba Genesis",
            symbol: "MGEN",
            id: "g1abc/genesis",
            creator: "g1abc",
            admin: "g1admin",
            royaltyBps: 500,
            royaltyRecip: "g1recip",
            phase: 2,
            mintPrice: 1000000,
            payDenom: "ugnot",
            minted: 3,
            maxSupply: 100,
            paused: true,
        })
    })

    it("parseCollectionDetail handles unlimited supply + not-paused", () => {
        const d = parseCollectionDetail(`# X (X)

- ID: \`g1/x\`
- Creator: g1
- Admin: g1
- Royalty: 0 bps → g1
- Phase: 0
- Mint price: 0 ugnot
- Supply: 5
`)
        expect(d?.maxSupply).toBe(0) // 0 = unlimited
        expect(d?.paused).toBe(false)
        expect(d?.minted).toBe(5)
    })

    it("parseCollectionDetail returns null for a not-found page", () => {
        expect(parseCollectionDetail("# Not found\n\nNo collection: g1/nope")).toBeNull()
    })
})
