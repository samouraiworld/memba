/**
 * DAO Template Generator — generates Gno realm code for deploying a new DAO.
 *
 * Creates a self-contained governance realm with:
 * - Member management (address + voting power)
 * - Proposal creation with title + description
 * - Voting (YES / NO / ABSTAIN)
 * - Execution of passed proposals
 * - Configurable voting threshold (percentage)
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
    /** Initial members with voting power. */
    members: { address: string; power: number }[]
    /** Voting threshold percentage (51 = simple majority). */
    threshold: number
}

// ── Code Generator ────────────────────────────────────────────

/**
 * Generate Gno realm source code from a DAO configuration.
 * Returns a self-contained .gno file as a string.
 */
export function generateDAOCode(config: DAOCreationConfig): string {
    const pkgName = config.realmPath.split("/").pop() || "mydao"

    const memberInit = config.members
        .map((m) => `\tmembers = append(members, Member{Address: std.Address("${m.address}"), Power: ${m.power}})`)
        .join("\n")

    return `package ${pkgName}

import (
\t"std"
\t"strings"
\t"strconv"
)

// ── Types ─────────────────────────────────────────────────

type Member struct {
\tAddress std.Address
\tPower   int
}

type Vote struct {
\tVoter std.Address
\tValue string // "YES", "NO", "ABSTAIN"
}

type Proposal struct {
\tID          int
\tTitle       string
\tDescription string
\tAuthor      std.Address
\tStatus      string // "ACTIVE", "ACCEPTED", "REJECTED", "EXECUTED"
\tVotes       []Vote
\tYesVotes    int
\tNoVotes     int
\tAbstain     int
\tTotalPower  int
}

// ── State ─────────────────────────────────────────────────

var (
\tname        = ${JSON.stringify(config.name)}
\tdescription = ${JSON.stringify(config.description)}
\tthreshold   = ${config.threshold} // percentage required to pass
\tmembers     []Member
\tproposals   []Proposal
\tnextID      = 0
)

func init() {
${memberInit}
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
\tout += "## Members (" + strconv.Itoa(len(members)) + ")\\n"
\tfor _, m := range members {
\t\tout += "- " + string(m.Address) + " (power: " + strconv.Itoa(m.Power) + ")\\n"
\t}
\tout += "\\n## Proposals\\n"
\tfor i := len(proposals) - 1; i >= 0; i-- {
\t\tp := proposals[i]
\t\tout += "### [Prop #" + strconv.Itoa(p.ID) + " - " + p.Title + "](:" + strconv.Itoa(p.ID) + ")\\n"
\t\tout += "Author: " + string(p.Author) + "\\n\\n"
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
\tout += "Status: " + p.Status + "\\n\\n"
\tout += "YES: " + strconv.Itoa(p.YesVotes) + " — NO: " + strconv.Itoa(p.NoVotes) + " — ABSTAIN: " + strconv.Itoa(p.Abstain) + "\\n"
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

func Propose(title, desc string) int {
\tcaller := std.OrigCaller()
\tassertMember(caller)
\tid := nextID
\tnextID++
\tproposals = append(proposals, Proposal{
\t\tID:          id,
\t\tTitle:       title,
\t\tDescription: desc,
\t\tAuthor:      caller,
\t\tStatus:      "ACTIVE",
\t})
\treturn id
}

func VoteOnProposal(id int, vote string) {
\tcaller := std.OrigCaller()
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
\t// Check if threshold reached
\ttpow := totalPower()
\tif tpow > 0 && p.YesVotes * 100 / tpow >= threshold {
\t\tp.Status = "ACCEPTED"
\t}
\tif tpow > 0 && p.NoVotes * 100 / tpow > (100 - threshold) {
\t\tp.Status = "REJECTED"
\t}
}

func ExecuteProposal(id int) {
\tcaller := std.OrigCaller()
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

// ── Helpers ───────────────────────────────────────────────

func assertMember(addr std.Address) {
\tfor _, m := range members {
\t\tif m.Address == addr {
\t\t\treturn
\t\t}
\t}
\tpanic("not a member")
}

func getMemberPower(addr std.Address) int {
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
    return {
        type: "/vm.m_addpkg",
        value: {
            creator: callerAddress,
            package: {
                name: pkgName,
                path: realmPath,
                files: [
                    {
                        name: "gnomod.toml",
                        body: `module = "${realmPath}"\n`,
                    },
                    {
                        name: `${pkgName}.gno`,
                        body: code,
                    },
                ],
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
