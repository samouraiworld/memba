/**
 * DAO members — ABCI query helpers for member lists and resolution.
 *
 * Supports: GovDAO v3 memberstore (paginated tables), basedao JSON, and
 * basedao Render("") markdown fallback.
 */

import { queryRender, queryRenderPage, queryEval, resolveUsernames, hasOwnSubpageLink, detectMaxPage, type DAOMember } from "./shared"

/**
 * Parse gnodaokit/basedao members-table rows (deployed RenderMembersTable):
 * | Name | [g1x7\.\.\.](/u/g1full) | [chip role](path:role/admin), … | [View](path:member/g1full) |
 * The full address comes from the /u/ link (the display text is truncated);
 * roles come from the :role/ link hrefs (immune to the inline SVG chips).
 * Known limitation: cells are positional, so a member whose self-set profile
 * DisplayName contains a literal "|" fails the row shape and is dropped from
 * the parsed roster (never mis-attributed) — the same name breaks the realm's
 * own gnoweb table rendering.
 */
function parseDaokitMemberRows(data: string): DAOMember[] {
    if (!data.includes(":member/")) return []
    const members: DAOMember[] = []
    const re = /^\|[^|]*\|[^|]*\]\(\/u\/(g1[a-z0-9]+)\)[^|]*\|([^|]*)\|[^|]*:member\/g1[a-z0-9]+\)[^|]*\|/gm
    let m: RegExpExecArray | null
    while ((m = re.exec(data)) !== null) {
        const roles = [...m[2].matchAll(/:role\/([A-Za-z0-9_-]+)\)/g)].map((r) => r[1])
        members.push({
            address: m[1],
            roles,
            tier: "",
            votingPower: 0,
            username: "",
        })
    }
    return members
}

/**
 * Parse members from basedao Render output.
 * Supports v5.3.0 bullets (roles + pipe), v5.2.0 (em dash), v5.0.x (power
 * only), and the gnodaokit members table. Bullets are tried FIRST: they are
 * the legacy realm-generated contract, so a table-shaped string smuggled into
 * a legacy realm's description can't displace the authentic roster. Pages
 * that genuinely carry the daokit table (the :members sub-page) have no
 * bullets, so the table leg still applies there.
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
    if (members.length > 0) return members

    // No bullets — try the gnodaokit members table.
    return parseDaokitMemberRows(data)
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

    let members: DAOMember[]
    if (hasOwnSubpageLink(data, realmPath, "members")) {
        // gnodaokit/basedao: Render("") is a landing page linking to :members
        // — the table there (paginated at 10/page) is authoritative; rows
        // parsed off a landing page that advertises the route are noise.
        members = await fetchDaokitMemberPages(rpcUrl, realmPath)
        if (members.length === 0) members = parseMembersFromRender(data)
    } else {
        members = parseMembersFromRender(data)
    }

    await resolveUsernames(rpcUrl, members)
    return members
}

/**
 * Fetch all pages of a gnodaokit :members table. The avl/pager Picker renders
 * "[N](?page=N)" links; pages 2..max are fetched in parallel off page 1's
 * max-page scan. (A next-link walk would stop at page 2 — on pages ≥ 2 the
 * Picker's FIRST link is the back-link "[1](?page=1)" — and scanning for the
 * max also degrades a bogus injected link to harmless empty over-fetches
 * rather than silent truncation.)
 */
async function fetchDaokitMemberPages(rpcUrl: string, realmPath: string): Promise<DAOMember[]> {
    const page1 = await queryRenderPage(rpcUrl, realmPath, "members")
    if (!page1) return []

    const allMembers: DAOMember[] = []
    const seen = new Set<string>()
    const add = (rows: DAOMember[]) => {
        for (const row of rows) {
            if (seen.has(row.address)) continue
            seen.add(row.address)
            allMembers.push(row)
        }
    }

    add(parseDaokitMemberRows(page1))

    const maxPage = detectMaxPage(page1)
    if (maxPage > 1) {
        const pagePromises: Promise<string | null>[] = []
        for (let p = 2; p <= Math.min(maxPage, 10); p++) {
            pagePromises.push(queryRenderPage(rpcUrl, realmPath, `members?page=${p}`))
        }
        for (const pageData of await Promise.all(pagePromises)) {
            if (pageData) add(parseDaokitMemberRows(pageData))
        }
    }

    return allMembers
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

    // Fallback: parse Render("") markdown and find the address. Same daokit
    // landing-page hop as getDAOMembers — without it, members of a daokit DAO
    // would resolve here (the landing page lists nobody) as non-members and
    // lose their "your worlds" role badge while the members page shows them.
    const data = await queryRender(rpcUrl, realmPath, "")
    if (!data) return null
    if (hasOwnSubpageLink(data, realmPath, "members")) {
        const all = await fetchDaokitMemberPages(rpcUrl, realmPath)
        return all.find((m) => m.address.toLowerCase() === target) ?? null
    }
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
