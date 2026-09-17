/**
 * Candidature client — types, validation, MsgCall builders, and Render parser
 * for the MembaDAO candidature realm. Canonical path is gno.land/r/samcrew/memba_dao_candidature_v3
 * (IsUserCall-guarded, P0 fund-drain fix); the older _v2 is paused and retained for legacy withdrawals.
 *
 * The deployed realm (via samcrew-deployer) uses:
 *   - Apply(bio, skills) — with GNOT deposit (10 GNOT min, 10x per re-application)
 *   - MarkApproved(applicant) / MarkRejected(applicant) — DAO governance
 *   - Withdraw() — reclaim deposit from pending application
 *
 * v2.29: Aligned with deployed realm API (Apply instead of SubmitCandidature).
 *
 * @module lib/candidatureTemplate
 */

import type { AminoMsg } from "./grc20"
import { MEMBA_DAO } from "./config"

// ── Types ─────────────────────────────────────────────────────

export type CandidatureStatus = "pending" | "approved" | "rejected" | "withdrawn"

export interface Candidature {
    applicant: string    // g1... address
    bio: string          // applicant's bio / motivation
    skills: string       // comma-separated
    deposit: number      // deposit in ugnot
    status: CandidatureStatus
    appliedAt: number    // block height
    applyCount: number   // attempt number
}

// ── Validation ────────────────────────────────────────────────

/** Max length for bio field (matches deployed realm MaxBioLen). */
export const MAX_BIO_LENGTH = 5000

/** Max length for skills field (matches deployed realm MaxSkillsLen). */
export const MAX_SKILLS_LENGTH = 5000

/** Minimum deposit in ugnot (10 GNOT). */
export const MIN_DEPOSIT_UGNOT = 10_000_000

/** Deposit multiplier per re-application (10x). */
export const DEPOSIT_MULTIPLY = 10

/** Validate candidature submission fields. Returns null if valid, error string otherwise. */
export function validateCandidature(bio: string, skills: string): string | null {
    if (!bio.trim()) return "Bio is required — tell us about yourself and why you want to join"
    if (bio.length > MAX_BIO_LENGTH) return `Bio too long (max ${MAX_BIO_LENGTH} chars)`
    if (!skills.trim()) return "At least one skill is required"
    if (skills.length > MAX_SKILLS_LENGTH) return `Skills too long (max ${MAX_SKILLS_LENGTH} chars)`
    return null
}

/** Parse skills string into array. */
export function parseSkills(skills: string): string[] {
    return skills
        .split(",")
        .map(s => s.trim())
        .filter(Boolean)
}

/**
 * Calculate the required deposit for a candidature submission.
 * First attempt: 10 GNOT. Each re-application: 10x the previous (10, 100, 1000...).
 * Matches the deployed realm's deposit scaling logic.
 */
export function getRequiredDeposit(applyCount: number): bigint {
    let required = BigInt(MIN_DEPOSIT_UGNOT)
    for (let i = 0; i < applyCount; i++) {
        required *= BigInt(DEPOSIT_MULTIPLY)
    }
    return required
}

// ── MsgCall Builders ──────────────────────────────────────────

/**
 * Build MsgCall to submit a candidature.
 * Calls deployed realm: Apply(bio, skills) with GNOT deposit.
 */
export function buildSubmitCandidatureMsg(
    callerAddress: string,
    bio: string,
    skills: string,
    realmPath: string = MEMBA_DAO.candidaturePath,
    applyCount: number = 0,
): AminoMsg {
    const deposit = getRequiredDeposit(applyCount)
    return {
        type: "vm/MsgCall",
        value: {
            caller: callerAddress,
            send: `${deposit}ugnot`,
            pkg_path: realmPath,
            func: "Apply",
            args: [bio, skills],
        },
    }
}

/**
 * Build MsgCall to withdraw a pending candidature and reclaim deposit.
 * Calls deployed realm: Withdraw()
 */
export function buildWithdrawCandidatureMsg(
    callerAddress: string,
    realmPath: string = MEMBA_DAO.candidaturePath,
): AminoMsg {
    return {
        type: "vm/MsgCall",
        value: {
            caller: callerAddress,
            send: "",
            pkg_path: realmPath,
            func: "Withdraw",
            args: [],
        },
    }
}

/**
 * Build MsgCall for an admin to approve a pending application.
 * Calls deployed realm: MarkApproved(applicant) — admin-only; returns the
 * applicant's deposit and sets status to "approved".
 */
export function buildMarkApprovedMsg(
    callerAddress: string,
    applicant: string,
    realmPath: string = MEMBA_DAO.candidaturePath,
): AminoMsg {
    return {
        type: "vm/MsgCall",
        value: {
            caller: callerAddress,
            send: "",
            pkg_path: realmPath,
            func: "MarkApproved",
            args: [applicant],
        },
    }
}

/**
 * Build MsgCall for an admin to reject a pending application.
 * Calls deployed realm: MarkRejected(applicant) — admin-only; returns the
 * applicant's deposit and sets status to "rejected".
 */
export function buildMarkRejectedMsg(
    callerAddress: string,
    applicant: string,
    realmPath: string = MEMBA_DAO.candidaturePath,
): AminoMsg {
    return {
        type: "vm/MsgCall",
        value: {
            caller: callerAddress,
            send: "",
            pkg_path: realmPath,
            func: "MarkRejected",
            args: [applicant],
        },
    }
}

// ── ABCI Query Parsers ────────────────────────────────────────

/**
 * Parse the result of a `vm/qeval` call to `IsAdmin(addr)` on the candidature
 * realm. gno renders a bool as `(true bool)` / `(false bool)` (or bare
 * `true`/`false`). Fails closed: null/empty/unexpected → false (so the admin
 * UI never appears on a failed or malformed check).
 */
export function parseIsAdminResult(raw: string | null): boolean {
    if (!raw) return false
    return /^\(?\s*true\b/.test(raw.trim())
}

/**
 * Parse candidature list from the deployed realm's Render("") output.
 *
 * Deployed realm format:
 * ```
 * # MembaDAO Candidature
 *
 * Apply to join the Memba community.
 *
 * **Stats:** 1 pending | 0 approved | 0 rejected
 *
 * ## Pending Applications
 *
 * - [g1abc...](:application/g1abc...) — deposit: 10 GNOT — block 150813
 * ```
 *
 * Individual application format (Render("application/g1addr")):
 * ```
 * # Application: g1abc...
 *
 * **Status:** pending
 * **Deposit:** 10 GNOT
 * **Applied at block:** 150813
 * **Attempt #:** 1
 *
 * ## Bio
 *
 * I want to contribute to Memba DAO...
 *
 * ## Skills
 *
 * go, rust, typescript
 * ```
 */
export function parseCandidatureList(raw: string): Candidature[] {
    const candidatures: Candidature[] = []

    // Parse the list entries: - [g1addr](:application/g1addr) — deposit: X GNOT — block Y
    const listPattern = /- \[([^\]]+)\]\(:application\/[^)]+\)\s*—\s*deposit:\s*([^\s]+)\s*GNOT\s*—\s*block\s*(\d+)/g
    let match
    while ((match = listPattern.exec(raw)) !== null) {
        const applicant = match[1]
        const depositGnot = parseFloat(match[2]) || 0
        const appliedAt = parseInt(match[3]) || 0

        candidatures.push({
            applicant,
            bio: "",
            skills: "",
            deposit: depositGnot * 1_000_000, // convert to ugnot
            status: "pending",
            appliedAt,
            applyCount: 0,
        })
    }

    return candidatures
}

/**
 * Parse a single application detail from Render("application/g1addr") output.
 */
export function parseCandidatureDetail(raw: string): Candidature | null {
    if (!raw || raw.includes("Application Not Found")) return null

    const applicantMatch = raw.match(/# Application:\s*(\S+)/)
    const statusMatch = raw.match(/\*\*Status:\*\*\s*(\w+)/)
    const depositMatch = raw.match(/\*\*Deposit:\*\*\s*([^\s]+)\s*GNOT/)
    const blockMatch = raw.match(/\*\*Applied at block:\*\*\s*(\d+)/)
    const attemptMatch = raw.match(/\*\*Attempt #:\*\*\s*(\d+)/)

    // Extract bio section (between "## Bio" and "## Skills")
    const bioMatch = raw.match(/## Bio\s*\n\s*([\s\S]*?)(?=\n## Skills|\n*$)/)
    // Extract skills section (after "## Skills")
    const skillsMatch = raw.match(/## Skills\s*\n\s*([\s\S]*?)$/)

    return {
        applicant: applicantMatch?.[1] || "",
        bio: bioMatch?.[1]?.trim() || "",
        skills: skillsMatch?.[1]?.trim() || "",
        deposit: (parseFloat(depositMatch?.[1] || "0") || 0) * 1_000_000,
        status: (statusMatch?.[1] as CandidatureStatus) || "pending",
        appliedAt: parseInt(blockMatch?.[1] || "0") || 0,
        applyCount: parseInt(attemptMatch?.[1] || "0") || 0,
    }
}
