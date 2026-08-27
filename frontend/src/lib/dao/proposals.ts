/**
 * DAO proposals — ABCI query helpers for proposal lists, details, and votes.
 *
 * Supports: GovDAO v3 markdown format and basedao JSON endpoint.
 */

import { queryRender, queryRenderPage, queryEval, parseQevalJSON, normalizeStatus, unescapeMarkdown, hasOwnSubpageLink, detectMaxPage, type DAOProposal, type VoteRecord, type VoterEntry } from "./shared"
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

/** The title getProposalDetail falls back to when no real title parses. Exported
 *  so consumers (DAOHome's title adoption) never re-derive the sentinel by hand. */
export function fallbackProposalTitle(id: number): string {
    return `Proposal #${id}`
}

/** Convert daokit's "2026-08-27 10:12:05 UTC+00:00" table cell to ISO, or undefined. */
function daokitCellToISO(cell: string): string | undefined {
    const m = cell.trim().match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC([+-]\d{2}:\d{2})$/)
    return m ? `${m[1]}T${m[2]}${m[3]}` : undefined
}

/** Last match of a regex in a string. The daokit detail page renders the
 *  user-authored description ABOVE the realm-generated Status / proposer /
 *  Votes sections, so first-match extraction of those fields would let a
 *  hostile description spoof them — the REAL sections always come last. */
function matchLast(data: string, re: RegExp): RegExpExecArray | null {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g")
    let m: RegExpExecArray | null
    let last: RegExpExecArray | null = null
    while ((m = g.exec(data)) !== null) {
        last = m
        if (m.index === g.lastIndex) g.lastIndex++
    }
    return last
}

// Action metadata extraction, shared by BOTH detail legs so the two can't
// drift apart (basedao format: "## Resource - actionType 📦", body between the
// "---" pair after the Condition line).
const RESOURCE_RE = /##\s+Resource\s*-\s*(.+?)\s*📦/m
const ACTION_BODY_RE = /\*\*Condition:\*\*[^\n]*\n\n---\s*\n\n([\s\S]+?)\n\n---/m

/**
 * Parse gnodaokit/basedao proposal-table rows (deployed RenderProposalsTable):
 * | [N](path:proposal/N) | Resource name | [g1…](/u/g1full) | 2026-08-27 10:12:05 UTC+00:00 | Open |
 * The table has no title column — the resource display name stands in
 * (titleIsPlaceholder) until detail enrichment supplies the real title.
 * Known limitation: cells are positional, so a literal "|" inside the
 * resource display name (realm-code-controlled, never user input) would shift
 * the columns; such a name would break the realm's own gnoweb table too.
 */
function parseDaokitProposalRows(data: string): DAOProposal[] {
    if (!data.includes(":proposal/")) return []
    const proposals: DAOProposal[] = []
    const re = /^\|\s*\[(\d+)\]\([^)]*:proposal\/\d+\)\s*\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|/gm
    let m: RegExpExecArray | null
    while ((m = re.exec(data)) !== null) {
        const proposer = m[3].match(/\]\(\/u\/(g1[a-z0-9]+)\)/)?.[1] || ""
        proposals.push({
            id: parseInt(m[1], 10),
            title: unescapeMarkdown(m[2].trim()),
            titleIsPlaceholder: true,
            description: "",
            category: "",
            status: normalizeStatus(m[5].trim() || "open"),
            author: proposer,
            authorProfile: "",
            tiers: [],
            yesPercent: 0,
            noPercent: 0,
            yesVotes: 0,
            noVotes: 0,
            abstainVotes: 0,
            totalVoters: 0,
            proposer,
            createdAt: daokitCellToISO(m[4]),
        })
    }
    return proposals
}

/**
 * Parse proposal list from GovDAO v3 Render("") output.
 * Format:
 * ### [Prop #N - Title](link)
 * Author: [@username](profile)
 * Status: ACTIVE
 * Tiers eligible to vote: T1, T2, T3
 * Also handles gnodaokit/basedao markdown tables (see parseDaokitProposalRows).
 */
export function parseProposalList(data: string): DAOProposal[] {
    // gnodaokit/basedao renders proposals as a markdown table; a page carrying
    // one never also carries GovDAO-style sections, so table rows win outright.
    const tableRows = parseDaokitProposalRows(data)
    if (tableRows.length > 0) return tableRows

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
 * Fetch pages 2..max for a paginated proposals render and parse them.
 * `base` is "" for realms that list proposals on Render("") (GovDAO), or a
 * daokit sub-route ("proposals" / "history"). Follow-up pages are non-strict
 * by long-standing contract: a transient miss skips that page rather than
 * failing the whole list — but `complete: false` reports the skip so callers
 * never CACHE a truncated list as if it were the whole history.
 */
async function fetchRemainingPages(
    rpcUrl: string,
    realmPath: string,
    page1: string,
    base: string,
): Promise<{ rows: DAOProposal[]; complete: boolean }> {
    const rows: DAOProposal[] = []
    let complete = true
    const maxPage = detectMaxPage(page1)
    if (maxPage > 1) {
        const pagePromises: Promise<string | null>[] = []
        for (let p = 2; p <= Math.min(maxPage, 10); p++) {
            pagePromises.push(queryRenderPage(rpcUrl, realmPath, `${base}?page=${p}`))
        }
        for (const pageData of await Promise.all(pagePromises)) {
            if (pageData) rows.push(...parseProposalList(pageData))
            else complete = false
        }
    }
    return { rows, complete }
}

/**
 * Fetch one gnodaokit sub-page ("proposals" or "history") with its pagination.
 * Returns null when the sub-page itself could not be read (route missing or
 * transport failure) — callers must distinguish that from a genuinely empty
 * list, or a transient blip would be CACHED as "0 proposals".
 */
async function fetchDaokitProposalPages(
    rpcUrl: string,
    realmPath: string,
    base: "proposals" | "history",
): Promise<{ rows: DAOProposal[]; complete: boolean } | null> {
    const page1 = await queryRenderPage(rpcUrl, realmPath, base)
    if (!page1) return null
    const rest = await fetchRemainingPages(rpcUrl, realmPath, page1, base)
    return { rows: [...parseProposalList(page1), ...rest.rows], complete: rest.complete }
}

/**
 * Fetch DAO proposals via Render("") markdown parsing.
 * Supports GovDAO v3 format with author, tiers, and basedao format.
 * Automatically handles pagination — fetches all pages to get complete proposal history.
 */
export async function getDAOProposals(
    rpcUrl: string,
    realmPath: string,
    strict = false,
): Promise<DAOProposal[]> {
    // Check cache first
    const cacheKey = `${rpcUrl}:${realmPath}`
    const cached = proposalCache.get(cacheKey)
    if (cached && (Date.now() - cached.ts) < PROPOSAL_CACHE_TTL) {
        return cached.proposals
    }

    // Try the JSON endpoint first (basedao + W1.4 daoTemplate). The probe is
    // deliberately NON-strict even for strict callers: realms that never
    // exported GetProposalsJSON (GovDAO v3, pre-W1.4 deploys) answer it with a
    // VM panic ("name GetProposalsJSON not declared"), and the W2.2 error-aware
    // layer THROWS on that under strict — which broke every GovDAO page before
    // the Render fallback below could run. Strictness (real transport/realm
    // failures must surface, not render as blank) is enforced by the fallback
    // read instead. parseQevalJSON does the correct double-decode of the qeval
    // wire format — a single-pass unescape corrupted backslash/newline-bearing
    // titles.
    const json = await queryEval(rpcUrl, realmPath, `GetProposalsJSON()`, false)
    if (json) {
        const parsed = parseQevalJSON(json)
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

    // GovDAO v3 / basedao: parse Render("") markdown — with pagination
    const page1 = await queryRender(rpcUrl, realmPath, "", strict)
    if (!page1) return []

    // Dedupe by id, sort newest-first, and optionally cache. Partial reads
    // (a daokit sub-page that failed) must NOT be cached: a non-strict caller
    // (e.g. the notifications poll) caching a transiently-empty list would be
    // served to strict callers for 30s as a silent "0 proposals".
    const finalize = (list: DAOProposal[], cacheable: boolean): DAOProposal[] => {
        const seen = new Set<number>()
        const unique = list.filter(p => {
            if (seen.has(p.id)) return false
            seen.add(p.id)
            return true
        })
        unique.sort((a, b) => b.id - a.id)
        if (cacheable) {
            proposalCache.set(cacheKey, { proposals: unique, ts: Date.now() })
        }
        return unique
    }

    if (hasOwnSubpageLink(page1, realmPath, "proposals")) {
        // gnodaokit/basedao (the deployed memba_dao): Render("") is a landing
        // page linking to :proposals / :history — the tables there are
        // authoritative (root-parsed rows on such a realm are landing-page
        // noise, never the list). Sub-reads are non-strict at the transport
        // level; strictness for the PRIMARY (:proposals) read is enforced
        // below, so real failures still surface to strict callers.
        const [active, history] = await Promise.all([
            fetchDaokitProposalPages(rpcUrl, realmPath, "proposals"),
            fetchDaokitProposalPages(rpcUrl, realmPath, "history"),
        ])
        if (active === null) {
            // The realm advertises :proposals but the read failed. If the root
            // itself carried rows (a legacy realm whose description merely
            // links a same-named route), fall back to those — uncached, and
            // keeping whatever the history read DID deliver.
            const rootRows = parseProposalList(page1)
            if (rootRows.length > 0) {
                const rest = await fetchRemainingPages(rpcUrl, realmPath, page1, "")
                return finalize([...rootRows, ...rest.rows, ...(history?.rows ?? [])], false)
            }
            if (strict) throw new Error("Failed to read the DAO's proposals page")
            return finalize(history?.rows ?? [], false)
        }
        return finalize(
            [...active.rows, ...(history?.rows ?? [])],
            active.complete && history !== null && history.complete,
        )
    }

    const proposals = parseProposalList(page1)
    const rest = await fetchRemainingPages(rpcUrl, realmPath, page1, "")
    proposals.push(...rest.rows)
    return finalize(proposals, rest.complete)
}

/**
 * Parse the proposal author from a GovDAO v3 / basedao detail render.
 * Handles a resolved "[@user](url)" link and a bare "g1…" address (GovDAO renders
 * the raw address when the proposer has no registered username — previously dropped).
 */
export function parseProposalAuthor(data: string): { author: string; authorProfile: string } {
    const linked = data.match(/Author:\s*\[@([^\]]+)\]\(([^)]+)\)/)
    if (linked) return { author: `@${linked[1]}`, authorProfile: linked[2] }
    const addr = data.match(/Author:\s*(g1[a-z0-9]+)/)
    if (addr) return { author: addr[1], authorProfile: "" }
    const proposer = data.match(/\*\*Proposer\*\*[:\s]+(g\S+)/i)
    if (proposer) return { author: proposer[1], authorProfile: "" }
    return { author: "", authorProfile: "" }
}

/**
 * Parse voter entries from a single GovDAO v3 vote block. Captures both linked
 * "[@user](url)" voters and bare "g1…" addresses (the old @-link-only regex
 * silently dropped raw addresses, undercounting tallies).
 */
export function parseVoters(voterBlock: string): VoterEntry[] {
    const voters: VoterEntry[] = []
    for (const rawLine of voterBlock.split("\n")) {
        const line = rawLine.trim()
        if (!line.startsWith("-")) continue
        const linked = line.match(/@([^\]]+)\]\(([^)]+)\)/)
        if (linked) {
            voters.push({ username: `@${linked[1]}`, profileUrl: linked[2] })
            continue
        }
        const addr = line.match(/(g1[a-z0-9]+)/)
        if (addr) voters.push({ username: addr[1], profileUrl: "" })
    }
    return voters
}

/**
 * Parse the proposal body from a GovDAO v3 / basedao detail render — excluding the
 * executor-metadata block and the trailing "---" rule that precedes "### Stats" (the
 * old inline regex leaked both into the displayed/analysed description — B3/F-E5).
 */
export function parseProposalDescription(data: string): string {
    const m = data.match(/Author:.*?\n\n([\s\S]+?)(?:\n##|\nTiers|\n-\s+PROPOSAL|\n###\s+Stats|\nThis proposal contains the following metadata:)/m)
        || data.match(/^#.*?\n\n([\s\S]+?)(?:\n\*\*|\n##)/m)
    const body = (m?.[1] || "").trim().replace(/\n*---\s*$/, "").trim()
    return unescapeMarkdown(body)
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
        // Try multiple render path formats (queryRenderPage so a mux "404"
        // body reads as "no such page" and the chain proceeds — the deployed
        // daokit realm answers Render("1") with literal "404" and serves the
        // real page at "proposal/1"):
        // 1. GovDAO v3: just the id number
        // 2. basedao / daokit: "proposal/N"
        // 3. GovDAO with colon: ":N"
        let data = await queryRenderPage(rpcUrl, realmPath, String(id))
        if (!data) {
            data = await queryRenderPage(rpcUrl, realmPath, `proposal/${id}`)
        }
        if (!data) {
            data = await queryRenderPage(rpcUrl, realmPath, `:${id}`)
        }
        if (!data) return null

        // gnodaokit/basedao detail page (deployed ProposalDetailPageView):
        // "## Title - <t> 📜", "## Description 📝", "## Status - Open 🟡",
        // votes as membersThresholdCond counts ("Yes: 1/3 = 33.3%").
        //
        // The trigger is anchored to the very FIRST line of the render — the
        // realm-generated "# <name> - Proposal Detail" header — never to
        // markers inside the body: legacy GovDAO/basedao pages embed the
        // user-authored description verbatim, so a body-marker trigger would
        // let a description divert ANY realm's detail parse into this leg.
        if (/^#\s[^\n]*-\s*Proposal Detail\s*\n/.test(data)) {
            // Field extraction is injection-aware. The deployed layout renders
            // two user-controlled regions — the description, then (after the
            // real Resource section) the action body — with the realm-
            // generated Status / proposer / Votes sections after BOTH. So:
            // - status/proposer take the LAST match (real sections come last);
            // - votes are read ONLY inside the final "## Votes" section;
            // - Resource/action take the FIRST match after the "## Description"
            //   heading, so a block injected into the ACTION BODY (which
            //   renders after the real Resource section) can never displace
            //   the real one. A hostile description can still spoof the
            //   action DISPLAY — the same pre-existing exposure the legacy
            //   basedao leg has always had; the list row's resource column
            //   stays authentic either way.
            const title = data.match(/^##\s+Title\s+-\s+(.+?)\s*(?:📜\s*)?$/m)
            const descHeading = data.match(/^##\s+Description\s+📝\s*$/m)
            const postDesc = descHeading ? data.slice(descHeading.index) : data
            const desc = postDesc.match(/^##\s+Description\s+📝\s*\n\n([\s\S]*?)\n\n##\s+Resource\s+-/m)
            const status = matchLast(data, /^##\s+Status\s+-\s+(\w+)/m)
            const proposer = matchLast(data, />\s*proposed by\s+(g1[a-z0-9]+)/)?.[1] || ""
            const resource = postDesc.match(RESOURCE_RE)
            const action = postDesc.match(ACTION_BODY_RE)
            // Votes: only the realm-generated "## Votes" section (rendered
            // last, after every user-controlled region). A composite and/or
            // condition concatenates one tally block PER sub-condition, and a
            // role-count condition renders counts with no percentage — when
            // the section does not hold exactly one unambiguous tally, counts
            // stay 0 rather than presenting one sub-condition's tally as the
            // proposal's whole vote (P1-8: never render fake vote data).
            const votesHeading = matchLast(data, /^##\s+Votes\s+🗳️\s*$/m)
            const votesRegion = votesHeading ? data.slice(votesHeading.index) : ""
            const yesAll = [...votesRegion.matchAll(/Yes:\s*(\d+)\s*\/\s*\d+(?:\s*=\s*([\d.]+)%)?/g)]
            const pct = (s: string | undefined): number => {
                const v = s ? Math.round(parseFloat(s)) : 0
                return Number.isFinite(v) ? v : 0
            }
            let yesVotes = 0
            let noVotes = 0
            let abstainVotes = 0
            let yesPercent = 0
            let noPercent = 0
            if (yesAll.length === 1) {
                const no = votesRegion.match(/No:\s*(\d+)\s*\/\s*\d+(?:\s*=\s*([\d.]+)%)?/)
                const abstain = votesRegion.match(/Abstain:\s*(\d+)\s*\/\s*\d+/)
                yesVotes = parseInt(yesAll[0][1], 10)
                noVotes = no ? parseInt(no[1], 10) : 0
                abstainVotes = abstain ? parseInt(abstain[1], 10) : 0
                yesPercent = pct(yesAll[0][2])
                noPercent = pct(no?.[2])
            }
            // daokit's detail page renders "Closed" for any terminal
            // not-passed state; the mapping lives here, in the leg that owns
            // that vocabulary, so the shared normalizeStatus funnel stays
            // dialect-neutral (see the note there).
            const rawStatus = status?.[1] || "open"
            const mappedStatus = rawStatus.toLowerCase() === "closed"
                ? "rejected" as const
                : normalizeStatus(rawStatus)
            // The detail page renders no date, but the list rows do — adopt
            // the createdAt from the cached list for this realm so
            // ProposalView shows the same date as the DAOHome card instead of
            // falling back to the tx-search approximation.
            const cachedRow = proposalCache.get(`${rpcUrl}:${realmPath}`)?.proposals.find((p) => p.id === id)
            return {
                id,
                title: unescapeMarkdown(title?.[1]?.trim() || "") || fallbackProposalTitle(id),
                description: unescapeMarkdown((desc?.[1] || "").trim()),
                category: "",
                status: mappedStatus,
                author: proposer,
                authorProfile: "",
                tiers: [],
                yesPercent,
                noPercent,
                yesVotes,
                noVotes,
                abstainVotes,
                totalVoters: yesVotes + noVotes + abstainVotes,
                proposer,
                actionType: resource?.[1]?.trim() || undefined,
                actionBody: action?.[1]?.trim() || undefined,
                createdAt: cachedRow?.createdAt,
            }
        }

        // Parse title
        const titleMatch = data.match(/(?:Prop\s+#\d+\s*-\s*|Proposal\s+#\d+[:\s]+)(.+?)(?:\n|$)/m)
            || data.match(/^#.*?#\d+\s*-\s*(.+?)$/m)
            || data.match(/^##?\s+(?:Prop(?:osal)?\s+#\d+\s*-?\s*)?(.+)$/m)

        // Author — resolved "[@user](url)" or a bare "g1…" address (F-E2)
        const { author, authorProfile } = parseProposalAuthor(data)

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

        // Category
        const categoryMatch = data.match(/Category:\s*(\w+)/i)

        // v2.13: Action metadata — GovDAO v3 format
        // "This proposal contains the following metadata:\n\n...content...\n\nExecutor created in: realm/path"
        const executorMatch = data.match(/This proposal contains the following metadata:\s*\n\n([\s\S]+?)(?:\n\nExecutor created in:\s*(\S+))?\s*\n\n---/m)

        // v2.13: Action metadata — basedao format (regexes shared with the
        // daokit leg above so the two extractions can't drift apart)
        const resourceMatch = data.match(RESOURCE_RE)
        // Action body: specifically after Resource section's "---" separator (basedao only)
        const actionBodyMatch = resourceMatch ? data.match(ACTION_BODY_RE) : null

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
            title: unescapeMarkdown(titleMatch?.[1]?.trim() || "") || fallbackProposalTitle(id),
            description: parseProposalDescription(data),
            category: categoryMatch?.[1]?.toLowerCase() || "",
            status: normalizeStatus(statusMatch?.[1] || "open"),
            author,
            authorProfile,
            tiers: tiersMatch
                ? tiersMatch[1].split(",").map((t) => t.trim()).filter(Boolean)
                : [],
            yesPercent: yesPercentMatch ? parseInt(yesPercentMatch[1], 10) : 0,
            noPercent: noPercentMatch ? parseInt(noPercentMatch[1], 10) : 0,
            yesVotes: yesMatch ? parseInt(yesMatch[1], 10) : 0,
            noVotes: noMatch ? parseInt(noMatch[1], 10) : 0,
            abstainVotes: abstainMatch ? parseInt(abstainMatch[1], 10) : 0,
            totalVoters: 0,
            proposer: author,
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
    // queryRenderPage: on a mux-routed realm the first path answers a literal
    // "404" body, which must not short-circuit the proposal/N/votes fallback
    // (the same 404-truthiness class getProposalDetail had).
    let data = await queryRenderPage(rpcUrl, realmPath, `${id}/votes`)
    if (!data) {
        data = await queryRenderPage(rpcUrl, realmPath, `proposal/${id}/votes`)
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

        // Capture both linked "[@user](url)" voters and bare "g1…" addresses (F-E3).
        const voters = parseVoters(voterBlock)

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
