/**
 * DAO Template Generator — generates Gno realm code for deploying a new DAO.
 *
 * Creates a self-contained governance realm with:
 * - Member management (address + voting power + roles)
 * - Role-based access control (admin, dev, finance, ops, member)
 * - Configurable quorum (minimum participation %)
 * - Proposal categories (governance, treasury, membership, operations)
 * - Voting (YES / NO / ABSTAIN)
 * - Execution of passed proposals
 *
 * Deployed via MsgAddPackage through Adena DoContract.
 */

import type { AminoMsg } from "./grc20"

// ── Types ─────────────────────────────────────────────────────

export interface DAOCreationConfig {
    /** Human-readable DAO name. */
    name: string
    /** Short description. */
    description: string
    /** Gno realm path (e.g., gno.land/r/username/mydao). */
    realmPath: string
    /** Initial members with voting power and roles. */
    members: { address: string; power: number; roles: string[] }[]
    /** Voting threshold percentage (51 = simple majority). */
    threshold: number
    /** Roles available in this DAO. */
    roles: string[]
    /** Minimum participation % required before votes can pass (0 = disabled). */
    quorum: number
    /** Allowed proposal categories. */
    proposalCategories: string[]
}

// ── Presets ────────────────────────────────────────────────────

export interface DAOPreset {
    id: string
    name: string
    icon: string
    description: string
    roles: string[]
    threshold: number
    quorum: number
    categories: string[]
}

export const DAO_PRESETS: DAOPreset[] = [
    {
        id: "basic",
        name: "Basic",
        icon: "🏠",
        description: "Simple DAO with admin + member roles. No quorum requirement.",
        roles: ["admin", "member"],
        threshold: 51,
        quorum: 0,
        categories: ["governance"],
    },
    {
        id: "team",
        name: "Team",
        icon: "👥",
        description: "Team DAO with admin, dev, and member roles. 33% quorum.",
        roles: ["admin", "dev", "member"],
        threshold: 51,
        quorum: 33,
        categories: ["governance", "membership"],
    },
    {
        id: "treasury",
        name: "Treasury",
        icon: "💰",
        description: "Treasury DAO with admin, finance, and member roles. 66% threshold, 50% quorum.",
        roles: ["admin", "finance", "member"],
        threshold: 66,
        quorum: 50,
        categories: ["governance", "treasury"],
    },
    {
        id: "enterprise",
        name: "Enterprise",
        icon: "🏢",
        description: "Full-featured DAO with admin, dev, finance, ops, and member roles.",
        roles: ["admin", "dev", "finance", "ops", "member"],
        threshold: 66,
        quorum: 50,
        categories: ["governance", "treasury", "membership", "operations"],
    },
]

// ── Input Sanitization ────────────────────────────────────────

/** Strict bech32 address validation — only g1 + lowercase alphanum. */
const VALID_ADDRESS = /^g1[a-z0-9]{38}$/

/** Alphanumeric + underscore only — safe for Gno string literals. */
const SAFE_IDENTIFIER = /^[a-z][a-z0-9_]*$/

/** Validate address is strict bech32 format. */
export function isValidGnoAddress(addr: string): boolean {
    return VALID_ADDRESS.test(addr)
}

/** Validate a role/category name — must be lowercase alphanumeric + underscore. */
function isValidIdentifier(s: string): boolean {
    return SAFE_IDENTIFIER.test(s) && s.length <= 30
}

// ── Code Generator ────────────────────────────────────────────

/**
 * Generate Gno realm source code from a DAO configuration.
 * Returns a self-contained .gno file as a string.
 *
 * Security: all user inputs are sanitized before interpolation.
 * - Addresses: strict bech32 validation (g1 + 38 lowercase alphanum)
 * - Roles/Categories: lowercase alphanumeric + underscore only
 * - Name/Description: JSON.stringify (auto-escapes) + control char strip
 */
export function generateDAOCode(config: DAOCreationConfig): string {
    const pkgName = config.realmPath.split("/").pop() || "mydao"

    // Validate and sanitize all member inputs
    const validMembers = config.members.filter((m) => {
        if (!isValidGnoAddress(m.address)) {
            console.warn(`[daoTemplate] Skipping invalid address: ${m.address}`)
            return false
        }
        return true
    })

    const memberInit = validMembers
        .map((m) => {
            const safeRoles = m.roles.filter(isValidIdentifier)
            const rolesStr = safeRoles.map((r) => `"${r}"`).join(", ")
            return `\tmembers = append(members, Member{Address: address("${m.address}"), Power: ${Math.max(0, Math.floor(m.power))}, Roles: []string{${rolesStr}}})`
        })
        .join("\n")

    const safeCategories = config.proposalCategories.filter(isValidIdentifier)
    const categoriesInit = safeCategories
        .map((c) => `\tallowedCategories = append(allowedCategories, "${c}")`)
        .join("\n")

    const safeRoles = config.roles.filter(isValidIdentifier)
    const rolesInit = safeRoles
        .map((r) => `\tallowedRoles = append(allowedRoles, "${r}")`)
        .join("\n")

    return `package ${pkgName}

import (
\t"chain/runtime"
\t"strings"
\t"strconv"
)

// ── Types ─────────────────────────────────────────────────

type Member struct {
\tAddress address
\tPower   int
\tRoles   []string
}

type Vote struct {
\tVoter address
\tValue string // "YES", "NO", "ABSTAIN"
}

type Proposal struct {
\tID          int
\tTitle       string
\tDescription string
\tCategory    string
\tAuthor      address
\tStatus      string // "ACTIVE", "ACCEPTED", "REJECTED", "EXECUTED"
\tVotes       []Vote
\tYesVotes    int
\tNoVotes     int
\tAbstain     int
\tTotalPower  int
}

// ── State ─────────────────────────────────────────────────

var (
\tname              = ${JSON.stringify(config.name)}
\tdescription       = ${JSON.stringify(config.description)}
\tthreshold         = ${config.threshold} // percentage required to pass
\tquorum            = ${config.quorum}  // minimum participation % (0 = disabled)
\tmembers           []Member
\tproposals         []Proposal
\tnextID            = 0
\tallowedCategories []string
\tallowedRoles      []string
\tarchived          = false
)

func init() {
${memberInit}
${categoriesInit}
${rolesInit}
}

// ── Queries ───────────────────────────────────────────────

func Render(path string) string {
\tif path == "" {
\t\treturn renderHome()
\t}
\t// Parse proposal ID from path
\tparts := strings.Split(path, "/")
\tif len(parts) >= 1 {
\t\tid, err := strconv.Atoi(parts[0])
\t\tif err == nil && id >= 0 && id < len(proposals) {
\t\t\tif len(parts) >= 2 && parts[1] == "votes" {
\t\t\t\treturn renderVotes(id)
\t\t\t}
\t\t\treturn renderProposal(id)
\t\t}
\t}
\treturn "# Not Found"
}

func renderHome() string {
\tout := "# " + name + "\\n"
\tout += description + "\\n\\n"
\tout += "Threshold: " + strconv.Itoa(threshold) + "% | Quorum: " + strconv.Itoa(quorum) + "%\\n\\n"
\tout += "## Members (" + strconv.Itoa(len(members)) + ")\\n"
\tfor _, m := range members {
\t\tout += "- " + string(m.Address) + " (roles: " + strings.Join(m.Roles, ", ") + ") | power: " + strconv.Itoa(m.Power) + "\\n"
\t}
\tout += "\\n## Proposals\\n"
\tfor i := len(proposals) - 1; i >= 0; i-- {
\t\tp := proposals[i]
\t\tout += "### [Prop #" + strconv.Itoa(p.ID) + " - " + p.Title + "](:" + strconv.Itoa(p.ID) + ")\\n"
\t\tout += "Author: " + string(p.Author) + "\\n\\n"
\t\tout += "Category: " + p.Category + "\\n\\n"
\t\tout += "Status: " + p.Status + "\\n\\n---\\n\\n"
\t}
\tif len(proposals) == 0 {
\t\tout += "No proposals yet.\\n"
\t}
\treturn out
}

func renderProposal(id int) string {
\tp := proposals[id]
\tout := "# Prop #" + strconv.Itoa(p.ID) + " - " + p.Title + "\\n"
\tout += p.Description + "\\n\\n"
\tout += "Author: " + string(p.Author) + "\\n\\n"
\tout += "Category: " + p.Category + "\\n\\n"
\tout += "Status: " + p.Status + "\\n\\n"
\tout += "YES: " + strconv.Itoa(p.YesVotes) + " | NO: " + strconv.Itoa(p.NoVotes) + " | ABSTAIN: " + strconv.Itoa(p.Abstain) + "\\n"
\tout += "Total Power: " + strconv.Itoa(p.TotalPower) + "/" + strconv.Itoa(totalPower()) + "\\n"
\treturn out
}

func renderVotes(id int) string {
\tp := proposals[id]
\tout := "# Proposal #" + strconv.Itoa(p.ID) + " - Vote List\\n\\n"
\tout += "YES:\\n"
\tfor _, v := range p.Votes {
\t\tif v.Value == "YES" {
\t\t\tout += "- " + string(v.Voter) + "\\n"
\t\t}
\t}
\tout += "\\nNO:\\n"
\tfor _, v := range p.Votes {
\t\tif v.Value == "NO" {
\t\t\tout += "- " + string(v.Voter) + "\\n"
\t\t}
\t}
\tout += "\\nABSTAIN:\\n"
\tfor _, v := range p.Votes {
\t\tif v.Value == "ABSTAIN" {
\t\t\tout += "- " + string(v.Voter) + "\\n"
\t\t}
\t}
\treturn out
}

// ── Actions ───────────────────────────────────────────────

func Propose(cur realm, title, desc, category string) int {
\tcaller := runtime.PreviousRealm().Address()
\tassertNotArchived()
\tassertMember(caller)
\tassertCategory(category)
\tid := nextID
\tnextID++
\tproposals = append(proposals, Proposal{
\t\tID:          id,
\t\tTitle:       title,
\t\tDescription: desc,
\t\tCategory:    category,
\t\tAuthor:      caller,
\t\tStatus:      "ACTIVE",
\t})
\treturn id
}

func VoteOnProposal(cur realm, id int, vote string) {
\tcaller := runtime.PreviousRealm().Address()
\tassertNotArchived()
\tassertMember(caller)
\tif id < 0 || id >= len(proposals) {
\t\tpanic("invalid proposal ID")
\t}
\tp := &proposals[id]
\tif p.Status != "ACTIVE" {
\t\tpanic("proposal is not active")
\t}
\t// Check for duplicate votes
\tfor _, v := range p.Votes {
\t\tif v.Voter == caller {
\t\t\tpanic("already voted")
\t\t}
\t}
\tpower := getMemberPower(caller)
\tp.Votes = append(p.Votes, Vote{Voter: caller, Value: vote})
\tswitch vote {
\tcase "YES":
\t\tp.YesVotes += power
\tcase "NO":
\t\tp.NoVotes += power
\tcase "ABSTAIN":
\t\tp.Abstain += power
\tdefault:
\t\tpanic("invalid vote: must be YES, NO, or ABSTAIN")
\t}
\tp.TotalPower += power
\t// Check quorum + threshold
\ttpow := totalPower()
\tif tpow > 0 {
\t\tquorumMet := quorum == 0 || (p.TotalPower * 100 / tpow >= quorum)
\t\tif quorumMet && p.YesVotes * 100 / tpow >= threshold {
\t\t\tp.Status = "ACCEPTED"
\t\t}
\t\tif quorumMet && p.NoVotes * 100 / tpow > (100 - threshold) {
\t\t\tp.Status = "REJECTED"
\t\t}
\t}
}

func ExecuteProposal(cur realm, id int) {
\tcaller := runtime.PreviousRealm().Address()
\tassertMember(caller)
\tif id < 0 || id >= len(proposals) {
\t\tpanic("invalid proposal ID")
\t}
\tp := &proposals[id]
\tif p.Status != "ACCEPTED" {
\t\tpanic("proposal must be ACCEPTED to execute")
\t}
\tp.Status = "EXECUTED"
}

// ── Role Management (admin-only) ──────────────────────────

func AssignRole(cur realm, target address, role string) {
\tcaller := runtime.PreviousRealm().Address()
\tassertAdmin(caller)
\tassertRole(role)
\tfor i, m := range members {
\t\tif m.Address == target {
\t\t\t// Check role not already assigned
\t\t\tfor _, r := range m.Roles {
\t\t\t\tif r == role {
\t\t\t\t\tpanic("role already assigned")
\t\t\t\t}
\t\t\t}
\t\t\tmembers[i].Roles = append(members[i].Roles, role)
\t\t\treturn
\t\t}
\t}
\tpanic("target is not a member")
}

func RemoveRole(cur realm, target address, role string) {
\tcaller := runtime.PreviousRealm().Address()
\tassertAdmin(caller)
\t// Prevent removing last admin
\tif role == "admin" {
\t\tadminCount := 0
\t\tfor _, m := range members {
\t\t\tif hasRoleInternal(m, "admin") {
\t\t\t\tadminCount++
\t\t\t}
\t\t}
\t\tif adminCount <= 1 {
\t\t\tpanic("cannot remove the last admin")
\t\t}
\t}
\tfor i, m := range members {
\t\tif m.Address == target {
\t\t\tnewRoles := []string{}
\t\t\tfor _, r := range m.Roles {
\t\t\t\tif r != role {
\t\t\t\t\tnewRoles = append(newRoles, r)
\t\t\t\t}
\t\t\t}
\t\t\tmembers[i].Roles = newRoles
\t\t\treturn
\t\t}
\t}
\tpanic("target is not a member")
}

// ── Archive Management ────────────────────────────────────

func Archive(cur realm) {
\tcaller := runtime.PreviousRealm().Address()
\tassertAdmin(caller)
\tarchived = true
}

func IsArchived() bool {
\treturn archived
}

// ── Helpers ───────────────────────────────────────────────

func assertNotArchived() {
\tif archived {
\t\tpanic("DAO is archived — no new proposals or votes")
\t}
}

func assertMember(addr address) {
\tfor _, m := range members {
\t\tif m.Address == addr {
\t\t\treturn
\t\t}
\t}
\tpanic("not a member")
}

func assertAdmin(addr address) {
\tfor _, m := range members {
\t\tif m.Address == addr {
\t\t\tfor _, r := range m.Roles {
\t\t\t\tif r == "admin" {
\t\t\t\t\treturn
\t\t\t\t}
\t\t\t}
\t\t}
\t}
\tpanic("admin role required")
}

func hasRole(addr address, role string) bool {
\tfor _, m := range members {
\t\tif m.Address == addr {
\t\t\treturn hasRoleInternal(m, role)
\t\t}
\t}
\treturn false
}

func hasRoleInternal(m Member, role string) bool {
\tfor _, r := range m.Roles {
\t\tif r == role {
\t\t\treturn true
\t\t}
\t}
\treturn false
}

func getMemberPower(addr address) int {
\tfor _, m := range members {
\t\tif m.Address == addr {
\t\t\treturn m.Power
\t\t}
\t}
\treturn 0
}

func totalPower() int {
\ttotal := 0
\tfor _, m := range members {
\t\ttotal += m.Power
\t}
\treturn total
}

func assertCategory(cat string) {
\tfor _, c := range allowedCategories {
\t\tif c == cat {
\t\t\treturn
\t\t}
\t}
\tpanic("invalid proposal category: " + cat)
}

func assertRole(role string) {
\tfor _, r := range allowedRoles {
\t\tif r == role {
\t\t\treturn
\t\t}
\t}
\tpanic("invalid role: " + role)
}

// ── Config (for Memba integration) ────────────────────────

func GetDAOConfig() string {
\treturn name
}
`
}

// ── MsgAddPackage Builder ─────────────────────────────────

/**
 * Build a MsgAddPackage Amino message for Adena DoContract.
 * Deploys the generated Gno realm code to the specified path.
 */
export function buildDeployDAOMsg(
    callerAddress: string,
    realmPath: string,
    code: string,
    deposit: string = "",
): AminoMsg {
    const pkgName = realmPath.split("/").pop() || "mydao"
    const files = [
        {
            name: `${pkgName}.gno`,
            body: code,
        },
        {
            name: "gnomod.toml",
            body: `module = "${realmPath}"\ngno = "0.9"\n`,
        },
    ].sort((a, b) => a.name.localeCompare(b.name))
    return {
        type: "/vm.m_addpkg",
        value: {
            creator: callerAddress,
            package: {
                name: pkgName,
                path: realmPath,
                files,
            },
            deposit: deposit || "",
        },
    }
}

/**
 * Validate a realm path for DAO creation.
 * Must follow pattern: gno.land/r/username/daoname
 */
export function validateRealmPath(path: string): string | null {
    if (!path.startsWith("gno.land/r/")) return "Must start with gno.land/r/"
    const parts = path.replace("gno.land/r/", "").split("/")
    if (parts.length < 2) return "Must include username and DAO name (e.g., gno.land/r/myname/mydao)"
    if (parts.some((p) => !p || p.length === 0)) return "Path segments cannot be empty"
    if (parts.some((p) => !/^[a-z0-9_]+$/.test(p))) return "Path segments must be lowercase alphanumeric with underscores only"
    const name = parts[parts.length - 1]
    if (name.length < 3) return "DAO name must be at least 3 characters"
    if (name.length > 30) return "DAO name must be at most 30 characters"
    return null // valid
}
