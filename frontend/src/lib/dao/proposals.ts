/**
 * DAO proposals — ABCI query helpers for proposal lists, details, and votes.
 *
 * Supports: GovDAO v3 markdown format and basedao JSON endpoint.
 */

import { queryRender, queryEval, normalizeStatus, type DAOProposal, type VoteRecord, type VoterEntry } from "./shared"
import { BECH32_PREFIX } from "../config"

/**
 * Parse proposal list from GovDAO v3 Render("") output.
 * Format:
 * ### [Prop #N - Title](link)
 * Author: [@username](profile)
 * Status: ACTIVE
 * Tiers eligible to vote: T1, T2, T3
 */
export function parseProposalList(data: string): DAOProposal[] {
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
                category: "",
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

        // Extract author: Author: [@username](url) or Author: g1address
        const authorMatch = section.match(/Author:\s*\[@([^\]]+)\]\(([^)]+)\)/)
            || section.match(/Author:\s*(g1[a-z0-9]+)/)
        // Category: governance | treasury | membership | operations
        const categoryMatch = section.match(/Category:\s*(\w+)/i)
        // Status: ACTIVE | ACCEPTED | etc
        const statusMatch = section.match(/Status:\s*(\w+)/i)
        // Tiers eligible to vote: T1, T2, T3
        const tiersMatch = section.match(/Tiers?\s+eligible\s+to\s+vote:\s*([^\n]+)/i)

        const authorName = authorMatch?.[1] ? (authorMatch[1].startsWith(BECH32_PREFIX) ? authorMatch[1] : `@${authorMatch[1]}`) : ""

        proposals.push({
            id: parseInt(propMatch[1], 10),
            title: propMatch[2].trim(),
            description: "",
            category: categoryMatch?.[1]?.toLowerCase() || "",
            status: normalizeStatus(statusMatch?.[1] || "open"),
            author: authorName,
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
            proposer: authorName,
        })
    }

    return proposals
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
                        category: String(p.category || p.Category || ""),
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
 * Fetch single proposal detail via Render(":N") (colon prefix for GovDAO).
 * Tries both GovDAO v3 (:N) and basedao (proposal/N) formats.
 */
export async function getProposalDetail(
    rpcUrl: string,
    realmPath: string,
    id: number,
): Promise<DAOProposal | null> {
    try {
        // Try multiple render path formats:
        // 1. GovDAO v3: just the id number
        // 2. basedao / custom DAO: "proposal/N"
        // 3. GovDAO with colon: ":N"
        let data = await queryRender(rpcUrl, realmPath, String(id))
        if (!data) {
            data = await queryRender(rpcUrl, realmPath, `proposal/${id}`)
        }
        if (!data) {
            data = await queryRender(rpcUrl, realmPath, `:${id}`)
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

        // Category
        const categoryMatch = data.match(/Category:\s*(\w+)/i)

        return {
            id,
            title: titleMatch?.[1]?.trim() || `Proposal #${id}`,
            description: descMatch?.[1]?.trim() || "",
            category: categoryMatch?.[1]?.toLowerCase() || "",
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
    } catch (err) {
        console.warn(`[getProposalDetail] Failed to parse proposal #${id} from ${realmPath}:`, err)
        return null
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
    const voteBlockRe = /(YES|NO|ABSTAIN)\s+from\s+(T\d+)\s*\(VPPM\s+(\d+)\):\s*([\s\S]*?)(?=(?:YES|NO|ABSTAIN)\s+from\s+T\d+|$)/gi
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
            record = { tier, vppm, yesVoters: [], noVoters: [], abstainVoters: [] }
            records.push(record)
        }

        if (voteType === "YES") {
            record.yesVoters.push(...voters)
        } else if (voteType === "NO") {
            record.noVoters.push(...voters)
        } else {
            record.abstainVoters.push(...voters)
        }
    }

    return records
}
