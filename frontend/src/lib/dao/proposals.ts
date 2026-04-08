/**
 * DAO proposals — ABCI query helpers for proposal lists, details, and votes.
 *
 * Supports: GovDAO v3 markdown format and basedao JSON endpoint.
 */

import { queryRender, queryEval, normalizeStatus, unescapeMarkdown, type DAOProposal, type VoteRecord, type VoterEntry } from "./shared"
import { BECH32_PREFIX } from "../config"

// ── Proposal Cache ────────────────────────────────────────────
// In-memory cache with 30s TTL to avoid redundant ABCI round-trips
// when navigating back and forth between pages.

interface CacheEntry {
    proposals: DAOProposal[]
    ts: number
}

const PROPOSAL_CACHE_TTL = 30_000 // 30 seconds
const proposalCache = new Map<string, CacheEntry>()

/** Clear cached proposals for a realm (call after submitting proposals). */
export function invalidateProposalCache(realmPath: string): void {
    for (const key of proposalCache.keys()) {
        if (key.endsWith(`:${realmPath}`)) {
            proposalCache.delete(key)
        }
    }
}

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
                title: unescapeMarkdown(altMatch[2].trim()),
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
        // v3.2: Creation block height (if present in list format)
        const blockMatch = section.match(/(?:Created|Block|Height|block)[:\s]+#?(\d{4,})/i)

        const authorName = authorMatch?.[1] ? (authorMatch[1].startsWith(BECH32_PREFIX) ? authorMatch[1] : `@${authorMatch[1]}`) : ""

        proposals.push({
            id: parseInt(propMatch[1], 10),
            title: unescapeMarkdown(propMatch[2].trim()),
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
            createdAtBlock: blockMatch ? parseInt(blockMatch[1], 10) : undefined,
        })
    }

    return proposals
}

/**
 * Detect max page number from GovDAO pagination footer.
 * Format: **1** | [2](?page=2) | [3](?page=3)
 */
function detectMaxPage(data: string): number {
    const pageLinks = data.match(/\[(\d+)\]\(\?page=\d+\)/g)
    if (!pageLinks || pageLinks.length === 0) return 1
    let max = 1
    for (const link of pageLinks) {
        const m = link.match(/\[(\d+)\]/)
        if (m) max = Math.max(max, parseInt(m[1], 10))
    }
    return max
}

/**
 * Fetch DAO proposals via Render("") markdown parsing.
 * Supports GovDAO v3 format with author, tiers, and basedao format.
 * Automatically handles pagination — fetches all pages to get complete proposal history.
 */
export async function getDAOProposals(
    rpcUrl: string,
    realmPath: string,
): Promise<DAOProposal[]> {
    // Check cache first
    const cacheKey = `${rpcUrl}:${realmPath}`
    const cached = proposalCache.get(cacheKey)
    if (cached && (Date.now() - cached.ts) < PROPOSAL_CACHE_TTL) {
        return cached.proposals
    }

    // Try JSON endpoint first (basedao)
    const json = await queryEval(rpcUrl, realmPath, `GetProposalsJSON()`)
    if (json) {
        try {
            const match = json.match(/\("(.+)"\s+string\)/s)
            if (match) {
                const parsed = JSON.parse(match[1].replace(/\\"/g, '"'))
                if (Array.isArray(parsed)) {
                    const result = parsed.map((p: Record<string, unknown>) => ({
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
                    proposalCache.set(cacheKey, { proposals: result, ts: Date.now() })
                    return result
                }
            }
        } catch { /* fall through */ }
    }

    // GovDAO v3 / basedao: parse Render("") markdown — with pagination
    const page1 = await queryRender(rpcUrl, realmPath, "")
    if (!page1) return []

    const proposals = parseProposalList(page1)
    const maxPage = detectMaxPage(page1)

    // Fetch remaining pages in parallel (cap at 10 to prevent runaway loops)
    if (maxPage > 1) {
        const pagePromises: Promise<string | null>[] = []
        for (let p = 2; p <= Math.min(maxPage, 10); p++) {
            pagePromises.push(queryRender(rpcUrl, realmPath, `?page=${p}`))
        }
        const pages = await Promise.all(pagePromises)
        for (const pageData of pages) {
            if (pageData) {
                proposals.push(...parseProposalList(pageData))
            }
        }
    }

    // Deduplicate by id (in case of overlap between pages)
    const seen = new Set<number>()
    const unique = proposals.filter(p => {
        if (seen.has(p.id)) return false
        seen.add(p.id)
        return true
    })

    // Sort by id descending (newest first)
    unique.sort((a, b) => b.id - a.id)

    // Store in cache
    proposalCache.set(cacheKey, { proposals: unique, ts: Date.now() })

    return unique
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

        // v2.13: Action metadata — GovDAO v3 format
        // "This proposal contains the following metadata:\n\n...content...\n\nExecutor created in: realm/path"
        const executorMatch = data.match(/This proposal contains the following metadata:\s*\n\n([\s\S]+?)(?:\n\nExecutor created in:\s*(\S+))?\s*\n\n---/m)

        // v2.13: Action metadata — basedao format
        // "## Resource - actionType 📦\n\n  - **Name:** ...\n---\naction body\n---"
        const resourceMatch = data.match(/##\s+Resource\s*-\s*(.+?)\s*📦\s*\n/m)
        // Action body: specifically after Resource section's "---" separator (basedao only)
        // Uses lookbehind for Condition line to anchor after the resource block
        const actionBodyMatch = resourceMatch
            ? data.match(/\*\*Condition:\*\*[^\n]*\n\n---\s*\n\n([\s\S]+?)\n\n---/m)
            : null

        // Determine action type and body from either format
        const actionType = resourceMatch?.[1]?.trim() || undefined
        const actionBody = executorMatch?.[1]?.trim() || actionBodyMatch?.[1]?.trim() || undefined
        const executorRealm = executorMatch?.[2]?.trim() || undefined

        // v3.2: Extract creation block height from various formats
        const createdBlockMatch = data.match(/(?:Created|Submitted|Proposed)\s+(?:at\s+)?(?:block|height)[:\s]+#?(\d{4,})/i)
            || data.match(/\*\*Block:\*\*\s*(\d{4,})/)
            || data.match(/block\s+#?(\d{4,})/i)
        // v3.2: Extract ISO timestamp if realm provides it
        const createdAtMatch = data.match(/(?:Created|Submitted)[:\s]+([\d]{4}-[\d]{2}-[\d]{2}T[^\s]+)/i)
            || data.match(/"created_at"\s*:\s*"([^"]+)"/)

        return {
            id,
            title: unescapeMarkdown(titleMatch?.[1]?.trim() || `Proposal #${id}`),
            description: unescapeMarkdown(descMatch?.[1]?.trim() || ""),
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
            actionType,
            actionBody,
            executorRealm,
            createdAtBlock: createdBlockMatch ? parseInt(createdBlockMatch[1], 10) : undefined,
            createdAt: createdAtMatch?.[1] || undefined,
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
