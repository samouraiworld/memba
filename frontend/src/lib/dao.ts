/**
 * DAO helpers for gno.land basedao realms.
 *
 * - ABCI query helpers (members, proposals, config)
 * - MsgCall builders for Vote, Execute, Propose
 * - Markdown parsers for basedao Render output
 *
 * See: gno.land/p/samcrew/basedao, gno.land/p/samcrew/daokit
 */

import type { AminoMsg } from "./grc20"

// ── Types ─────────────────────────────────────────────────────

export interface DAOMember {
    address: string
    roles: string[]
}

export interface DAOProposal {
    id: number
    title: string
    description: string
    status: "open" | "passed" | "rejected" | "executed"
    yesVotes: number
    noVotes: number
    abstainVotes: number
    totalVoters: number
    proposer: string
}

export interface DAOConfig {
    name: string
    description: string
    threshold: string
    memberCount: number
}

// ── ABCI Query Helpers ────────────────────────────────────────

/**
 * Fetch DAO overview via Render("").
 * Returns parsed config (name, description) from the markdown homepage.
 */
export async function getDAOConfig(
    rpcUrl: string,
    realmPath: string,
): Promise<DAOConfig | null> {
    const data = await queryRender(rpcUrl, realmPath, "")
    if (!data) return null

    // basedao Render("") output format:
    // # DAO Name
    // Description text
    // ## Members (N)
    // ## Proposals
    const nameMatch = data.match(/^#\s+(.+)$/m)
    const descMatch = data.match(/^#\s+.+\n+(.+?)(?:\n\n|\n##)/s)
    const membersMatch = data.match(/##\s+Members\s*\((\d+)\)/)
    const thresholdMatch = data.match(/(?:Threshold|Quorum)[:\s]+(\S+)/i)

    return {
        name: nameMatch?.[1]?.trim() || "Unnamed DAO",
        description: descMatch?.[1]?.trim() || "",
        threshold: thresholdMatch?.[1] || "60%",
        memberCount: membersMatch ? parseInt(membersMatch[1], 10) : 0,
    }
}

/**
 * Fetch DAO members via vm/qeval GetMembersJSON().
 * Falls back to Render("") markdown parsing if JSON endpoint is unavailable.
 */
export async function getDAOMembers(
    rpcUrl: string,
    realmPath: string,
): Promise<DAOMember[]> {
    // Try JSON endpoint first
    const json = await queryEval(rpcUrl, realmPath, `GetMembersJSON()`)
    if (json) {
        try {
            // qeval returns: '("json_string" string)\n'
            const match = json.match(/\("(.+)"\s+string\)/s)
            if (match) {
                const parsed = JSON.parse(match[1].replace(/\\"/g, '"'))
                if (Array.isArray(parsed)) {
                    return parsed.map((m: { address?: string; Address?: string; roles?: string[]; Roles?: string[] }) => ({
                        address: m.address || m.Address || "",
                        roles: m.roles || m.Roles || [],
                    }))
                }
            }
        } catch { /* fall through to markdown parsing */ }
    }

    // Fallback: parse Render("") markdown
    const data = await queryRender(rpcUrl, realmPath, "")
    if (!data) return []

    const members: DAOMember[] = []
    // Parse markdown member list: "- g1address (admin, dev)"
    const re = /[-*]\s+(g\S+)(?:\s*\(([^)]+)\))?/g
    let match
    while ((match = re.exec(data)) !== null) {
        members.push({
            address: match[1],
            roles: match[2] ? match[2].split(",").map((r) => r.trim()) : [],
        })
    }

    return members
}

/**
 * Fetch DAO proposals via vm/qeval GetProposalsJSON().
 * Falls back to Render("") markdown parsing if JSON endpoint is unavailable.
 */
export async function getDAOProposals(
    rpcUrl: string,
    realmPath: string,
): Promise<DAOProposal[]> {
    // Try JSON endpoint first
    const json = await queryEval(rpcUrl, realmPath, `GetProposalsJSON()`)
    if (json) {
        try {
            const match = json.match(/\("(.+)"\s+string\)/s)
            if (match) {
                const parsed = JSON.parse(match[1].replace(/\\"/g, '"'))
                if (Array.isArray(parsed)) {
                    return parsed.map((p: Record<string, unknown>) => ({
                        id: Number(p.id || p.ID || 0),
                        title: String(p.title || p.Title || ""),
                        description: String(p.description || p.Description || ""),
                        status: normalizeStatus(String(p.status || p.Status || "open")),
                        yesVotes: Number(p.yes_votes || p.YesVotes || p.yesCount || 0),
                        noVotes: Number(p.no_votes || p.NoVotes || p.noCount || 0),
                        abstainVotes: Number(p.abstain_votes || p.AbstainVotes || p.abstainCount || 0),
                        totalVoters: Number(p.total_voters || p.TotalVoters || 0),
                        proposer: String(p.proposer || p.Proposer || ""),
                    }))
                }
            }
        } catch { /* fall through to markdown parsing */ }
    }

    // Fallback: parse Render("") markdown
    const data = await queryRender(rpcUrl, realmPath, "")
    if (!data) return []

    const proposals: DAOProposal[] = []
    // Parse markdown proposal list:
    // ### Proposal #1: Title
    // Status: Open | Yes: 3 | No: 0
    const re = /###\s+Proposal\s+#(\d+)[:\s]+(.+?)\n(?:.*?Status:\s*(\w+))?/gs
    let m
    while ((m = re.exec(data)) !== null) {
        proposals.push({
            id: parseInt(m[1], 10),
            title: m[2].trim(),
            description: "",
            status: normalizeStatus(m[3] || "open"),
            yesVotes: 0,
            noVotes: 0,
            abstainVotes: 0,
            totalVoters: 0,
            proposer: "",
        })
    }

    return proposals
}

/**
 * Fetch single proposal detail via Render("proposal/{id}").
 */
export async function getProposalDetail(
    rpcUrl: string,
    realmPath: string,
    id: number,
): Promise<DAOProposal | null> {
    const data = await queryRender(rpcUrl, realmPath, `proposal/${id}`)
    if (!data) return null

    // Parse proposal markdown detail:
    // # Proposal #1: Title
    // Description text
    // **Status**: Passed
    // **Yes**: 4 | **No**: 1 | **Abstain**: 0
    // **Proposer**: g1...
    const titleMatch = data.match(/^#\s+(?:Proposal\s+#\d+[:\s]+)?(.+)$/m)
    const statusMatch = data.match(/\*\*Status\*\*[:\s]+(\w+)/i)
    const yesMatch = data.match(/\*\*Yes\*\*[:\s]+(\d+)/i)
    const noMatch = data.match(/\*\*No\*\*[:\s]+(\d+)/i)
    const abstainMatch = data.match(/\*\*Abstain\*\*[:\s]+(\d+)/i)
    const proposerMatch = data.match(/\*\*Proposer\*\*[:\s]+(g\S+)/i)

    // Extract description (text between title and first ** field)
    const descMatch = data.match(/^#\s+.+?\n\n([\s\S]+?)(?:\n\*\*|\n##)/m)

    return {
        id,
        title: titleMatch?.[1]?.trim() || `Proposal #${id}`,
        description: descMatch?.[1]?.trim() || "",
        status: normalizeStatus(statusMatch?.[1] || "open"),
        yesVotes: yesMatch ? parseInt(yesMatch[1], 10) : 0,
        noVotes: noMatch ? parseInt(noMatch[1], 10) : 0,
        abstainVotes: abstainMatch ? parseInt(abstainMatch[1], 10) : 0,
        totalVoters: 0,
        proposer: proposerMatch?.[1] || "",
    }
}

// ── MsgCall Builders ──────────────────────────────────────────

/** Build MsgCall for DAO.Vote(proposalID, vote). vote = "YES"|"NO"|"ABSTAIN" */
export function buildVoteMsg(
    caller: string,
    realmPath: string,
    proposalId: number,
    vote: "YES" | "NO" | "ABSTAIN",
): AminoMsg {
    return buildDAOMsgCall(realmPath, "Vote", [String(proposalId), vote], caller)
}

/** Build MsgCall for DAO.Execute(proposalID). */
export function buildExecuteMsg(
    caller: string,
    realmPath: string,
    proposalId: number,
): AminoMsg {
    return buildDAOMsgCall(realmPath, "Execute", [String(proposalId)], caller)
}

/** Build MsgCall for DAO.Propose(title, description). */
export function buildProposeMsg(
    caller: string,
    realmPath: string,
    title: string,
    description: string,
): AminoMsg {
    return buildDAOMsgCall(realmPath, "Propose", [title, description], caller)
}

// ── Internal Helpers ──────────────────────────────────────────

/** Build Amino MsgCall for a DAO realm function. */
function buildDAOMsgCall(realmPath: string, func: string, args: string[], caller: string): AminoMsg {
    return {
        type: "vm/MsgCall",
        value: {
            caller,
            send: "",
            pkg_path: realmPath,
            func,
            args,
        },
    }
}

/** Normalize status string from various basedao formats. */
function normalizeStatus(s: string): DAOProposal["status"] {
    const lower = s.toLowerCase()
    if (lower.includes("pass")) return "passed"
    if (lower.includes("reject") || lower.includes("fail")) return "rejected"
    if (lower.includes("exec") || lower.includes("complete")) return "executed"
    return "open"
}

/**
 * Query vm/qrender for a realm's Render(path) output.
 * Data format: "pkgpath:renderpath" (colon separator).
 * Response: ResponseBase.Data (base64).
 */
async function queryRender(rpcUrl: string, pkgPath: string, renderPath: string): Promise<string | null> {
    return abciQuery(rpcUrl, "vm/qrender", `${pkgPath}:${sanitize(renderPath)}`)
}

/**
 * Query vm/qeval for evaluating an expression in a realm.
 * Data format: "pkgpath.Expression()" (dot after last path segment).
 * Response: ResponseBase.Data (base64).
 */
async function queryEval(rpcUrl: string, pkgPath: string, expr: string): Promise<string | null> {
    return abciQuery(rpcUrl, "vm/qeval", `${pkgPath}.${expr}`)
}

/** Sanitize render path to prevent ABCI query injection. */
function sanitize(str: string): string {
    return str.replace(/[^a-zA-Z0-9_./:-]/g, "")
}

/** Low-level ABCI query via JSON-RPC POST. Returns decoded string or null. */
async function abciQuery(rpcUrl: string, path: string, data: string): Promise<string | null> {
    try {
        const b64Data = btoa(data)
        const res = await fetch(rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: "memba-dao",
                method: "abci_query",
                params: { path, data: b64Data },
            }),
        })
        const json = await res.json()
        const value = json?.result?.response?.ResponseBase?.Data
        if (!value) return null
        return atob(value)
    } catch {
        return null
    }
}
