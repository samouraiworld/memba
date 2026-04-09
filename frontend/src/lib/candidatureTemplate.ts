/**
 * Candidature Template — types, validation, MsgCall builders, and Render parser
 * for the MembaDAO candidature realm deployed at gno.land/r/samcrew/memba_dao_candidature_v2.
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
import { MEMBA_DAO, MEMBA_TOKEN } from "./config"

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

export interface CandidatureConfig {
    /** MembaDAO realm path (for cross-realm member check). */
    daoRealmPath: string
    /** Candidature realm path. */
    candidatureRealmPath: string
    /** Token symbol for airdrop. */
    tokenSymbol: string
    /** Airdrop amount in smallest unit (e.g. 10 * 10^6 = 10 MEMBA). */
    airdropAmount: bigint
    /** Number of approvals required. */
    requiredApprovals: number
    /** Transfer lock duration in days (0 = no lock). */
    transferLockDays: number
}

// ── Defaults ──────────────────────────────────────────────────

export const defaultCandidatureConfig: CandidatureConfig = {
    daoRealmPath: MEMBA_DAO.realmPath,
    candidatureRealmPath: MEMBA_DAO.candidaturePath,
    tokenSymbol: MEMBA_TOKEN.symbol,
    airdropAmount: 10_000_000n, // 10 MEMBA (6 decimals)
    requiredApprovals: 2,
    transferLockDays: 90,
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

// ── ABCI Query Parsers ────────────────────────────────────────

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

/**
 * Generate the candidature realm Gno source code.
 *
 * NOTE: The canonical MembaDAO candidature realm is deployed via samcrew-deployer
 * (projects/memba/realms/memba_dao_candidature_v2/). This generator is kept for
 * user-created DAOs that want their own candidature flow. It generates a
 * simplified version — the deployed realm uses avl trees and banker.
 */
export function generateCandidatureCode(config: CandidatureConfig = defaultCandidatureConfig): string {
    return `package candidature

import (
\t"chain/runtime"
\t"strings"
\t"strconv"
)

type Application struct {
\tApplicant  address
\tBio        string
\tSkills     string
\tStatus     string // "pending", "approved", "rejected"
\tApplyCount int
}

var (
\tapplications []Application
\tadminAddr    address
\trequiredApprovals int = ${config.requiredApprovals}
)

func init() {
\tadminAddr = runtime.PreviousRealm().Address()
}

func Apply(cur realm, bio, skills string) {
\tcaller := runtime.PreviousRealm().Address()
\tfor _, a := range applications {
\t\tif a.Applicant == caller && a.Status == "pending" {
\t\t\tpanic("you already have a pending application")
\t\t}
\t}
\tif len(bio) == 0 || len(bio) > ${MAX_BIO_LENGTH} {
\t\tpanic("invalid bio length")
\t}
\tif len(skills) > ${MAX_SKILLS_LENGTH} {
\t\tpanic("skills too long")
\t}
\tapplications = append(applications, Application{
\t\tApplicant:  caller,
\t\tBio:        bio,
\t\tSkills:     skills,
\t\tStatus:     "pending",
\t\tApplyCount: 1,
\t})
}

func Render(path string) string {
\tvar sb strings.Builder
\tsb.WriteString("# Candidature\\n\\n")
\tpending := 0
\tfor _, a := range applications {
\t\tif a.Status == "pending" { pending++ }
\t}
\tsb.WriteString("**Stats:** " + strconv.Itoa(pending) + " pending\\n\\n")
\tfor _, a := range applications {
\t\tsb.WriteString("- " + string(a.Applicant) + " (" + a.Status + ")\\n")
\t}
\treturn sb.String()
}
`
}
