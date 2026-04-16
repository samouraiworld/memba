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
import { isValidGnoAddress, isValidIdentifier } from "./templates/sanitizer"
import { buildDeployMsg } from "./templates/prologue"
export { validateRealmPath } from "./templates/sanitizer"

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
    /** Voting period in blocks (0 = no expiration). ~2s/block on Gno. Default: 151200 (~3.5 days). */
    votingPeriodBlocks: number
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
    votingPeriodBlocks: number
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
        votingPeriodBlocks: 151200, // ~3.5 days at 2s/block
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
        votingPeriodBlocks: 151200, // ~3.5 days
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
        votingPeriodBlocks: 302400, // ~7 days (longer for treasury decisions)
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
        votingPeriodBlocks: 302400, // ~7 days
    },
]

// Re-export for backward compatibility
export { isValidGnoAddress } from "./templates/sanitizer"

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

    const safeCategories = config.proposalCategories.filter(isValidIdentifier)
    const categoriesInit = safeCategories
        .map((c) => `\tallowedCategories = append(allowedCategories, "${c}")`)
        .join("\n")

    const safeRoles = config.roles.filter(isValidIdentifier)
    const rolesInit = safeRoles
        .map((r) => `\tallowedRoles = append(allowedRoles, "${r}")`)
        .join("\n")

    // v6 GNO-01: members and proposals use AVL trees instead of slices.
    // This gives O(log n) lookups instead of O(n), preventing gas DoS at scale.
    const memberInitAVL = validMembers
        .map((m) => {
            const safeRoles = m.roles.filter(isValidIdentifier)
            const rolesStr = safeRoles.map((r) => `"${r}"`).join(", ")
            return `\tmembers.Set("${m.address}", &Member{Address: address("${m.address}"), Power: ${Math.max(0, Math.floor(m.power))}, Roles: []string{${rolesStr}}})`
        })
        .join("\n")

    return `package ${pkgName}

import (
\t"chain/runtime"
\t"strings"
\t"strconv"

\t"gno.land/p/nt/avl/v0"
\t"gno.land/p/nt/ufmt/v0"
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
\tStatus      string // "ACTIVE", "ACCEPTED", "REJECTED", "EXECUTED", "EXPIRED"
\tVotes       *avl.Tree // voter address → *Vote (prevents O(n) dedup scan)
\tYesVotes    int
\tNoVotes     int
\tAbstain     int
\tTotalPower  int
\tActionType  string // "none", "add_member", "remove_member", "assign_role"
\tActionData  string // serialized action params (e.g. "addr|power|role1,role2")
\tCreatedAt   int64  // block height when proposed
\tExpiresAt   int64  // block height when voting closes (0 = never)
}

// ── State ─────────────────────────────────────────────────

var (
\tname              = ${JSON.stringify(config.name)}
\tdescription       = ${JSON.stringify(config.description)}
\tthreshold         = ${config.threshold} // percentage required to pass
\tquorum            = ${config.quorum}  // minimum participation % (0 = disabled)
\tvotingPeriod      = int64(${config.votingPeriodBlocks || 151200}) // blocks until proposal expires (0 = never)
\tmembers           = avl.NewTree() // address → *Member (O(log n) lookup)
\tproposals         = avl.NewTree() // zero-padded ID → *Proposal (ordered iteration)
\tnextID            = 0
\tallowedCategories []string
\tallowedRoles      []string
\tarchived          = false
)

// padID returns a zero-padded proposal ID key for ordered AVL iteration.
func padID(id int) string {
\treturn ufmt.Sprintf("%010d", id)
}

func init() {
${memberInitAVL}
${categoriesInit}
${rolesInit}
}

// ── Queries ───────────────────────────────────────────────

func getProposal(id int) *Proposal {
\tval, exists := proposals.Get(padID(id))
\tif !exists {
\t\treturn nil
\t}
\treturn val.(*Proposal)
}

const renderPageSize = 20

func Render(path string) string {
\tif path == "" {
\t\treturn renderHome(0)
\t}
\t// Pagination: "page:N"
\tif strings.HasPrefix(path, "page:") {
\t\tpage, err := strconv.Atoi(strings.TrimPrefix(path, "page:"))
\t\tif err == nil && page >= 0 {
\t\t\treturn renderHome(page)
\t\t}
\t}
\t// Parse proposal ID from path
\tparts := strings.Split(path, "/")
\tif len(parts) >= 1 {
\t\tid, err := strconv.Atoi(parts[0])
\t\tif err == nil {
\t\t\tp := getProposal(id)
\t\t\tif p != nil {
\t\t\t\tif len(parts) >= 2 && parts[1] == "votes" {
\t\t\t\t\treturn renderVotes(p)
\t\t\t\t}
\t\t\t\treturn renderProposal(p)
\t\t\t}
\t\t}
\t}
\treturn "# Not Found"
}

func renderHome(page int) string {
\tout := "# " + name + "\\n"
\tout += description + "\\n\\n"
\tout += "Threshold: " + strconv.Itoa(threshold) + "% | Quorum: " + strconv.Itoa(quorum) + "%\\n\\n"
\tout += "## Members (" + strconv.Itoa(members.Size()) + ")\\n"
\tmembers.Iterate("", "", func(key string, value interface{}) bool {
\t\tm := value.(*Member)
\t\tout += "- " + string(m.Address) + " (roles: " + strings.Join(m.Roles, ", ") + ") | power: " + strconv.Itoa(m.Power) + "\\n"
\t\treturn false
\t})
\tout += "\\n## Proposals\\n"
\t// Paginated reverse iterate (newest first)
\tskip := page * renderPageSize
\tshown := 0
\tskipped := 0
\tproposals.ReverseIterate("", "", func(key string, value interface{}) bool {
\t\tif skipped < skip {
\t\t\tskipped++
\t\t\treturn false
\t\t}
\t\tif shown >= renderPageSize {
\t\t\treturn true // stop
\t\t}
\t\tp := value.(*Proposal)
\t\tout += "### [Prop #" + strconv.Itoa(p.ID) + " - " + p.Title + "](:" + strconv.Itoa(p.ID) + ")\\n"
\t\tout += "Author: " + string(p.Author) + "\\n\\n"
\t\tout += "Category: " + p.Category + "\\n\\n"
\t\tout += "Status: " + p.Status + "\\n\\n---\\n\\n"
\t\tshown++
\t\treturn false
\t})
\tif proposals.Size() == 0 {
\t\tout += "No proposals yet.\\n"
\t}
\t// Pagination footer
\ttotalPages := (proposals.Size() + renderPageSize - 1) / renderPageSize
\tif totalPages > 1 {
\t\tout += "\\n---\\nPage " + strconv.Itoa(page+1) + "/" + strconv.Itoa(totalPages) + "\\n"
\t}
\treturn out
}

func renderProposal(p *Proposal) string {
\tout := "# Prop #" + strconv.Itoa(p.ID) + " - " + p.Title + "\\n"
\tout += p.Description + "\\n\\n"
\tout += "Author: " + string(p.Author) + "\\n\\n"
\tout += "Category: " + p.Category + "\\n\\n"
\tout += "Status: " + p.Status + "\\n\\n"
\tout += "YES: " + strconv.Itoa(p.YesVotes) + " | NO: " + strconv.Itoa(p.NoVotes) + " | ABSTAIN: " + strconv.Itoa(p.Abstain) + "\\n"
\tout += "Total Power: " + strconv.Itoa(p.TotalPower) + "/" + strconv.Itoa(totalPower()) + "\\n"
\tif p.ExpiresAt > 0 {
\t\tout += "Voting closes at block: " + strconv.FormatInt(p.ExpiresAt, 10) + "\\n"
\t\tif runtime.ChainHeight() > p.ExpiresAt && p.Status == "ACTIVE" {
\t\t\tout += "**EXPIRED** — voting period has ended.\\n"
\t\t}
\t}
\treturn out
}

func renderVotes(p *Proposal) string {
\tout := "# Proposal #" + strconv.Itoa(p.ID) + " - Vote List\\n\\n"
\tout += "YES:\\n"
\tp.Votes.Iterate("", "", func(key string, value interface{}) bool {
\t\tv := value.(*Vote)
\t\tif v.Value == "YES" {
\t\t\tout += "- " + string(v.Voter) + "\\n"
\t\t}
\t\treturn false
\t})
\tout += "\\nNO:\\n"
\tp.Votes.Iterate("", "", func(key string, value interface{}) bool {
\t\tv := value.(*Vote)
\t\tif v.Value == "NO" {
\t\t\tout += "- " + string(v.Voter) + "\\n"
\t\t}
\t\treturn false
\t})
\tout += "\\nABSTAIN:\\n"
\tp.Votes.Iterate("", "", func(key string, value interface{}) bool {
\t\tv := value.(*Vote)
\t\tif v.Value == "ABSTAIN" {
\t\t\tout += "- " + string(v.Voter) + "\\n"
\t\t}
\t\treturn false
\t})
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
\tnow := runtime.ChainHeight()
\texpires := int64(0)
\tif votingPeriod > 0 {
\t\texpires = now + votingPeriod
\t}
\tproposals.Set(padID(id), &Proposal{
\t\tID:          id,
\t\tTitle:       title,
\t\tDescription: desc,
\t\tCategory:    category,
\t\tAuthor:      caller,
\t\tStatus:      "ACTIVE",
\t\tVotes:       avl.NewTree(),
\t\tActionType:  "none",
\t\tCreatedAt:   now,
\t\tExpiresAt:   expires,
\t})
\treturn id
}

func VoteOnProposal(cur realm, id int, vote string) {
\tcaller := runtime.PreviousRealm().Address()
\tassertNotArchived()
\tassertMember(caller)
\tp := getProposal(id)
\tif p == nil {
\t\tpanic("invalid proposal ID")
\t}
\t// Check expiration first
\tif p.ExpiresAt > 0 && runtime.ChainHeight() > p.ExpiresAt {
\t\tp.Status = "EXPIRED"
\t\tpanic("proposal has expired (voting period ended at block " + strconv.FormatInt(p.ExpiresAt, 10) + ")")
\t}
\tif p.Status != "ACTIVE" {
\t\tpanic("proposal is not active")
\t}
\t// Check for duplicate votes — O(log n) AVL lookup instead of O(n) scan
\tvoterKey := string(caller)
\tif _, exists := p.Votes.Get(voterKey); exists {
\t\tpanic("already voted")
\t}
\tpower := getMemberPower(caller)
\tp.Votes.Set(voterKey, &Vote{Voter: caller, Value: vote})
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
\tp := getProposal(id)
\tif p == nil {
\t\tpanic("invalid proposal ID")
\t}
\tif p.Status != "ACCEPTED" {
\t\tpanic("proposal must be ACCEPTED to execute")
\t}
\t// Dispatch action
\tswitch p.ActionType {
\tcase "add_member":
\t\texecuteAddMember(p.ActionData)
\tcase "remove_member":
\t\texecuteRemoveMember(p.ActionData)
\tcase "assign_role":
\t\texecuteAssignRole(p.ActionData)
\tcase "none":
\t\t// Text-only proposal — no action
\tdefault:
\t\tpanic("unknown action type: " + p.ActionType)
\t}
\tp.Status = "EXECUTED"
}

// ── Member Proposals (governance-gated) ───────────────────

func newProposal(caller address, title, desc, category, actionType, actionData string) int {
\tid := nextID
\tnextID++
\tnow := runtime.ChainHeight()
\texp := int64(0)
\tif votingPeriod > 0 { exp = now + votingPeriod }
\tproposals.Set(padID(id), &Proposal{
\t\tID:          id,
\t\tTitle:       title,
\t\tDescription: desc,
\t\tCategory:    category,
\t\tAuthor:      caller,
\t\tStatus:      "ACTIVE",
\t\tVotes:       avl.NewTree(),
\t\tActionType:  actionType,
\t\tActionData:  actionData,
\t\tCreatedAt:   now,
\t\tExpiresAt:   exp,
\t})
\treturn id
}

func ProposeAddMember(cur realm, targetAddr address, power int, roles string) int {
\tcaller := runtime.PreviousRealm().Address()
\tassertNotArchived()
\tassertMember(caller)
\tif _, exists := members.Get(string(targetAddr)); exists {
\t\tpanic("address is already a member")
\t}
\ttitle := "Add member " + string(targetAddr)[:10] + "... with power " + strconv.Itoa(power)
\tdesc := "**Action**: Add Member\\n**Address**: " + string(targetAddr) + "\\n**Power**: " + strconv.Itoa(power) + "\\n**Roles**: " + roles
\tdata := string(targetAddr) + "|" + strconv.Itoa(power) + "|" + roles
\treturn newProposal(caller, title, desc, "membership", "add_member", data)
}

func ProposeRemoveMember(cur realm, targetAddr address) int {
\tcaller := runtime.PreviousRealm().Address()
\tassertNotArchived()
\tassertMember(caller)
\tassertMember(targetAddr)
\ttitle := "Remove member " + string(targetAddr)[:10] + "..."
\tdesc := "**Action**: Remove Member\\n**Address**: " + string(targetAddr)
\treturn newProposal(caller, title, desc, "membership", "remove_member", string(targetAddr))
}

func ProposeAssignRole(cur realm, targetAddr address, role string) int {
\tcaller := runtime.PreviousRealm().Address()
\tassertNotArchived()
\tassertMember(caller)
\tassertMember(targetAddr)
\tassertRole(role)
\ttitle := "Assign role " + strconv.Quote(role) + " to " + string(targetAddr)[:10] + "..."
\tdesc := "**Action**: Assign Role\\n**Address**: " + string(targetAddr) + "\\n**Role**: " + role
\treturn newProposal(caller, title, desc, "membership", "assign_role", string(targetAddr) + "|" + role)
}

// ── Action Executors (internal) ───────────────────────────

func executeAddMember(data string) {
\tparts := strings.Split(data, "|")
\tif len(parts) != 3 {
\t\tpanic("invalid add_member action data")
\t}
\taddr := address(parts[0])
\tpower, err := strconv.Atoi(parts[1])
\tif err != nil {
\t\tpanic("invalid power in action data")
\t}
\troles := strings.Split(parts[2], ",")
\tif _, exists := members.Get(string(addr)); exists {
\t\tpanic("address is already a member")
\t}
\tmembers.Set(string(addr), &Member{Address: addr, Power: power, Roles: roles})
}

func executeRemoveMember(data string) {
\taddr := address(data)
\tif hasRole(addr, "admin") {
\t\tadminCount := 0
\t\tmembers.Iterate("", "", func(key string, value interface{}) bool {
\t\t\tm := value.(*Member)
\t\t\tif hasRoleInternal(m, "admin") {
\t\t\t\tadminCount++
\t\t\t}
\t\t\treturn false
\t\t})
\t\tif adminCount <= 1 {
\t\t\tpanic("cannot remove the last admin")
\t\t}
\t}
\tif _, exists := members.Get(string(addr)); !exists {
\t\tpanic("member not found")
\t}
\tmembers.Remove(string(addr))
}

func executeAssignRole(data string) {
\tparts := strings.Split(data, "|")
\tif len(parts) != 2 {
\t\tpanic("invalid assign_role action data")
\t}
\taddr := address(parts[0])
\trole := parts[1]
\tassertRole(role)
\tval, exists := members.Get(string(addr))
\tif !exists {
\t\tpanic("member not found")
\t}
\tm := val.(*Member)
\tfor _, r := range m.Roles {
\t\tif r == role {
\t\t\tpanic("role already assigned")
\t\t}
\t}
\tm.Roles = append(m.Roles, role)
}

// ── Role Management (admin-only) ──────────────────────────

func AssignRole(cur realm, target address, role string) {
\tcaller := runtime.PreviousRealm().Address()
\tassertAdmin(caller)
\tassertRole(role)
\tval, exists := members.Get(string(target))
\tif !exists {
\t\tpanic("target is not a member")
\t}
\tm := val.(*Member)
\tfor _, r := range m.Roles {
\t\tif r == role {
\t\t\tpanic("role already assigned")
\t\t}
\t}
\tm.Roles = append(m.Roles, role)
}

func RemoveRole(cur realm, target address, role string) {
\tcaller := runtime.PreviousRealm().Address()
\tassertAdmin(caller)
\tif role == "admin" {
\t\tadminCount := 0
\t\tmembers.Iterate("", "", func(key string, value interface{}) bool {
\t\t\tm := value.(*Member)
\t\t\tif hasRoleInternal(m, "admin") {
\t\t\t\tadminCount++
\t\t\t}
\t\t\treturn false
\t\t})
\t\tif adminCount <= 1 {
\t\t\tpanic("cannot remove the last admin")
\t\t}
\t}
\tval, exists := members.Get(string(target))
\tif !exists {
\t\tpanic("target is not a member")
\t}
\tm := val.(*Member)
\tnewRoles := []string{}
\tfor _, r := range m.Roles {
\t\tif r != role {
\t\t\tnewRoles = append(newRoles, r)
\t\t}
\t}
\tm.Roles = newRoles
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
\tif _, exists := members.Get(string(addr)); !exists {
\t\tpanic("not a member")
\t}
}

func assertAdmin(addr address) {
\tval, exists := members.Get(string(addr))
\tif !exists {
\t\tpanic("admin role required")
\t}
\tm := val.(*Member)
\tif !hasRoleInternal(m, "admin") {
\t\tpanic("admin role required")
\t}
}

func hasRole(addr address, role string) bool {
\tval, exists := members.Get(string(addr))
\tif !exists {
\t\treturn false
\t}
\treturn hasRoleInternal(val.(*Member), role)
}

func hasRoleInternal(m *Member, role string) bool {
\tfor _, r := range m.Roles {
\t\tif r == role {
\t\t\treturn true
\t\t}
\t}
\treturn false
}

func getMemberPower(addr address) int {
\tval, exists := members.Get(string(addr))
\tif !exists {
\t\treturn 0
\t}
\treturn val.(*Member).Power
}

func totalPower() int {
\ttotal := 0
\tmembers.Iterate("", "", func(key string, value interface{}) bool {
\t\ttotal += value.(*Member).Power
\t\treturn false
\t})
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
 * @deprecated Use `buildDeployMsg` from `templates/prologue` directly.
 */
export function buildDeployDAOMsg(
    callerAddress: string,
    realmPath: string,
    code: string,
    deposit: string = "",
): AminoMsg {
    return buildDeployMsg(callerAddress, realmPath, code, deposit) as AminoMsg
}

// validateRealmPath is now re-exported from templates/sanitizer at the top of this file.
