/**
 * DAO helpers for gno.land governance realms (GovDAO v3 + basedao).
 *
 * - ABCI query helpers (members, proposals, config, votes, memberstore)
 * - MsgCall builders for Vote, Execute, Propose
 * - Markdown parsers for both GovDAO v3 and basedao Render output
 *
 * See: gno.land/r/gov/dao, gno.land/p/samcrew/basedao
 */

import type { AminoMsg } from "./grc20"

// ── Types ─────────────────────────────────────────────────────

export interface DAOMember {
    address: string
    roles: string[]
    tier: string               // "T1" | "T2" | "T3" | ""
    votingPower: number        // VPPM value (0 if unknown)
    username: string           // @username from profile (empty if unknown)
}

export interface DAOProposal {
    id: number
    title: string
    description: string
    status: "open" | "passed" | "rejected" | "executed"
    author: string             // @username or address
    authorProfile: string      // profile URL (empty if unknown)
    tiers: string[]            // ["T1","T2","T3"] eligible tiers
    yesPercent: number         // 0-100
    noPercent: number          // 0-100
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
    memberstorePath: string    // memberstore realm path (empty if N/A)
    tierDistribution: TierInfo[]
}

export interface TierInfo {
    tier: string        // "T1", "T2", "T3"
    memberCount: number
    power: number
}

export interface VoteRecord {
    tier: string        // "T1" | "T2" | "T3"
    vppm: number        // voting power per member
    yesVoters: VoterEntry[]
    noVoters: VoterEntry[]
}

export interface VoterEntry {
    username: string
    profileUrl: string
}

// ── ABCI Query Helpers ────────────────────────────────────────

/**
 * Fetch DAO overview via Render("").
 * Supports GovDAO v3 and basedao formats.
 */
export async function getDAOConfig(
    rpcUrl: string,
    realmPath: string,
): Promise<DAOConfig | null> {
    const data = await queryRender(rpcUrl, realmPath, "")
    if (!data) return null

    // Try GovDAO v3 format first: "# GovDAO" + memberstore link
    const nameMatch = data.match(/^#\s+(.+)$/m)
    const thresholdMatch = data.match(/(?:Threshold|Quorum)[:\s]+(\S+)/i)
    const membersMatch = data.match(/##\s+Members\s*(?:\((\d+)\))?/)

    // Description: text between # title and ## section, excluding memberstore links
    let description = ""
    const descMatch = data.match(/^#\s+.+\n+([\s\S]*?)(?:\n##)/m)
    if (descMatch) {
        // Filter out memberstore link lines and empty lines
        const descLines = descMatch[1].split("\n")
            .filter((l) => !l.includes("Memberstore") && !l.includes("memberstore") && l.trim() !== "")
        description = descLines.join("\n").trim()
    }

    // GovDAO v3: extract memberstore link from various URL formats
    // Format: [> Go to Memberstore <](https://test11.testnets.gno.land/r/gov/dao/v3/memberstore)
    let memberstorePath = ""
    // Match any link containing "memberstore" — extract the /r/... path from the URL
    const msLinkMatch = data.match(/\[.*?[Mm]emberstore.*?\]\((?:https?:\/\/[^/]+)?\/(r\/[^)]+)\)/i)
    if (msLinkMatch) {
        const rawPath = msLinkMatch[1].replace(/[\s)]/g, "")
        memberstorePath = rawPath.startsWith("gno.land/") ? rawPath : `gno.land/${rawPath}`
    }

    // Fetch tier distribution if memberstore available
    let tierDistribution: TierInfo[] = []
    if (memberstorePath) {
        tierDistribution = await getMemberstoreTiers(rpcUrl, memberstorePath)
    }

    const totalMembers = tierDistribution.length > 0
        ? tierDistribution.reduce((sum, t) => sum + t.memberCount, 0)
        : (membersMatch?.[1] ? parseInt(membersMatch[1], 10) : 0)

    return {
        name: nameMatch?.[1]?.trim() || "Unnamed DAO",
        description,
        threshold: thresholdMatch?.[1] || "60%",
        memberCount: totalMembers,
        memberstorePath,
        tierDistribution,
    }
}

/**
 * Fetch memberstore tier distribution.
 * Parses: "Tier T1 contains 11 members with power: 33"
 */
export async function getMemberstoreTiers(
    rpcUrl: string,
    memberstorePath: string,
): Promise<TierInfo[]> {
    const data = await queryRender(rpcUrl, memberstorePath, "")
    if (!data) return []

    const tiers: TierInfo[] = []
    const re = /Tier\s+(T\d+)\s+contains\s+(\d+)\s+members?\s+with\s+power[:\s]+(\d+)/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(data)) !== null) {
        tiers.push({
            tier: m[1].toUpperCase(),
            memberCount: parseInt(m[2], 10),
            power: parseInt(m[3], 10),
        })
    }
    return tiers
}

/**
 * Fetch DAO members via memberstore or fallback to basedao parsing.
 * For memberstore: fetches all paginated pages with inline tier extraction.
 */
export async function getDAOMembers(
    rpcUrl: string,
    realmPath: string,
    memberstorePath?: string,
): Promise<DAOMember[]> {
    // Try memberstore members list first
    if (memberstorePath) {
        const allMembers = await fetchAllMemberstorePages(rpcUrl, memberstorePath)
        if (allMembers.length > 0) {
            await resolveUsernames(rpcUrl, allMembers)
            return allMembers
        }
    }

    // Try JSON endpoint (basedao)
    const json = await queryEval(rpcUrl, realmPath, `GetMembersJSON()`)
    if (json) {
        try {
            const match = json.match(/\("(.+)"\s+string\)/s)
            if (match) {
                const parsed = JSON.parse(match[1].replace(/\\"/g, '"'))
                if (Array.isArray(parsed)) {
                    return parsed.map((m: Record<string, unknown>) => ({
                        address: String(m.address || m.Address || ""),
                        roles: (m.roles || m.Roles || []) as string[],
                        tier: String(m.tier || m.Tier || ""),
                        votingPower: Number(m.votingPower || m.VotingPower || 0),
                        username: String(m.username || m.Username || ""),
                    }))
                }
            }
        } catch { /* fall through */ }
    }

    // Fallback: parse Render("") markdown
    const data = await queryRender(rpcUrl, realmPath, "")
    if (!data) return []

    const members: DAOMember[] = []
    const re = /[-*]\s+(g\S+)(?:\s*\(([^)]+)\))?/g
    let match: RegExpExecArray | null
    while ((match = re.exec(data)) !== null) {
        members.push({
            address: match[1],
            roles: match[2] ? match[2].split(",").map((r) => r.trim()) : [],
            tier: "",
            votingPower: 0,
            username: "",
        })
    }
    return members
}

/**
 * Fetch all pages of memberstore members.
 * GovDAO v3 ABCI returns markdown table rows:
 *   | ![T1 chip](base64...) T1 | g1address |
 * Paginates at ~14/page. Next page link: [2](?page=2)
 */
async function fetchAllMemberstorePages(
    rpcUrl: string,
    memberstorePath: string,
): Promise<DAOMember[]> {
    const allMembers: DAOMember[] = []
    const seen = new Set<string>()
    let page = 1
    const maxPages = 10 // safety limit
    const tierPowers: Record<string, number> = { T1: 3, T2: 2, T3: 1 }

    while (page <= maxPages) {
        const renderPath = page === 1 ? "members" : `members?page=${page}`
        const data = await queryRender(rpcUrl, memberstorePath, renderPath)
        if (!data) break

        // Extract tier + address from markdown table rows:
        // "... T1 | g1address |" or "... T2 | g1address |"
        const tierAddrRe = /(T\d+)\s*\|\s*(g1[a-z0-9]+)\s*\|/gi
        let m: RegExpExecArray | null
        let foundNew = false
        while ((m = tierAddrRe.exec(data)) !== null) {
            const addr = m[2]
            if (seen.has(addr)) continue
            seen.add(addr)
            foundNew = true
            const tier = m[1].toUpperCase()
            allMembers.push({
                address: addr,
                roles: [],
                tier,
                votingPower: tierPowers[tier] || 0,
                username: "",
            })
        }

        // Check if there's a next page link: [2](?page=2)
        const nextPageMatch = data.match(/\[\d+\]\(\??.*?page=(\d+)\)/)
        if (!nextPageMatch || !foundNew) break

        const nextPage = parseInt(nextPageMatch[1], 10)
        if (nextPage <= page) break
        page = nextPage
    }

    return allMembers
}

/** User registry realm path on gno.land. */
const USER_REGISTRY = "gno.land/r/gnoland/users/v1"

/** Username cache key in localStorage. */
const USERNAME_CACHE_KEY = "memba_usernames"

/** Cache TTL: 1 hour (in ms). */
const USERNAME_CACHE_TTL = 60 * 60 * 1000

interface UsernameCache {
    entries: Record<string, { username: string; ts: number }>
}

/** Read username cache from localStorage. */
function readUsernameCache(): UsernameCache {
    try {
        const raw = localStorage.getItem(USERNAME_CACHE_KEY)
        if (!raw) return { entries: {} }
        const parsed = JSON.parse(raw)
        if (typeof parsed === "object" && parsed.entries) return parsed as UsernameCache
    } catch { /* ignore corrupt cache */ }
    return { entries: {} }
}

/** Write username cache to localStorage. */
function writeUsernameCache(cache: UsernameCache): void {
    try {
        localStorage.setItem(USERNAME_CACHE_KEY, JSON.stringify(cache))
    } catch { /* quota exceeded */ }
}

/**
 * Resolve a single g1 address to @username via gno.land user registry.
 * Queries Render(address) which returns: "# User - `username`"
 * Returns "@username" or empty string if not registered.
 */
async function resolveUsername(rpcUrl: string, address: string): Promise<string> {
    try {
        const data = await queryRender(rpcUrl, USER_REGISTRY, address)
        if (!data) return ""
        // Parse: "# User - `username`"
        const m = data.match(/# User - `([^`]+)`/)
        return m ? `@${m[1]}` : ""
    } catch {
        return ""
    }
}

/**
 * Batch-resolve addresses to usernames for a list of members.
 * Uses localStorage cache with 1-hour TTL:
 * - Cache hit (fresh): use cached username instantly, no ABCI call
 * - Cache miss or stale: resolve via ABCI, update cache
 * Resolves cache misses in parallel for speed.
 */
async function resolveUsernames(rpcUrl: string, members: DAOMember[]): Promise<void> {
    const cache = readUsernameCache()
    const now = Date.now()
    const toResolve: number[] = [] // indices of members needing ABCI resolution

    // Phase 1: populate from cache, identify misses
    for (let i = 0; i < members.length; i++) {
        const entry = cache.entries[members[i].address]
        if (entry && (now - entry.ts) < USERNAME_CACHE_TTL) {
            // Cache hit — use cached username
            members[i].username = entry.username
        } else {
            toResolve.push(i)
        }
    }

    // Phase 2: resolve cache misses in parallel
    if (toResolve.length > 0) {
        const results = await Promise.all(
            toResolve.map((idx) => resolveUsername(rpcUrl, members[idx].address)),
        )
        results.forEach((username, j) => {
            const idx = toResolve[j]
            members[idx].username = username
            cache.entries[members[idx].address] = { username, ts: now }
        })
        writeUsernameCache(cache)
    }
}


/**
 * Fetch DAO proposals via Render("") markdown parsing.
 * Supports GovDAO v3 format with author, tiers, and basedao format.
 */
export async function getDAOProposals(
    rpcUrl: string,
    realmPath: string,
): Promise<DAOProposal[]> {
    // Try JSON endpoint first (basedao)
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
                        author: String(p.author || p.Author || p.proposer || p.Proposer || ""),
                        authorProfile: "",
                        tiers: (p.tiers || p.Tiers || []) as string[],
                        yesPercent: Number(p.yes_percent || p.YesPercent || 0),
                        noPercent: Number(p.no_percent || p.NoPercent || 0),
                        yesVotes: Number(p.yes_votes || p.YesVotes || p.yesCount || 0),
                        noVotes: Number(p.no_votes || p.NoVotes || p.noCount || 0),
                        abstainVotes: Number(p.abstain_votes || p.AbstainVotes || p.abstainCount || 0),
                        totalVoters: Number(p.total_voters || p.TotalVoters || 0),
                        proposer: String(p.proposer || p.Proposer || ""),
                    }))
                }
            }
        } catch { /* fall through */ }
    }

    // GovDAO v3 / basedao: parse Render("") markdown
    const data = await queryRender(rpcUrl, realmPath, "")
    if (!data) return []

    return parseProposalList(data)
}

/**
 * Parse proposal list from GovDAO v3 Render("") output.
 * Format:
 * ### [Prop #N - Title](link)
 * Author: [@username](profile)
 * Status: ACTIVE
 * Tiers eligible to vote: T1, T2, T3
 */
function parseProposalList(data: string): DAOProposal[] {
    const proposals: DAOProposal[] = []

    // Split by proposal headers
    const sections = data.split(/###\s+/)
    for (const section of sections) {
        // GovDAO v3 format: [Prop #N - Title](link)
        const propMatch = section.match(/\[Prop\s+#(\d+)\s*-\s*(.+?)\]/)
        if (!propMatch) {
            // basedao fallback: Proposal #N: Title
            const altMatch = section.match(/Proposal\s+#(\d+)[:\s]+(.+?)(?:\n|$)/)
            if (!altMatch) continue
            proposals.push({
                id: parseInt(altMatch[1], 10),
                title: altMatch[2].trim(),
                description: "",
                status: "open",
                author: "",
                authorProfile: "",
                tiers: [],
                yesPercent: 0,
                noPercent: 0,
                yesVotes: 0,
                noVotes: 0,
                abstainVotes: 0,
                totalVoters: 0,
                proposer: "",
            })
            continue
        }

        // Extract author: Author: [@username](url)
        const authorMatch = section.match(/Author:\s*\[@([^\]]+)\]\(([^)]+)\)/)
        // Status: ACTIVE | ACCEPTED | etc
        const statusMatch = section.match(/Status:\s*(\w+)/i)
        // Tiers eligible to vote: T1, T2, T3
        const tiersMatch = section.match(/Tiers?\s+eligible\s+to\s+vote:\s*([^\n]+)/i)

        proposals.push({
            id: parseInt(propMatch[1], 10),
            title: propMatch[2].trim(),
            description: "",
            status: normalizeStatus(statusMatch?.[1] || "open"),
            author: authorMatch ? `@${authorMatch[1]}` : "",
            authorProfile: authorMatch?.[2] || "",
            tiers: tiersMatch
                ? tiersMatch[1].split(",").map((t) => t.trim()).filter(Boolean)
                : [],
            yesPercent: 0,
            noPercent: 0,
            yesVotes: 0,
            noVotes: 0,
            abstainVotes: 0,
            totalVoters: 0,
            proposer: authorMatch ? `@${authorMatch[1]}` : "",
        })
    }

    return proposals
}

/**
 * Fetch single proposal detail via Render(":N") (colon prefix for GovDAO).
 * Tries both GovDAO v3 (:N) and basedao (proposal/N) formats.
 */
export async function getProposalDetail(
    rpcUrl: string,
    realmPath: string,
    id: number,
): Promise<DAOProposal | null> {
    // GovDAO v3 uses ":N" render path
    let data = await queryRender(rpcUrl, realmPath, String(id))
    if (!data) {
        // basedao uses "proposal/N"
        data = await queryRender(rpcUrl, realmPath, `proposal/${id}`)
    }
    if (!data) return null

    // Parse title
    const titleMatch = data.match(/(?:Prop\s+#\d+\s*-\s*|Proposal\s+#\d+[:\s]+)(.+?)(?:\n|$)/m)
        || data.match(/^#.*?#\d+\s*-\s*(.+?)$/m)
        || data.match(/^##?\s+(?:Prop(?:osal)?\s+#\d+\s*-?\s*)?(.+)$/m)

    // Author
    const authorMatch = data.match(/Author:\s*\[@([^\]]+)\]\(([^)]+)\)/)

    // Status  
    const statusMatch = data.match(/(?:PROPOSAL HAS BEEN\s+)?(\w+ED|ACTIVE)/i)
        || data.match(/Status:\s*(\w+)/i)

    // Vote percentages
    const yesPercentMatch = data.match(/YES\s+PERCENT:\s*(\d+)%/i)
    const noPercentMatch = data.match(/NO\s+PERCENT:\s*(\d+)%/i)

    // Tiers eligible to vote
    const tiersMatch = data.match(/Tiers?\s+eligible\s+to\s+vote:\s*([^\n]+)/i)

    // Legacy: ** field format
    const yesMatch = data.match(/\*\*Yes\*\*[:\s]+(\d+)/i)
    const noMatch = data.match(/\*\*No\*\*[:\s]+(\d+)/i)
    const abstainMatch = data.match(/\*\*Abstain\*\*[:\s]+(\d+)/i)
    const proposerMatch = data.match(/\*\*Proposer\*\*[:\s]+(g\S+)/i)

    // Extract description (body text between metadata and ## sections)
    const descMatch = data.match(/Author:.*?\n\n([\s\S]+?)(?:\n##|\nTiers|\n-\s+PROPOSAL|\n###\s+Stats)/m)
        || data.match(/^#.*?\n\n([\s\S]+?)(?:\n\*\*|\n##)/m)

    return {
        id,
        title: titleMatch?.[1]?.trim() || `Proposal #${id}`,
        description: descMatch?.[1]?.trim() || "",
        status: normalizeStatus(statusMatch?.[1] || "open"),
        author: authorMatch ? `@${authorMatch[1]}` : proposerMatch?.[1] || "",
        authorProfile: authorMatch?.[2] || "",
        tiers: tiersMatch
            ? tiersMatch[1].split(",").map((t) => t.trim()).filter(Boolean)
            : [],
        yesPercent: yesPercentMatch ? parseInt(yesPercentMatch[1], 10) : 0,
        noPercent: noPercentMatch ? parseInt(noPercentMatch[1], 10) : 0,
        yesVotes: yesMatch ? parseInt(yesMatch[1], 10) : 0,
        noVotes: noMatch ? parseInt(noMatch[1], 10) : 0,
        abstainVotes: abstainMatch ? parseInt(abstainMatch[1], 10) : 0,
        totalVoters: 0,
        proposer: authorMatch ? `@${authorMatch[1]}` : proposerMatch?.[1] || "",
    }
}

/**
 * Fetch per-tier vote breakdown via Render(":N/votes").
 * Returns array of VoteRecord, one per tier.
 */
export async function getProposalVotes(
    rpcUrl: string,
    realmPath: string,
    id: number,
): Promise<VoteRecord[]> {
    let data = await queryRender(rpcUrl, realmPath, `${id}/votes`)
    if (!data) {
        data = await queryRender(rpcUrl, realmPath, `proposal/${id}/votes`)
    }
    if (!data) return []

    const records: VoteRecord[] = []

    // Parse: "YES from T1 (VPPM 3):\n- @user\n- @user2\n\nNO from T1 (VPPM 3):"
    const voteBlockRe = /(YES|NO)\s+from\s+(T\d+)\s*\(VPPM\s+(\d+)\):\s*([\s\S]*?)(?=(?:YES|NO)\s+from\s+T\d+|$)/gi
    let m: RegExpExecArray | null
    while ((m = voteBlockRe.exec(data)) !== null) {
        const voteType = m[1].toUpperCase()
        const tier = m[2].toUpperCase()
        const vppm = parseInt(m[3], 10)
        const voterBlock = m[4]

        // Extract voter @usernames
        const voters: VoterEntry[] = []
        const voterRe = /@([^\]]+)\]\(([^)]+)\)/g
        let vm: RegExpExecArray | null
        while ((vm = voterRe.exec(voterBlock)) !== null) {
            voters.push({ username: `@${vm[1]}`, profileUrl: vm[2] })
        }

        // Find or create tier record
        let record = records.find((r) => r.tier === tier)
        if (!record) {
            record = { tier, vppm, yesVoters: [], noVoters: [] }
            records.push(record)
        }

        if (voteType === "YES") {
            record.yesVoters.push(...voters)
        } else {
            record.noVoters.push(...voters)
        }
    }

    return records
}

// ── MsgCall Builders ──────────────────────────────────────────

/** Build MsgCall for DAO vote. GovDAO v3 uses MustVoteOnProposalSimple. */
export function buildVoteMsg(
    caller: string,
    realmPath: string,
    proposalId: number,
    vote: "YES" | "NO" | "ABSTAIN",
): AminoMsg {
    // GovDAO v3 uses "MustVoteOnProposalSimple" with args [pid, option]
    // basedao uses "Vote" with args [proposalId, vote]
    // Using GovDAO v3 function name — Adena will reject if func doesn't exist
    return buildDAOMsgCall(realmPath, "MustVoteOnProposalSimple", [String(proposalId), vote], caller)
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

/** Normalize status string from various dao formats. */
function normalizeStatus(s: string): DAOProposal["status"] {
    const lower = s.toLowerCase()
    if (lower.includes("accept") || lower.includes("pass")) return "passed"
    if (lower.includes("reject") || lower.includes("fail")) return "rejected"
    if (lower.includes("exec") || lower.includes("complete")) return "executed"
    if (lower.includes("active") || lower.includes("open")) return "open"
    return "open"
}

/**
 * Query vm/qrender for a realm's Render(path) output.
 * Data format: "pkgpath:renderpath" (colon separator).
 */
async function queryRender(rpcUrl: string, pkgPath: string, renderPath: string): Promise<string | null> {
    return abciQuery(rpcUrl, "vm/qrender", `${pkgPath}:${sanitize(renderPath)}`)
}

/**
 * Query vm/qeval for evaluating an expression in a realm.
 */
async function queryEval(rpcUrl: string, pkgPath: string, expr: string): Promise<string | null> {
    return abciQuery(rpcUrl, "vm/qeval", `${pkgPath}.${expr}`)
}

/** Sanitize render path to prevent ABCI query injection.
 *  Allows query params (?key=val&key2=val2) for pagination and filtering. */
function sanitize(str: string): string {
    return str.replace(/[^a-zA-Z0-9_./:\-?=&]/g, "")
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
