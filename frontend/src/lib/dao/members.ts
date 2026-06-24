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
 * Resolve a single address's membership — a lightweight counterpart to
 * getDAOMembers for the home "your worlds" cards.
 *
 * Unlike getDAOMembers it never resolves usernames (the role badge needs only
 * tier/roles). On the memberstore path it also early-exits as soon as the
 * target address is found while paging; the basedao JSON path fetches the
 * member list once and finds the address locally (still far cheaper than
 * resolving every member's username). Cheap enough to run per saved DAO.
 *
 * Returns the matched DAOMember (username always ""), or null when the address
 * is not a member / cannot be resolved.
 */
export async function getMemberRole(
    rpcUrl: string,
    realmPath: string,
    address: string,
    memberstorePath?: string,
): Promise<DAOMember | null> {
    if (!address) return null
    const target = address.toLowerCase()

    // Memberstore (tier DAOs like GovDAO): page with early-exit on match.
    if (memberstorePath) {
        const seen = new Set<string>()
        let page = 1
        const maxPages = 10
        while (page <= maxPages) {
            const renderPath = page === 1 ? "members" : `members?page=${page}`
            const data = await queryRender(rpcUrl, memberstorePath, renderPath)
            if (!data) break
            let foundNew = false
            for (const row of parseMemberstoreRows(data)) {
                if (row.address.toLowerCase() === target) {
                    return {
                        address: row.address,
                        roles: [],
                        tier: row.tier,
                        votingPower: TIER_POWERS[row.tier] || 0,
                        username: "",
                    }
                }
                if (!seen.has(row.address)) {
                    seen.add(row.address)
                    foundNew = true
                }
            }
            const next = nextMemberstorePage(data, page)
            if (next === null || !foundNew) break
            page = next
        }
        return null
    }

    // basedao JSON endpoint — find the address without resolving usernames.
    const json = await queryEval(rpcUrl, realmPath, `GetMembersJSON()`)
    if (json) {
        try {
            const match = json.match(/\("(.+)"\s+string\)/s)
            if (match) {
                const parsed = JSON.parse(match[1].replace(/\\"/g, '"'))
                if (Array.isArray(parsed)) {
                    const found = parsed.find(
                        (m: Record<string, unknown>) =>
                            String(m.address || m.Address || "").toLowerCase() === target,
                    )
                    return found
                        ? {
                              address: String(found.address || found.Address || ""),
                              roles: (found.roles || found.Roles || []) as string[],
                              tier: String(found.tier || found.Tier || ""),
                              votingPower: Number(found.votingPower || found.VotingPower || 0),
                              username: "",
                          }
                        : null
                }
            }
        } catch { /* fall through to render */ }
    }

    // Fallback: parse Render("") markdown and find the address.
    const data = await queryRender(rpcUrl, realmPath, "")
    if (!data) return null
    return parseMembersFromRender(data).find((m) => m.address.toLowerCase() === target) ?? null
}

/**
 * Derive a short, human role label for a member's "your worlds" eyebrow.
 * Prefers a recognised privileged role, then any explicit role, then the power
 * tier (T1/T2/T3), then a generic "member". Returns undefined when member is
 * null (not a member / unresolved) so callers can omit the badge.
 */
export function deriveRoleLabel(member: DAOMember | null): string | undefined {
    if (!member) return undefined
    const priority = ["owner", "admin", "moderator", "council", "core"]
    const roles = (member.roles || []).map((r) => r.toLowerCase().trim()).filter(Boolean)
    for (const p of priority) {
        if (roles.includes(p)) return p
    }
    if (roles.length > 0) return roles[0]
    if (member.tier) return member.tier
    return "member"
}

/** Tier → voting power mapping for memberstore tiers. */
const TIER_POWERS: Record<string, number> = { T1: 3, T2: 2, T3: 1 }

/**
 * Parse {tier, address} rows from a memberstore page's markdown table.
 * Rows look like: "| ![T1 chip](base64...) T1 | g1address |".
 * Exported (as _parseMemberstoreRows) for unit testing.
 */
export function parseMemberstoreRows(data: string): { tier: string; address: string }[] {
    const rows: { tier: string; address: string }[] = []
    const re = /(T\d+)\s*\|\s*(g1[a-z0-9]+)\s*\|/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(data)) !== null) {
        rows.push({ tier: m[1].toUpperCase(), address: m[2] })
    }
    return rows
}

/** Extract the next memberstore page number from a "[2](?page=2)" link, or null. */
function nextMemberstorePage(data: string, current: number): number | null {
    const match = data.match(/\[\d+\]\(\??.*?page=(\d+)\)/)
    if (!match) return null
    const next = parseInt(match[1], 10)
    return next > current ? next : null
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

    while (page <= maxPages) {
        const renderPath = page === 1 ? "members" : `members?page=${page}`
        const data = await queryRender(rpcUrl, memberstorePath, renderPath)
        if (!data) break

        let foundNew = false
        for (const row of parseMemberstoreRows(data)) {
            if (seen.has(row.address)) continue
            seen.add(row.address)
            foundNew = true
            allMembers.push({
                address: row.address,
                roles: [],
                tier: row.tier,
                votingPower: TIER_POWERS[row.tier] || 0,
                username: "",
            })
        }

        const next = nextMemberstorePage(data, page)
        if (next === null || !foundNew) break
        page = next
    }

    return allMembers
}
