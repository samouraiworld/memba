/**
 * Candidature Template Tests — validation, MsgCall builders, parser, code gen.
 *
 * v2.29: Updated to match deployed realm API (Apply instead of SubmitCandidature).
 */

import { describe, it, expect } from "vitest"
import {
    validateCandidature,
    parseSkills,
    buildSubmitCandidatureMsg,
    buildWithdrawCandidatureMsg,
    parseCandidatureList,
    parseCandidatureDetail,
    generateCandidatureCode,
    getRequiredDeposit,
    defaultCandidatureConfig,
    MAX_BIO_LENGTH,
    MAX_SKILLS_LENGTH,
    MIN_DEPOSIT_UGNOT,
    DEPOSIT_MULTIPLY,
} from "./candidatureTemplate"

// ── Validation ────────────────────────────────────────────────

describe("validateCandidature", () => {
    it("accepts valid inputs", () => {
        expect(validateCandidature("I love Gno and want to contribute", "rust, go")).toBeNull()
    })

    it("rejects empty bio", () => {
        expect(validateCandidature("", "skills")).toContain("Bio is required")
    })

    it("rejects whitespace-only bio", () => {
        expect(validateCandidature("   ", "skills")).toContain("Bio is required")
    })

    it("rejects long bio", () => {
        expect(validateCandidature("a".repeat(MAX_BIO_LENGTH + 1), "skills")).toContain("too long")
    })

    it("rejects empty skills", () => {
        expect(validateCandidature("bio text", "")).toContain("skill is required")
    })

    it("rejects long skills", () => {
        expect(validateCandidature("bio text", "x".repeat(MAX_SKILLS_LENGTH + 1))).toContain("too long")
    })

    it("accepts max-length inputs", () => {
        expect(validateCandidature(
            "a".repeat(MAX_BIO_LENGTH),
            "c".repeat(MAX_SKILLS_LENGTH),
        )).toBeNull()
    })
})

// ── parseSkills ───────────────────────────────────────────────

describe("parseSkills", () => {
    it("parses comma-separated skills", () => {
        expect(parseSkills("rust, go, typescript")).toEqual(["rust", "go", "typescript"])
    })

    it("handles single skill", () => {
        expect(parseSkills("rust")).toEqual(["rust"])
    })

    it("trims whitespace", () => {
        expect(parseSkills("  rust , go  ")).toEqual(["rust", "go"])
    })

    it("filters empty entries", () => {
        expect(parseSkills("rust,,go,")).toEqual(["rust", "go"])
    })

    it("handles empty string", () => {
        expect(parseSkills("")).toEqual([])
    })
})

// ── Deposit Calculation ──────────────────────────────────────

describe("getRequiredDeposit", () => {
    it("returns 10 GNOT for first attempt", () => {
        expect(getRequiredDeposit(0)).toBe(BigInt(MIN_DEPOSIT_UGNOT))
    })

    it("returns 100 GNOT for second attempt (10x)", () => {
        expect(getRequiredDeposit(1)).toBe(BigInt(MIN_DEPOSIT_UGNOT) * BigInt(DEPOSIT_MULTIPLY))
    })

    it("returns 1000 GNOT for third attempt (10x10)", () => {
        expect(getRequiredDeposit(2)).toBe(
            BigInt(MIN_DEPOSIT_UGNOT) * BigInt(DEPOSIT_MULTIPLY) * BigInt(DEPOSIT_MULTIPLY)
        )
    })
})

// ── MsgCall Builders ──────────────────────────────────────────

describe("buildSubmitCandidatureMsg", () => {
    it("builds correct Apply message with deposit", () => {
        const msg = buildSubmitCandidatureMsg("g1caller", "I love Gno", "rust, go")
        expect(msg.type).toBe("vm/MsgCall")
        expect(msg.value.func).toBe("Apply")
        expect(msg.value.args).toEqual(["I love Gno", "rust, go"])
        expect(msg.value.caller).toBe("g1caller")
        expect(msg.value.send).toBe("10000000ugnot") // 10 GNOT minimum deposit
    })

    it("uses default candidature realm path", () => {
        const msg = buildSubmitCandidatureMsg("g1caller", "bio", "skills")
        expect(msg.value.pkg_path).toContain("candidature")
    })

    it("accepts custom realm path", () => {
        const msg = buildSubmitCandidatureMsg("g1caller", "A", "C", "gno.land/r/custom/candidature")
        expect(msg.value.pkg_path).toBe("gno.land/r/custom/candidature")
    })

    it("scales deposit for re-application", () => {
        const msg = buildSubmitCandidatureMsg("g1caller", "bio", "skills", undefined, 1)
        expect(msg.value.send).toBe("100000000ugnot") // 100 GNOT (10x)
    })

    it("always includes deposit (even first attempt)", () => {
        const msg = buildSubmitCandidatureMsg("g1caller", "bio", "skills", undefined, 0)
        expect(msg.value.send).toBe("10000000ugnot")
    })
})

describe("buildWithdrawCandidatureMsg", () => {
    it("builds correct Withdraw message", () => {
        const msg = buildWithdrawCandidatureMsg("g1caller")
        expect(msg.value.func).toBe("Withdraw")
        expect(msg.value.args).toEqual([])
        expect(msg.value.send).toBe("")
    })
})

// ── Parser (deployed realm format) ──────────────────────────

describe("parseCandidatureList", () => {
    const sampleRender = `# MembaDAO Candidature

Apply to join the Memba community.

**Stats:** 2 pending | 1 approved | 0 rejected

## Pending Applications

- [g1abc123456789012345678901234567890123456](:application/g1abc123456789012345678901234567890123456) — deposit: 10 GNOT — block 150813
- [g1def987654321098765432109876543210987654](:application/g1def987654321098765432109876543210987654) — deposit: 100 GNOT — block 150900
`

    it("parses candidature list from deployed Render format", () => {
        const result = parseCandidatureList(sampleRender)
        expect(result).toHaveLength(2)
    })

    it("extracts applicant address", () => {
        const result = parseCandidatureList(sampleRender)
        expect(result[0].applicant).toBe("g1abc123456789012345678901234567890123456")
    })

    it("extracts deposit amount", () => {
        const result = parseCandidatureList(sampleRender)
        expect(result[0].deposit).toBe(10_000_000) // 10 GNOT in ugnot
        expect(result[1].deposit).toBe(100_000_000) // 100 GNOT in ugnot
    })

    it("extracts block height", () => {
        const result = parseCandidatureList(sampleRender)
        expect(result[0].appliedAt).toBe(150813)
    })

    it("defaults status to pending", () => {
        const result = parseCandidatureList(sampleRender)
        expect(result[0].status).toBe("pending")
    })

    it("handles empty render", () => {
        expect(parseCandidatureList("# MembaDAO Candidature\n\n**Stats:** 0 pending | 0 approved | 0 rejected")).toEqual([])
    })
})

describe("parseCandidatureDetail", () => {
    const sampleDetail = `# Application: g1abc123

**Status:** pending
**Deposit:** 10 GNOT
**Applied at block:** 150813
**Attempt #:** 1

## Bio

I want to contribute to Memba DAO and build amazing governance tools.

## Skills

go, rust, typescript`

    it("parses application detail", () => {
        const result = parseCandidatureDetail(sampleDetail)
        expect(result).not.toBeNull()
        expect(result!.applicant).toBe("g1abc123")
        expect(result!.bio).toBe("I want to contribute to Memba DAO and build amazing governance tools.")
        expect(result!.skills).toBe("go, rust, typescript")
        expect(result!.status).toBe("pending")
        expect(result!.deposit).toBe(10_000_000)
        expect(result!.appliedAt).toBe(150813)
        expect(result!.applyCount).toBe(1)
    })

    it("returns null for not found", () => {
        expect(parseCandidatureDetail("# Application Not Found\nNo application for g1xyz")).toBeNull()
    })

    it("returns null for empty input", () => {
        expect(parseCandidatureDetail("")).toBeNull()
    })
})

// ── Config Defaults ───────────────────────────────────────────

describe("defaultCandidatureConfig", () => {
    it("uses 2 required approvals", () => {
        expect(defaultCandidatureConfig.requiredApprovals).toBe(2)
    })

    it("uses 10 MEMBA airdrop (6 decimals)", () => {
        expect(defaultCandidatureConfig.airdropAmount).toBe(10_000_000n)
    })

    it("uses 90-day transfer lock", () => {
        expect(defaultCandidatureConfig.transferLockDays).toBe(90)
    })

    it("references candidature realm path", () => {
        expect(defaultCandidatureConfig.candidatureRealmPath).toContain("candidature")
    })
})

// ── Code Generation ───────────────────────────────────────────

describe("generateCandidatureCode", () => {
    it("generates valid Gno code with Apply function", () => {
        const code = generateCandidatureCode()
        expect(code).toContain("package candidature")
        expect(code).toContain("func Apply")
        expect(code).toContain("func Render")
    })

    it("includes duplicate submission prevention", () => {
        const code = generateCandidatureCode()
        expect(code).toContain("already have a pending application")
    })

    it("includes bio length validation", () => {
        const code = generateCandidatureCode()
        expect(code).toContain(String(MAX_BIO_LENGTH))
    })

    it("includes skills length validation", () => {
        const code = generateCandidatureCode()
        expect(code).toContain("skills too long")
        expect(code).toContain(String(MAX_SKILLS_LENGTH))
    })
})
