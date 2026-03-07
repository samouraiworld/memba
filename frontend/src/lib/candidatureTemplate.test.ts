/**
 * Candidature Template Tests — validation, MsgCall builders, parser, code gen.
 */

import { describe, it, expect } from "vitest"
import {
    validateCandidature,
    parseSkills,
    buildSubmitCandidatureMsg,
    buildApproveCandidatureMsg,
    buildRejectCandidatureMsg,
    parseCandidatureList,
    generateCandidatureCode,
    getCandidatureSendAmount,
    RECANDIDATURE_COST_UGNOT,
    defaultCandidatureConfig,
    MAX_NAME_LENGTH,
    MAX_PHILOSOPHY_LENGTH,
    MAX_SKILLS_LENGTH,
} from "./candidatureTemplate"

// ── Validation ────────────────────────────────────────────────

describe("validateCandidature", () => {
    it("accepts valid inputs", () => {
        expect(validateCandidature("Alice", "I love Gno", "rust, go")).toBeNull()
    })

    it("rejects empty name", () => {
        expect(validateCandidature("", "reason", "skills")).toContain("Name is required")
    })

    it("rejects whitespace-only name", () => {
        expect(validateCandidature("   ", "reason", "skills")).toContain("Name is required")
    })

    it("rejects long name", () => {
        expect(validateCandidature("a".repeat(MAX_NAME_LENGTH + 1), "reason", "skills")).toContain("too long")
    })

    it("rejects empty philosophy", () => {
        expect(validateCandidature("Alice", "", "skills")).toContain("Philosophy is required")
    })

    it("rejects long philosophy", () => {
        expect(validateCandidature("Alice", "x".repeat(MAX_PHILOSOPHY_LENGTH + 1), "skills")).toContain("too long")
    })

    it("rejects empty skills", () => {
        expect(validateCandidature("Alice", "reason", "")).toContain("skill is required")
    })

    it("rejects long skills", () => {
        expect(validateCandidature("Alice", "reason", "x".repeat(MAX_SKILLS_LENGTH + 1))).toContain("too long")
    })

    it("accepts max-length inputs", () => {
        expect(validateCandidature(
            "a".repeat(MAX_NAME_LENGTH),
            "b".repeat(MAX_PHILOSOPHY_LENGTH),
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

// ── MsgCall Builders ──────────────────────────────────────────

describe("buildSubmitCandidatureMsg", () => {
    it("builds correct submit message", () => {
        const msg = buildSubmitCandidatureMsg("g1caller", "Alice", "I love Gno", "rust, go")
        expect(msg.type).toBe("vm/MsgCall")
        expect(msg.value.func).toBe("SubmitCandidature")
        expect(msg.value.args).toEqual(["Alice", "I love Gno", "rust, go"])
        expect(msg.value.caller).toBe("g1caller")
    })

    it("uses default candidature realm path", () => {
        const msg = buildSubmitCandidatureMsg("g1caller", "Alice", "reason", "skills")
        expect(msg.value.pkg_path).toContain("candidature")
    })

    it("accepts custom realm path", () => {
        const msg = buildSubmitCandidatureMsg("g1caller", "A", "B", "C", "gno.land/r/custom/candidature")
        expect(msg.value.pkg_path).toBe("gno.land/r/custom/candidature")
    })
})

describe("buildApproveCandidatureMsg", () => {
    it("builds correct approve message", () => {
        const msg = buildApproveCandidatureMsg("g1voter", "g1applicant")
        expect(msg.value.func).toBe("ApproveCandidature")
        expect(msg.value.args).toEqual(["g1applicant"])
        expect(msg.value.caller).toBe("g1voter")
    })
})

describe("buildRejectCandidatureMsg", () => {
    it("builds correct reject message", () => {
        const msg = buildRejectCandidatureMsg("g1admin", "g1applicant")
        expect(msg.value.func).toBe("RejectCandidature")
        expect(msg.value.args).toEqual(["g1applicant"])
    })
})

// ── Parser ────────────────────────────────────────────────────

describe("parseCandidatureList", () => {
    const sampleRender = `# MembaDAO Candidatures

## Pending (1)

### g1abc123
**Name**: Alice | **Skills**: rust, go | **Status**: pending
*Approvals: 1/2 (g1voter1)*
> Why Memba? I believe in decentralized governance

### g1def456
**Name**: Bob | **Skills**: typescript | **Status**: approved
*Approvals: 2/2 (g1voter1, g1voter2)*
> Why Memba? Building the future
`

    it("parses candidature list", () => {
        const result = parseCandidatureList(sampleRender)
        expect(result).toHaveLength(2)
    })

    it("extracts applicant address", () => {
        const result = parseCandidatureList(sampleRender)
        expect(result[0].applicant).toBe("g1abc123")
    })

    it("extracts name", () => {
        const result = parseCandidatureList(sampleRender)
        expect(result[0].name).toBe("Alice")
    })

    it("extracts skills", () => {
        const result = parseCandidatureList(sampleRender)
        expect(result[0].skills).toBe("rust, go")
    })

    it("extracts status", () => {
        const result = parseCandidatureList(sampleRender)
        expect(result[0].status).toBe("pending")
        expect(result[1].status).toBe("approved")
    })

    it("extracts approvers", () => {
        const result = parseCandidatureList(sampleRender)
        expect(result[0].approvedBy).toEqual(["g1voter1"])
        expect(result[1].approvedBy).toEqual(["g1voter1", "g1voter2"])
    })

    it("extracts philosophy", () => {
        const result = parseCandidatureList(sampleRender)
        expect(result[0].philosophy).toBe("I believe in decentralized governance")
    })

    it("handles empty render", () => {
        expect(parseCandidatureList("# MembaDAO Candidatures\n\n## Pending (0)")).toEqual([])
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
    it("generates valid Gno code", () => {
        const code = generateCandidatureCode()
        expect(code).toContain("package candidature")
        expect(code).toContain("func SubmitCandidature")
        expect(code).toContain("func ApproveCandidature")
        expect(code).toContain("func RejectCandidature")
        expect(code).toContain("func Render")
    })

    it("embeds required approvals from config", () => {
        const code = generateCandidatureCode({ ...defaultCandidatureConfig, requiredApprovals: 3 })
        expect(code).toContain("requiredApprovals int = 3")
    })

    it("includes duplicate submission prevention", () => {
        const code = generateCandidatureCode()
        expect(code).toContain("already have a pending candidature")
    })

    it("includes name length validation", () => {
        const code = generateCandidatureCode()
        expect(code).toContain(String(MAX_NAME_LENGTH))
    })

    it("includes admin-only rejection", () => {
        const code = generateCandidatureCode()
        expect(code).toContain("Only admin can reject")
    })

    it("includes skills length validation (C2 fix)", () => {
        const code = generateCandidatureCode()
        expect(code).toContain("Skills too long")
        expect(code).toContain(String(MAX_SKILLS_LENGTH))
    })

    it("includes rejection counter for re-candidature cost (M3 fix)", () => {
        const code = generateCandidatureCode()
        expect(code).toContain("rejectionCount")
        expect(code).toContain("baseCostUgnot")
    })

    it("includes self-approval guard (R2-I1 fix)", () => {
        const code = generateCandidatureCode()
        expect(code).toContain("Cannot approve your own candidature")
    })

    it("supports Render path filtering (R2-M2 fix)", () => {
        const code = generateCandidatureCode()
        expect(code).toContain("statusFilter")
        expect(code).toContain(`path == "pending"`)
        expect(code).toContain(`path == "approved"`)
        expect(code).toContain(`path == "rejected"`)
    })
})

// ── Re-Candidature Cost ───────────────────────────────────────

describe("getCandidatureSendAmount", () => {
    it("returns 0 for first attempt", () => {
        expect(getCandidatureSendAmount(0)).toBe(0n)
    })

    it("returns 10 GNOT for second attempt", () => {
        expect(getCandidatureSendAmount(1)).toBe(BigInt(RECANDIDATURE_COST_UGNOT))
    })

    it("returns 20 GNOT for third attempt", () => {
        expect(getCandidatureSendAmount(2)).toBe(BigInt(RECANDIDATURE_COST_UGNOT) * 2n)
    })

    it("returns 0 for negative input", () => {
        expect(getCandidatureSendAmount(-1)).toBe(0n)
    })
})

describe("buildSubmitCandidatureMsg with re-candidature", () => {
    it("has empty send for first attempt", () => {
        const msg = buildSubmitCandidatureMsg("g1caller", "Alice", "reason", "skills", undefined, 0)
        expect(msg.value.send).toBe("")
    })

    it("includes GNOT send for re-candidature", () => {
        const msg = buildSubmitCandidatureMsg("g1caller", "Alice", "reason", "skills", undefined, 1)
        expect(msg.value.send).toBe("10000000ugnot")
    })

    it("scales cost with rejection count", () => {
        const msg = buildSubmitCandidatureMsg("g1caller", "Alice", "reason", "skills", undefined, 3)
        expect(msg.value.send).toBe("30000000ugnot")
    })
})
