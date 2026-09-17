/**
 * DAO members — ABCI query helpers for member lists and resolution.
 *
 * Supports: GovDAO v3 memberstore (paginated tables), basedao JSON, and
 * basedao Render("") markdown fallback.
 */

import { queryRender, queryRenderPage, queryEval, parseQevalJSON, resolveUsernames, hasOwnSubpageLink, detectMaxPage, getDaoDialect, setDaoDialect, deleteDaoDialect, isMemberstoreBoundToRealm, type DAOMember } from "./shared"
import { isValidGnoAddressChecksum } from "./address"
import { membaV2Route, readAllV2Members, readV2DAOMembers } from "./membaV2Shell"

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** Map one GetMembersJSON row. The generated template emits `power`; older
 *  basedao exports used `votingPower`. */
function memberFromJSON(m: Record<string, unknown>): DAOMember {
    const roles = m.roles ?? m.Roles
    return {
        address: String(m.address || m.Address || ""),
        roles: Array.isArray(roles) ? roles.filter((r): r is string => typeof r === "string") : [],
        tier: String(m.tier || m.Tier || ""),
        votingPower: Number(m.power ?? m.Power ?? m.votingPower ?? m.VotingPower ?? 0) || 0,
        username: "",
    }
}

/** Decode a GetMembersJSON qeval answer; null when it is not a JSON array. */
function membersFromQeval(raw: string | null): DAOMember[] | null {
    if (!raw) return null
    const parsed = parseQevalJSON(raw)
    if (!Array.isArray(parsed)) return null
    return parsed
        .filter((m): m is Record<string, unknown> => !!m && typeof m === "object" && !Array.isArray(m))
        .map(memberFromJSON)
}

/**
 * Parse gnodaokit/basedao members-table rows (deployed RenderMembersTable):
 * | Name | [g1x7\.\.\.](/u/g1full) | [chip role](path:role/admin), … | [View](path:member/g1full) |
 *
 * The Name cell is a member-editable display name and is never used for
 * identity. A row is accepted only when:
 * - the address cell is exactly one /u/ link to a valid address,
 * - the role cell holds only role links to this realm's own :role/ route
 *   (or the realm's "No role assigned" placeholder), and
 * - the View link points to this realm's :member/ route for the same address.
 * Any other table line makes the page invalid (null), so a roster is either
 * fully attributable or reported as unavailable.
 */
export function parseDaokitMemberRows(data: string, realmPath: string): DAOMember[] | null {
    const lp = escapeRe(realmPath.replace(/^[^/]+/, ""))
    const roleLink = new RegExp(`^\\[(?:!\\[[^\\]\\n]*\\]\\(data:image\\/svg\\+xml;base64,[A-Za-z0-9+/=]*\\) )?([A-Za-z0-9_-]+)\\]\\(${lp}:role\\/([A-Za-z0-9_-]+)\\)`)
    const noRole = /^!\[ colored chip\]\(data:image\/svg\+xml;base64,[A-Za-z0-9+/=]*\) \*No role assigned\*$/
    const row = new RegExp(`^\\| [^|\\n]* \\| \\[[^\\]|\\n]*\\]\\(\\/u\\/(g1[a-z0-9]{38})\\) \\| ([^|\\n]*) \\| \\[View\\]\\(${lp}:member\\/(g1[a-z0-9]{38})\\) \\|$`)
    const members: DAOMember[] = []
    for (const line of data.replaceAll("\r\n", "\n").split("\n")) {
        if (!line.startsWith("|")) continue
        if (/^\|\s*\*\*Name\*\*/.test(line) || /^\|[-| ]+\|$/.test(line)) continue
        const m = row.exec(line)
        if (!m || m[1] !== m[3] || !isValidGnoAddressChecksum(m[1])) return null
        const roles: string[] = []
        let cell = m[2].trim()
        if (!noRole.test(cell)) {
            while (cell) {
                const link = roleLink.exec(cell)
                if (!link || link[1] !== link[2]) return null
                roles.push(link[2])
                cell = cell.slice(link[0].length).replace(/^, /, "")
            }
        }
        members.push({ address: m[1], roles, tier: "", votingPower: 0, username: "" })
    }
    return members
}

/**
 * Parse members from a generated/legacy DAO Render("") page. Bullets are read
 * only inside the page's single "## Members" section (up to the next heading)
 * and only when every bullet names a valid address. More than one Members
 * heading, an invalid bullet, or a count that disagrees with "(N)" yields [].
 * Supports v5.3.0 bullets (roles + pipe), v5.2.0 (em dash) and v5.0.x (power only).
 */
export function parseMembersFromRender(data: string): DAOMember[] {
    const text = data.replaceAll("\r\n", "\n")
    const headings = [...text.matchAll(/^## Members(?: \((\d+)\))?[ \t]*$/gm)]
    if (headings.length !== 1) return []
    const start = headings[0].index! + headings[0][0].length
    const next = text.slice(start).search(/^#{1,3} /m)
    const section = next === -1 ? text.slice(start) : text.slice(start, start + next)

    const members: DAOMember[] = []
    const bullet = /^[-*]\s+(\S+)(?:\s*\(([^)\n]+)\))?(?:\s*[—|]\s*power:\s*(\d+))?\s*$/
    for (const line of section.split("\n")) {
        if (!/^[-*]\s/.test(line)) continue
        const match = bullet.exec(line)
        if (!match || !isValidGnoAddressChecksum(match[1])) return []
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
        if (match[3]) power = parseInt(match[3], 10) || 0
        members.push({ address: match[1], roles, tier: "", votingPower: power, username: "" })
    }
    if (headings[0][1] !== undefined && Number(headings[0][1]) !== members.length) return []
    if (new Set(members.map((m) => m.address)).size !== members.length) return []
    return members
}

/**
 * Fetch DAO members via memberstore or fallback to basedao parsing.
 * For memberstore: fetches all paginated pages with inline tier extraction.
 * `strict` (default false, matching the historical always-silent contract)
 * makes a FAILED daokit :members read throw instead of returning [] — so a
 * transient RPC blip surfaces as an error state rather than a confident
 * "0 members" roster.
 */
export async function getDAOMembers(
    rpcUrl: string,
    realmPath: string,
    memberstorePath?: string,
    strict = false,
): Promise<DAOMember[]> {
    // Version-2 DAOs: paginated JSON only.
    const route = await membaV2Route(rpcUrl, realmPath, strict)
    if (route === "unresolved") return []
    if (route === "v2") {
        try {
            return await readV2DAOMembers(rpcUrl, realmPath)
        } catch (err) {
            if (strict) throw err
            return []
        }
    }

    // Try memberstore members list first — only a store bound to this realm
    // (see isMemberstoreBoundToRealm); an unbound path is ignored, not read.
    if (memberstorePath && isMemberstoreBoundToRealm(memberstorePath, realmPath)) {
        const allMembers = await fetchAllMemberstorePages(rpcUrl, memberstorePath)
        if (allMembers.length > 0) {
            await resolveUsernames(rpcUrl, allMembers)
            return allMembers
        }
    }

    // Memoized daokit realm: the JSON probe VM-panics and Render("") is a
    // landing page listing nobody — straight to the :members table. A failed
    // read forgets the memo and falls through to full discovery (stale or
    // mis-learned memos self-heal); an EMPTY-but-valid table falls through
    // too, for parity with discovery's landing-bullet last resort.
    if (getDaoDialect(rpcUrl, realmPath) === "daokit") {
        const table = await fetchDaokitMemberPages(rpcUrl, realmPath)
        if (table !== null && table.length > 0) {
            await resolveUsernames(rpcUrl, table)
            return table
        }
        if (table === null) deleteDaoDialect(rpcUrl, realmPath)
    }

    // Try JSON endpoint (generated template / basedao)
    const jsonMembers = membersFromQeval(await queryEval(rpcUrl, realmPath, `GetMembersJSON()`))
    if (jsonMembers) {
        await resolveUsernames(rpcUrl, jsonMembers)
        return jsonMembers
    }

    // Fallback: parse Render("") markdown
    const data = await queryRender(rpcUrl, realmPath, "")
    if (!data) return []

    let members: DAOMember[]
    if (hasOwnSubpageLink(data, realmPath, "members")) {
        // gnodaokit/basedao: Render("") is a landing page linking to :members
        // — the table there (paginated at 10/page) is authoritative; rows
        // parsed off a landing page that advertises the route are noise.
        // (Members only ever memo "daokit" — the landing is definitive; a
        // bullet-rendering realm says nothing about the PROPOSALS dialect.)
        setDaoDialect(rpcUrl, realmPath, "daokit")
        const table = await fetchDaokitMemberPages(rpcUrl, realmPath)
        if (table === null) {
            // The advertised :members page could not be read — that is a
            // failed read, not an empty DAO. The daokit conclusion failed its
            // empirical test, so forget it (next read re-discovers).
            deleteDaoDialect(rpcUrl, realmPath)
            if (strict) throw new Error("Failed to read the DAO's members page")
            return []
        }
        members = table.length > 0 ? table : parseMembersFromRender(data)
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
 * Returns null when the :members page could not be read OR when the answer
 * isn't a daokit members page (a non-mux realm answers unknown routes with
 * truthy junk, not the literal "404" — a genuine members page carries its
 * "## Members 👥 (N)" header even when empty), so callers can distinguish a
 * failed read from a genuinely empty roster.
 */
async function fetchDaokitMemberPages(rpcUrl: string, realmPath: string): Promise<DAOMember[] | null> {
    const page1 = await queryRenderPage(rpcUrl, realmPath, "members")
    if (!page1) return null
    // The realm-generated header precedes the table and carries the total.
    const header = page1.match(/^##\s+Members\s+👥\s+\((\d+)\)\s*$/m)
    if (!header) return null
    const total = Number(header[1])

    const allMembers: DAOMember[] = []
    const seen = new Set<string>()
    const add = (rows: DAOMember[] | null): boolean => {
        if (rows === null) return false
        for (const row of rows) {
            if (seen.has(row.address)) return false
            seen.add(row.address)
            allMembers.push(row)
        }
        return true
    }

    if (!add(parseDaokitMemberRows(page1, realmPath))) return null

    // Page through every page the total implies (10 per page), bounded.
    const pages = Math.max(detectMaxPage(page1), Math.ceil(total / 10))
    if (pages > 50) return null
    if (pages > 1) {
        const pagePromises: Promise<string | null>[] = []
        for (let p = 2; p <= pages; p++) {
            pagePromises.push(queryRenderPage(rpcUrl, realmPath, `members?page=${p}`))
        }
        for (const pageData of await Promise.all(pagePromises)) {
            if (!pageData || !add(parseDaokitMemberRows(pageData, realmPath))) return null
        }
    }

    return allMembers.length === total ? allMembers : null
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

    const route = await membaV2Route(rpcUrl, realmPath)
    if (route === "unresolved") return null
    if (route === "v2") {
        try {
            return (await readAllV2Members(rpcUrl, realmPath)).find((m) => m.address === target) ?? null
        } catch {
            return null
        }
    }

    // Memberstore (tier DAOs like GovDAO): page 1 answers the common case
    // immediately; only a miss fans out to the remaining pages in parallel.
    // (The old next-link walk followed the FIRST "[N](?page=N)" link, which on
    // pages ≥ 2 is the pager's leading BACK-link — the walk stopped at page 2
    // and silently missed members past ~28 at the memberstore's 14/page.)
    // An unbound store path is ignored, exactly as in getDAOMembers.
    if (memberstorePath && isMemberstoreBoundToRealm(memberstorePath, realmPath)) {
        const page1 = await queryRender(rpcUrl, memberstorePath, "members")
        if (!page1) return null
        const toMember = (row: { tier: string; address: string }): DAOMember => ({
            address: row.address,
            roles: [],
            tier: row.tier,
            votingPower: TIER_POWERS[row.tier] || 0,
            username: "",
        })
        for (const row of parseMemberstoreRows(page1)) {
            if (row.address.toLowerCase() === target) return toMember(row)
        }
        const maxPage = detectMaxPage(page1)
        if (maxPage > 1) {
            const pagePromises: Promise<string | null>[] = []
            for (let p = 2; p <= Math.min(maxPage, 10); p++) {
                pagePromises.push(queryRender(rpcUrl, memberstorePath, `members?page=${p}`))
            }
            for (const pageData of await Promise.all(pagePromises)) {
                if (!pageData) continue
                for (const row of parseMemberstoreRows(pageData)) {
                    if (row.address.toLowerCase() === target) return toMember(row)
                }
            }
        }
        return null
    }

    // Memoized daokit realm: the JSON probe VM-panics and the landing page
    // lists nobody — straight to the :members table. A failed read forgets
    // the memo and falls through to discovery (self-healing, same as
    // getDAOMembers).
    if (getDaoDialect(rpcUrl, realmPath) === "daokit") {
        const all = await fetchDaokitMemberPages(rpcUrl, realmPath)
        if (all !== null) return all.find((m) => m.address.toLowerCase() === target) ?? null
        deleteDaoDialect(rpcUrl, realmPath)
    }

    // JSON endpoint — find the address without resolving usernames.
    const jsonMembers = membersFromQeval(await queryEval(rpcUrl, realmPath, `GetMembersJSON()`))
    if (jsonMembers) return jsonMembers.find((m) => m.address.toLowerCase() === target) ?? null

    // Fallback: parse Render("") markdown and find the address. Same daokit
    // landing-page hop as getDAOMembers — without it, members of a daokit DAO
    // would resolve here (the landing page lists nobody) as non-members and
    // lose their "your worlds" role badge while the members page shows them.
    const data = await queryRender(rpcUrl, realmPath, "")
    if (!data) return null
    if (hasOwnSubpageLink(data, realmPath, "members")) {
        setDaoDialect(rpcUrl, realmPath, "daokit")
        const all = await fetchDaokitMemberPages(rpcUrl, realmPath)
        return all?.find((m) => m.address.toLowerCase() === target) ?? null
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

/**
 * Fetch all pages of memberstore members.
 * GovDAO v3 ABCI returns markdown table rows:
 *   | ![T1 chip](base64...) T1 | g1address |
 * Paginates at 14/page (r/gov/dao/v3/memberstore rendermembers.gno). Pages
 * 2..max are fetched in parallel off page 1's max-page scan: the bptree
 * pager's Picker leads with the BACK-link ("[1](?page=1) | **2** | …") on
 * pages ≥ 2, so a follow-the-first-link walk stopped at page 2 and silently
 * truncated rosters past ~28 members.
 */
async function fetchAllMemberstorePages(
    rpcUrl: string,
    memberstorePath: string,
): Promise<DAOMember[]> {
    const page1 = await queryRender(rpcUrl, memberstorePath, "members")
    if (!page1) return []

    const allMembers: DAOMember[] = []
    const seen = new Set<string>()
    const add = (data: string) => {
        for (const row of parseMemberstoreRows(data)) {
            if (seen.has(row.address)) continue
            seen.add(row.address)
            allMembers.push({
                address: row.address,
                roles: [],
                tier: row.tier,
                votingPower: TIER_POWERS[row.tier] || 0,
                username: "",
            })
        }
    }

    add(page1)

    const maxPage = detectMaxPage(page1)
    if (maxPage > 1) {
        const pagePromises: Promise<string | null>[] = []
        for (let p = 2; p <= Math.min(maxPage, 10); p++) {
            pagePromises.push(queryRender(rpcUrl, memberstorePath, `members?page=${p}`))
        }
        for (const pageData of await Promise.all(pagePromises)) {
            if (pageData) add(pageData)
        }
    }

    return allMembers
}
