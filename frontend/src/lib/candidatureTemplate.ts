/**
 * Candidature Template — Gno realm code generator for MembaDAO candidature flow.
 *
 * Generates a candidature realm that manages membership applications:
 * - Public candidature submission (name, philosophy, skills)
 * - Two-member approval system
 * - Admin rejection
 * - Auto-airdrop of $MEMBA tokens on approval
 * - One candidature per address
 *
 * v2.1a: Part of the Community Foundation layer.
 *
 * @module lib/candidatureTemplate
 */

import type { AminoMsg } from "./grc20"
import { MEMBA_DAO, MEMBA_TOKEN } from "./config"

// ── Types ─────────────────────────────────────────────────────

export type CandidatureStatus = "pending" | "approved" | "rejected"

export interface Candidature {
    applicant: string    // g1... address
    name: string
    philosophy: string   // "Why Memba?"
    skills: string       // comma-separated
    status: CandidatureStatus
    approvedBy: string[] // addresses of approving members
    createdAt: number    // block height
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

/** Max length for candidature name field. */
export const MAX_NAME_LENGTH = 64

/** Max length for philosophy ("Why Memba?") field. */
export const MAX_PHILOSOPHY_LENGTH = 1024

/** Max length for skills field. */
export const MAX_SKILLS_LENGTH = 256

/** Validate candidature submission fields. Returns null if valid, error string otherwise. */
export function validateCandidature(name: string, philosophy: string, skills: string): string | null {
    if (!name.trim()) return "Name is required"
    if (name.length > MAX_NAME_LENGTH) return `Name too long (max ${MAX_NAME_LENGTH} chars)`
    if (!philosophy.trim()) return "Philosophy is required — tell us why you want to join"
    if (philosophy.length > MAX_PHILOSOPHY_LENGTH) return `Philosophy too long (max ${MAX_PHILOSOPHY_LENGTH} chars)`
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

/** Re-candidature base cost: 10 GNOT per past rejection (in ugnot). */
export const RECANDIDATURE_COST_UGNOT = 10_000_000

/**
 * Calculate the GNOT send amount for a candidature submission.
 * First attempt: free. Each rejection adds 10 GNOT.
 */
export function getCandidatureSendAmount(pastRejections: number): bigint {
    if (pastRejections <= 0) return 0n
    return BigInt(pastRejections) * BigInt(RECANDIDATURE_COST_UGNOT)
}

// ── MsgCall Builders ──────────────────────────────────────────

/**
 * Build MsgCall to submit a candidature.
 * Calls: SubmitCandidature(name, philosophy, skills)
 */
export function buildSubmitCandidatureMsg(
    callerAddress: string,
    name: string,
    philosophy: string,
    skills: string,
    realmPath: string = MEMBA_DAO.candidaturePath,
    pastRejections: number = 0,
): AminoMsg {
    const sendAmount = getCandidatureSendAmount(pastRejections)
    return {
        type: "vm/MsgCall",
        value: {
            caller: callerAddress,
            send: sendAmount > 0n ? `${sendAmount}ugnot` : "",
            pkg_path: realmPath,
            func: "SubmitCandidature",
            args: [name, philosophy, skills],
        },
    }
}

/**
 * Build MsgCall to approve a candidature.
 * Calls: ApproveCandidature(applicantAddress)
 */
export function buildApproveCandidatureMsg(
    callerAddress: string,
    applicantAddress: string,
    realmPath: string = MEMBA_DAO.candidaturePath,
): AminoMsg {
    return {
        type: "vm/MsgCall",
        value: {
            caller: callerAddress,
            send: "",
            pkg_path: realmPath,
            func: "ApproveCandidature",
            args: [applicantAddress],
        },
    }
}

/**
 * Build MsgCall to reject a candidature.
 * Calls: RejectCandidature(applicantAddress)
 */
export function buildRejectCandidatureMsg(
    callerAddress: string,
    applicantAddress: string,
    realmPath: string = MEMBA_DAO.candidaturePath,
): AminoMsg {
    return {
        type: "vm/MsgCall",
        value: {
            caller: callerAddress,
            send: "",
            pkg_path: realmPath,
            func: "RejectCandidature",
            args: [applicantAddress],
        },
    }
}

// ── ABCI Query Parsers ────────────────────────────────────────

/**
 * Parse candidature list from Render("") output.
 *
 * Expected format:
 * ```
 * # MembaDAO Candidatures
 *
 * ## Pending (2)
 *
 * ### g1abc...
 * **Name**: Alice | **Skills**: rust, go | **Status**: pending
 * *Approvals: 1/2 (g1voter1)*
 *
 * > Why Memba? I believe in decentralization...
 * ```
 */
export function parseCandidatureList(raw: string): Candidature[] {
    const candidatures: Candidature[] = []
    const blocks = raw.split("### ").slice(1) // split by ### headings

    for (const block of blocks) {
        const lines = block.split("\n").map(l => l.trim())
        const applicant = lines[0]?.replace(/\.\.\./g, "").trim() || ""

        const metaLine = lines.find(l => l.startsWith("**Name**:")) || ""
        const nameMatch = metaLine.match(/\*\*Name\*\*:\s*([^|]+)/)
        const skillsMatch = metaLine.match(/\*\*Skills\*\*:\s*([^|]+)/)
        const statusMatch = metaLine.match(/\*\*Status\*\*:\s*(\w+)/)

        const approvalsLine = lines.find(l => l.startsWith("*Approvals:")) || ""
        const approversMatch = approvalsLine.match(/\(([^)]+)\)/)
        const approvedBy = approversMatch
            ? approversMatch[1].split(",").map(s => s.trim()).filter(Boolean)
            : []

        const philoLine = lines.find(l => l.startsWith("> ")) || ""
        const philosophy = philoLine.replace(/^>\s*/, "").replace(/^Why Memba\?\s*/i, "")

        candidatures.push({
            applicant,
            name: nameMatch?.[1]?.trim() || "",
            philosophy,
            skills: skillsMatch?.[1]?.trim() || "",
            status: (statusMatch?.[1] as CandidatureStatus) || "pending",
            approvedBy,
            createdAt: 0,
        })
    }

    return candidatures
}

/**
 * Generate the candidature realm Gno source code.
 * Used by the MembaDAO deployment orchestrator.
 *
 * Note: `\\n` in template strings produces `\n` in Go source (correct behavior).
 */
export function generateCandidatureCode(config: CandidatureConfig = defaultCandidatureConfig): string {
    return `package candidature

import (
\t"std"
\t"strings"
\t"strconv"
)

// ── Types ─────────────────────────────────────────────────────

type Candidature struct {
\tApplicant   std.Address
\tName        string
\tPhilosophy  string
\tSkills      string
\tStatus      string // "pending", "approved", "rejected"
\tApprovedBy  []std.Address
\tCreatedAt   int64
}

// ── State ─────────────────────────────────────────────────────

var (
\tcandidatures []Candidature
\tadminAddr    std.Address
\trequiredApprovals int = ${config.requiredApprovals}
\t// Re-candidature cost: each rejection adds 10 GNOT to the next attempt
\trejectionCount map[string]int
\tbaseCostUgnot  int64 = 10_000_000 // 10 GNOT per past rejection
)

func init() {
\tadminAddr = std.GetOrigCaller()
\trejectionCount = make(map[string]int)
}

// ── Public Functions ──────────────────────────────────────────

func SubmitCandidature(cur realm, name, philosophy, skills string) {
\tcaller := std.GetOrigCaller()
\t// Prevent duplicate pending submissions
\tfor _, c := range candidatures {
\t\tif c.Applicant == caller && c.Status == "pending" {
\t\t\tpanic("You already have a pending candidature")
\t\t}
\t}
\t// Enforce increasing cost on re-application after rejection
\trejections := rejectionCount[string(caller)]
\tif rejections > 0 {
\t\trequiredCost := int64(rejections) * baseCostUgnot
\t\tsent := std.GetOrigSend()
\t\tif sent.AmountOf("ugnot") < requiredCost {
\t\t\tpanic("Re-candidature requires " + strconv.FormatInt(requiredCost/1_000_000, 10) + " GNOT (attempt #" + strconv.Itoa(rejections+1) + ")")
\t\t}
\t}
\tif len(name) == 0 || len(name) > ${MAX_NAME_LENGTH} {
\t\tpanic("Invalid name length")
\t}
\tif len(philosophy) == 0 || len(philosophy) > ${MAX_PHILOSOPHY_LENGTH} {
\t\tpanic("Philosophy is required")
\t}
\tif len(skills) > ${MAX_SKILLS_LENGTH} {
\t\tpanic("Skills too long")
\t}
\tcandidatures = append(candidatures, Candidature{
\t\tApplicant:  caller,
\t\tName:       name,
\t\tPhilosophy: philosophy,
\t\tSkills:     skills,
\t\tStatus:     "pending",
\t\tApprovedBy: []std.Address{},
\t\tCreatedAt:  std.GetHeight(),
\t})
}

func ApproveCandidature(cur realm, applicant string) {
	caller := std.GetOrigCaller()
	addr := std.Address(applicant)
	// Prevent self-approval
	if caller == addr {
		panic("Cannot approve your own candidature")
	}
	for i, c := range candidatures {
		if c.Applicant == addr && c.Status == "pending" {
			// Check not already approved by this caller
			for _, a := range c.ApprovedBy {
				if a == caller {
					panic("You already approved this candidature")
				}
			}
			candidatures[i].ApprovedBy = append(c.ApprovedBy, caller)
			if len(candidatures[i].ApprovedBy) >= requiredApprovals {
				candidatures[i].Status = "approved"
				// TODO: cross-realm airdrop of ${config.airdropAmount} ${config.tokenSymbol}
			}
			return
		}
	}
	panic("Candidature not found or not pending")
}

func RejectCandidature(cur realm, applicant string) {
	caller := std.GetOrigCaller()
	if caller != adminAddr {
		panic("Only admin can reject candidatures")
	}
	addr := std.Address(applicant)
	for i, c := range candidatures {
		if c.Applicant == addr && c.Status == "pending" {
			candidatures[i].Status = "rejected"
			rejectionCount[string(addr)]++
			return
		}
	}
	panic("Candidature not found or not pending")
}

func GetCandidatures() []Candidature {
	return candidatures
}

// ── Render ────────────────────────────────────────────────────

func Render(path string) string {
	var sb strings.Builder
	sb.WriteString("# MembaDAO Candidatures\\n\\n")

	// Filter by path: "", "pending", "approved", "rejected"
	statusFilter := ""
	if path == "pending" || path == "approved" || path == "rejected" {
		statusFilter = path
	}

	pending := 0
	for _, c := range candidatures {
		if c.Status == "pending" {
			pending++
		}
	}
	sb.WriteString("## Pending (" + strconv.Itoa(pending) + ")\\n\\n")

	for _, c := range candidatures {
		if statusFilter != "" && c.Status != statusFilter {
			continue
		}
		sb.WriteString("### " + string(c.Applicant) + "\\n")
		sb.WriteString("**Name**: " + c.Name + " | **Skills**: " + c.Skills + " | **Status**: " + c.Status + "\\n")
		approvers := ""
		for j, a := range c.ApprovedBy {
			if j > 0 { approvers += ", " }
			approvers += string(a)
		}
		sb.WriteString("*Approvals: " + strconv.Itoa(len(c.ApprovedBy)) + "/" + strconv.Itoa(requiredApprovals) + " (" + approvers + ")*\\n")
		sb.WriteString("> Why Memba? " + c.Philosophy + "\\n\\n")
	}

	return sb.String()
}
`
}
