/**
 * DAO members — ABCI query helpers for member lists and resolution.
 *
 * Supports: GovDAO v3 memberstore (paginated tables), basedao JSON, and
 * basedao Render("") markdown fallback.
 */

import { queryRender, queryEval, resolveUsernames, type DAOMember } from "./shared"

/**
 * Parse members from basedao Render("") markdown output.
 * Supports v5.3.0 (roles + pipe), v5.2.0 (em dash), v5.0.x (power only).
 */
export function parseMembersFromRender(data: string): DAOMember[] {
    const members: DAOMember[] = []
    const re = /[-*]\s+(g\S+)(?:\s*\(([^)]+)\))?(?:\s*[—|]\s*power:\s*(\d+))?/g
    let match: RegExpExecArray | null
    while ((match = re.exec(data)) !== null) {
        let roles: string[] = []
        let power = 0
        if (match[2]) {
            const inner = match[2].trim()
            if (inner.startsWith("roles:")) {
                roles = inner.replace("roles:", "").split(",").map((r) => r.trim()).filter(Boolean)
            } else if (inner.startsWith("power:")) {
                power = parseInt(inner.replace("power:", "").trim(), 10) || 0
            } else {
                roles = inner.split(",").map((r) => r.trim()).filter(Boolean)
            }
        }
        if (match[3]) {
            power = parseInt(match[3], 10) || 0
        }
        members.push({
            address: match[1],
            roles,
            tier: "",
            votingPower: power,
            username: "",
        })
    }
    return members
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
                    const members = parsed.map((m: Record<string, unknown>) => ({
                        address: String(m.address || m.Address || ""),
                        roles: (m.roles || m.Roles || []) as string[],
                        tier: String(m.tier || m.Tier || ""),
                        votingPower: Number(m.votingPower || m.VotingPower || 0),
                        username: String(m.username || m.Username || ""),
                    }))
                    await resolveUsernames(rpcUrl, members)
                    return members
                }
            }
        } catch { /* fall through */ }
    }

    // Fallback: parse Render("") markdown
    const data = await queryRender(rpcUrl, realmPath, "")
    if (!data) return []

    const members = parseMembersFromRender(data)
    await resolveUsernames(rpcUrl, members)
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
