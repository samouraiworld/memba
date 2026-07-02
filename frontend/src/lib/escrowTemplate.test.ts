/**
 * escrowTemplate.test.ts — Comprehensive tests for the escrow template.
 *
 * Covers:
 * 1. Chain API compliance (no deprecated std.* usage)
 * 2. Security patterns (state-before-send, bounds checks, access control)
 * 3. Query helpers (listings, search, categories)
 * 4. MsgCall builders (message structure validation)
 */

import { describe, it, expect } from "vitest"
import {
    generateEscrowCode,
    getListings,
    searchListings,
    getListing,
    SEED_LISTINGS,
    SERVICE_CATEGORIES,
    buildCreateContractMsg,
    buildFundMilestoneMsg,
    buildCompleteMilestoneMsg,
    buildReleaseFundsMsg,
    buildRaiseDisputeMsg,
    buildDeployEscrowMsg,
    type EscrowConfig,
} from "./escrowTemplate"
import { toAdenaMessages } from "./grc20"

// ── Fixtures ──────────────────────────────────────────────────

const DEFAULT_CONFIG: EscrowConfig = {
    realmPath: "gno.land/r/test/escrow",
    adminAddress: "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5",
    platformFeePercent: 2,
    cancellationFeePercent: 5,
    autoRefundBlocks: 864000,
    feeRecipient: "g1u7y667z64x2h7vc6fmpcprgey4ck233jaww9zq",
}

function getCode(): string {
    return generateEscrowCode(DEFAULT_CONFIG)
}

function getImportBlock(code: string): string {
    return code.match(/import \([\s\S]*?\)/)?.[0] || ""
}

// ── 1. Chain API Compliance ───────────────────────────────────

describe("generateEscrowCode — chain API compliance", () => {
    it("generates valid package declaration", () => {
        const code = getCode()
        expect(code).toContain("package escrow")
    })

    it("imports chain, chain/banker, and chain/runtime, NOT std", () => {
        const importBlock = getImportBlock(getCode())
        expect(importBlock).toContain('"chain"')
        expect(importBlock).toContain('"chain/banker"')
        expect(importBlock).toContain('"chain/runtime"')
        expect(importBlock).not.toContain('"std"')
    })

    it("uses unsafe.PreviousRealm().Address() for caller identity", () => {
        const code = getCode()
        expect(code).toContain("unsafe.PreviousRealm().Address()")
        expect(code).not.toContain("std.PreviousRealm()")
        expect(code).not.toContain("chain.PreviousRealm()")
    })

    it("uses banker.NewBanker(banker.BankerTypeRealmSend, cur)", () => {
        const code = getCode()
        expect(code).toContain("banker.NewBanker(banker.BankerTypeRealmSend, cur)")
        expect(code).not.toContain("std.GetBanker")
        expect(code).not.toContain("chain.GetBanker")
    })

    it("uses chain.Coins{chain.NewCoin(...)}", () => {
        const code = getCode()
        expect(code).toContain("chain.Coins{chain.NewCoin(")
        expect(code).not.toContain("std.Coins")
        expect(code).not.toContain("std.NewCoin")
    })

    it("uses unsafe.OriginSend() (not std.GetOrigSend)", () => {
        const code = getCode()
        expect(code).toContain("unsafe.OriginSend()")
        expect(code).not.toContain("std.GetOrigSend")
        expect(code).not.toContain("chain.OrigSend")
    })

    it("uses runtime.ChainHeight() (not std.GetHeight)", () => {
        const code = getCode()
        expect(code).toContain("runtime.ChainHeight()")
        expect(code).not.toContain("std.GetHeight")
        expect(code).not.toContain("chain.GetHeight")
    })

    it("uses unsafe.CurrentRealm().Address()", () => {
        const code = getCode()
        expect(code).toContain("unsafe.CurrentRealm().Address()")
        expect(code).not.toContain("std.CurrentRealm")
        expect(code).not.toContain("chain.CurrentRealm")
    })

    it("uses address type (not std.Address)", () => {
        const code = getCode()
        // Struct fields use bare 'address' type
        expect(code).toContain("Client      address")
        expect(code).toContain("Freelancer  address")
        // Function params use bare 'address'
        expect(code).toContain("freelancer address")
        // No std.Address anywhere
        expect(code).not.toContain("std.Address")
    })

    it("does NOT contain any deprecated std. API anywhere", () => {
        const code = getCode()
        // No std.XYZ patterns at all (except inside string literals like StatusActive)
        expect(code).not.toMatch(/\bstd\.\w/)
    })

    it("embeds correct admin address from config", () => {
        const code = getCode()
        expect(code).toContain(`AdminAddress       = "${DEFAULT_CONFIG.adminAddress}"`)
    })

    it("embeds correct platform fee from config", () => {
        const code = getCode()
        expect(code).toContain(`PlatformFee        = ${DEFAULT_CONFIG.platformFeePercent}`)
    })

    it("embeds correct cancellation fee from config", () => {
        const code = getCode()
        expect(code).toContain(`CancellationFee    = ${DEFAULT_CONFIG.cancellationFeePercent}`)
    })

    it("embeds correct auto-refund blocks from config", () => {
        const code = getCode()
        expect(code).toContain(`AutoRefundBlocks   = int64(${DEFAULT_CONFIG.autoRefundBlocks})`)
    })

    it("uses custom package name from realm path", () => {
        const config = { ...DEFAULT_CONFIG, realmPath: "gno.land/r/myorg/my_escrow_v2" }
        const code = generateEscrowCode(config)
        expect(code).toContain("package my_escrow_v2")
    })
})

// ── 2. Security Patterns ──────────────────────────────────────

describe("escrowTemplate security", () => {
    it("has bounds check in FundMilestone", () => {
        const code = getCode()
        // FundMilestone already had bounds check in original
        const funIdx = code.indexOf("func FundMilestone")
        const nextFunc = code.indexOf("func CompleteMilestone")
        const fundBody = code.slice(funIdx, nextFunc)
        expect(fundBody).toContain("milestoneIdx < 0 || milestoneIdx >= len(c.Milestones)")
    })

    it("has bounds check in CompleteMilestone", () => {
        const code = getCode()
        const funIdx = code.indexOf("func CompleteMilestone")
        const nextFunc = code.indexOf("func ReleaseFunds")
        const body = code.slice(funIdx, nextFunc)
        expect(body).toContain("milestoneIdx < 0 || milestoneIdx >= len(c.Milestones)")
    })

    it("has bounds check in ReleaseFunds", () => {
        const code = getCode()
        const funIdx = code.indexOf("func ReleaseFunds")
        const nextFunc = code.indexOf("func RaiseDispute")
        const body = code.slice(funIdx, nextFunc)
        expect(body).toContain("milestoneIdx < 0 || milestoneIdx >= len(c.Milestones)")
    })

    it("has bounds check in RaiseDispute", () => {
        const code = getCode()
        const funIdx = code.indexOf("func RaiseDispute")
        const nextFunc = code.indexOf("func ResolveDispute")
        const body = code.slice(funIdx, nextFunc)
        expect(body).toContain("milestoneIdx < 0 || milestoneIdx >= len(c.Milestones)")
    })

    it("has bounds check in ResolveDispute", () => {
        const code = getCode()
        const funIdx = code.indexOf("func ResolveDispute")
        const nextFunc = code.indexOf("func CancelContract")
        const body = code.slice(funIdx, nextFunc)
        expect(body).toContain("milestoneIdx < 0 || milestoneIdx >= len(c.Milestones)")
    })

    it("updates state before SendCoins in ReleaseFunds (state-before-send)", () => {
        const code = getCode()
        const funIdx = code.indexOf("func ReleaseFunds")
        const nextFunc = code.indexOf("func RaiseDispute")
        const body = code.slice(funIdx, nextFunc)
        const stateUpdateIdx = body.indexOf("ms.Status = MsReleased")
        const sendIdx = body.indexOf("bnk.SendCoins")
        expect(stateUpdateIdx).toBeGreaterThan(-1)
        expect(sendIdx).toBeGreaterThan(-1)
        expect(stateUpdateIdx).toBeLessThan(sendIdx)
    })

    it("updates state before SendCoins in ResolveDispute (state-before-send)", () => {
        const code = getCode()
        const funIdx = code.indexOf("func ResolveDispute")
        const nextFunc = code.indexOf("func CancelContract")
        const body = code.slice(funIdx, nextFunc)
        const stateUpdateIdx = body.indexOf("contracts.Set(contractId, c)")
        const sendIdx = body.indexOf("bnk.SendCoins")
        expect(stateUpdateIdx).toBeGreaterThan(-1)
        expect(sendIdx).toBeGreaterThan(-1)
        expect(stateUpdateIdx).toBeLessThan(sendIdx)
    })

    it("updates state before SendCoins in CancelContract (state-before-send)", () => {
        const code = getCode()
        const funIdx = code.indexOf("func CancelContract")
        const nextFunc = code.indexOf("func Render")
        const body = code.slice(funIdx, nextFunc)
        const stateUpdateIdx = body.indexOf("contracts.Set(contractId, c)")
        const sendIdx = body.indexOf("bnk.SendCoins")
        expect(stateUpdateIdx).toBeGreaterThan(-1)
        expect(sendIdx).toBeGreaterThan(-1)
        expect(stateUpdateIdx).toBeLessThan(sendIdx)
    })

    it("only client can fund milestones", () => {
        const code = getCode()
        const body = code.slice(code.indexOf("func FundMilestone"), code.indexOf("func CompleteMilestone"))
        expect(body).toContain('panic("only client can fund")')
    })

    it("only freelancer can mark complete", () => {
        const code = getCode()
        const body = code.slice(code.indexOf("func CompleteMilestone"), code.indexOf("func ReleaseFunds"))
        expect(body).toContain('panic("only freelancer can mark complete")')
    })

    it("only client or admin can release funds", () => {
        const code = getCode()
        const body = code.slice(code.indexOf("func ReleaseFunds"), code.indexOf("func RaiseDispute"))
        expect(body).toContain('panic("only client or admin can release")')
    })

    it("only admin can resolve disputes", () => {
        const code = getCode()
        const body = code.slice(code.indexOf("func ResolveDispute"), code.indexOf("func CancelContract"))
        expect(body).toContain('panic("only admin can resolve disputes")')
    })
})

// ── 3. Query Helpers (Listings) ───────────────────────────────

describe("getListings / searchListings / getListing", () => {
    it("returns all seed listings with no filter", () => {
        const all = getListings()
        expect(all.length).toBeGreaterThanOrEqual(3)
    })

    it("filters by category", () => {
        const devListings = getListings("development")
        for (const l of devListings) {
            expect(l.category).toBe("development")
        }
    })

    it("searches by title substring (case-insensitive)", () => {
        const results = searchListings("gno")
        expect(results.length).toBeGreaterThan(0)
        for (const r of results) {
            const matchesTitle = r.title.toLowerCase().includes("gno")
            const matchesDesc = r.description.toLowerCase().includes("gno")
            const matchesTags = r.tags.some(t => t.toLowerCase().includes("gno"))
            expect(matchesTitle || matchesDesc || matchesTags).toBe(true)
        }
    })

    it("searches by tag", () => {
        const results = searchListings("realm")
        expect(results.length).toBeGreaterThan(0)
    })

    it("returns undefined for unknown listing ID", () => {
        const result = getListing("nonexistent-id-xyz")
        expect(result).toBeUndefined()
    })

    it("returns a listing by known ID", () => {
        const first = SEED_LISTINGS[0]
        const result = getListing(first.id)
        expect(result).toBeDefined()
        expect(result?.id).toBe(first.id)
    })

    it("has valid service categories", () => {
        expect(SERVICE_CATEGORIES.length).toBeGreaterThanOrEqual(5)
        for (const cat of SERVICE_CATEGORIES) {
            expect(cat.key).toBeTruthy()
            expect(cat.label).toBeTruthy()
            expect(cat.icon).toBeTruthy()
        }
    })
})

// ── 4. MsgCall Builders ───────────────────────────────────────

describe("MsgCall builders", () => {
    const caller = "g1testcaller"
    const escrowPath = "gno.land/r/test/escrow"

    it("every escrow MsgCall builder survives toAdenaMessages (broadcast path)", () => {
        const msgs = [
            buildCreateContractMsg(caller, escrowPath, "g1freelancer", "Build app", "Full stack", "Design:1000"),
            buildFundMilestoneMsg(caller, escrowPath, "0", 1, 5000000),
            buildCompleteMilestoneMsg(caller, escrowPath, "0", 0),
            buildReleaseFundsMsg(caller, escrowPath, "0", 2),
            buildRaiseDisputeMsg(caller, escrowPath, "1", 0),
        ]
        expect(() => toAdenaMessages(msgs)).not.toThrow()
        expect(toAdenaMessages(msgs).every((m) => m.type === "/vm.m_call")).toBe(true)
    })

    it("buildCreateContractMsg has correct type and args", () => {
        const msg = buildCreateContractMsg(caller, escrowPath, "g1freelancer", "Build app", "Full stack", "Design:1000,Code:2000")
        expect(msg.type).toBe("vm/MsgCall")
        expect(msg.value.caller).toBe(caller)
        expect(msg.value.pkg_path).toBe(escrowPath)
        expect(msg.value.func).toBe("CreateContract")
        expect(msg.value.args).toEqual(["g1freelancer", "Build app", "Full stack", "Design:1000,Code:2000"])
    })

    it("buildFundMilestoneMsg includes send field", () => {
        const msg = buildFundMilestoneMsg(caller, escrowPath, "0", 1, 5000000)
        expect(msg.type).toBe("vm/MsgCall")
        expect(msg.value.send).toBe("5000000ugnot")
        expect(msg.value.func).toBe("FundMilestone")
        expect(msg.value.args).toEqual(["0", "1"])
    })

    it("buildCompleteMilestoneMsg has no send field", () => {
        const msg = buildCompleteMilestoneMsg(caller, escrowPath, "0", 0)
        expect(msg.type).toBe("vm/MsgCall")
        expect(msg.value.send).toBe("")
        expect(msg.value.func).toBe("CompleteMilestone")
    })

    it("buildReleaseFundsMsg structure is valid", () => {
        const msg = buildReleaseFundsMsg(caller, escrowPath, "0", 2)
        expect(msg.type).toBe("vm/MsgCall")
        expect(msg.value.func).toBe("ReleaseFunds")
        expect(msg.value.args).toEqual(["0", "2"])
    })

    it("buildRaiseDisputeMsg structure is valid", () => {
        const msg = buildRaiseDisputeMsg(caller, escrowPath, "1", 0)
        expect(msg.type).toBe("vm/MsgCall")
        expect(msg.value.func).toBe("RaiseDispute")
    })

    it("buildDeployEscrowMsg uses /vm.m_addpkg type", () => {
        const code = getCode()
        const msg = buildDeployEscrowMsg(caller, escrowPath, code)
        expect(msg.type).toBe("/vm.m_addpkg")
        expect(msg.value.creator).toBe(caller)
        expect(msg.value.package.name).toBe("escrow")
        expect(msg.value.package.path).toBe(escrowPath)
        expect(msg.value.package.files[0].name).toBe("escrow.gno")
        expect(msg.value.package.files[0].body).toBe(code)
    })
})

// ── W1.1: fail-closed codegen — invalid input must THROW, never interpolate ──
describe("generateEscrowCode — fail-closed guards (W1.1)", () => {
    it("throws on platform fee outside the documented 0-5% bound", () => {
        for (const platformFeePercent of [-1, 6, 101, NaN, 2.5]) {
            expect(() => generateEscrowCode({ ...DEFAULT_CONFIG, platformFeePercent })).toThrow(/platformFee/i)
        }
    })
    it("throws on cancellation fee outside the documented 0-10% bound", () => {
        for (const cancellationFeePercent of [-1, 11, NaN]) {
            expect(() => generateEscrowCode({ ...DEFAULT_CONFIG, cancellationFeePercent })).toThrow(/cancellationFee/i)
        }
    })
    it("throws on non-positive / NaN autoRefundBlocks", () => {
        for (const autoRefundBlocks of [0, -1, NaN, 1.5]) {
            expect(() => generateEscrowCode({ ...DEFAULT_CONFIG, autoRefundBlocks })).toThrow(/autoRefundBlocks/i)
        }
    })
    it("throws on invalid admin / feeRecipient addresses (was interpolated raw)", () => {
        expect(() => generateEscrowCode({ ...DEFAULT_CONFIG, adminAddress: 'g1" // inject' })).toThrow(/adminAddress/i)
        expect(() => generateEscrowCode({ ...DEFAULT_CONFIG, feeRecipient: "not-an-address" })).toThrow(/feeRecipient/i)
    })
    it("throws on an invalid realmPath", () => {
        expect(() => generateEscrowCode({ ...DEFAULT_CONFIG, realmPath: "evil" })).toThrow(/realmPath/i)
    })
})

// W1.6 parity invariants (R2-CHN-A): the refund state machine must match the
// DEPLOYED escrow_v2 model. These markers are the Memba-side half of the
// template↔on-chain parity check (the deployer-side check greps the same
// markers in realms/escrow_v2 and in the EMIT_FIXTURES gate_escrow output).
describe("generateEscrowCode — W1.6 refund parity with deployed escrow_v2", () => {
    const code = generateEscrowCode(DEFAULT_CONFIG)

    it("has the terminal MsRefunded status", () => {
        expect(code).toContain('MsRefunded  MilestoneStatus = "refunded"')
    })

    it("ResolveDispute refund branch is TERMINAL (never back to MsPending)", () => {
        const body = code.slice(code.indexOf("func ResolveDispute"), code.indexOf("func allMilestonesReleased"))
        expect(body).toContain("ms.Status = MsRefunded")
        expect(body).not.toContain("ms.Status = MsPending")
    })

    it("CancelContract pays only NEWLY-transitioned milestones (double-refund guard)", () => {
        const body = code.slice(code.indexOf("func CancelContract"), code.indexOf("// ── Render"))
        expect(body).toContain("newlyRefunded")
        expect(body).toContain("newlyReleased")
        // The exact buggy sweep: paying any MsPending milestone that was ever
        // funded re-refunded dispute-refunded milestones.
        expect(body).not.toMatch(/MsPending\s*&&\s*\w+\.FundedAt\s*>\s*0/)
    })

    it("cancel settles completed work to the freelancer (minus platform fee)", () => {
        const body = code.slice(code.indexOf("func CancelContract"), code.indexOf("// ── Render"))
        expect(body).toContain("Status == MsCompleted")
        expect(body).toContain("PlatformFee")
    })
})
