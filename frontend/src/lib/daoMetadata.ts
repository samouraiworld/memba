/**
 * daoMetadata — Parse DAO Render output for rich directory metadata.
 *
 * Extracts from a realm's Render("") body:
 * - Description (first non-empty line)
 * - Member count
 * - Proposal count
 * - Active status (has recent proposals based on count > 0)
 *
 * W3.2: the Directory▸DAOs tab used to fetch these via a dedicated per-DAO
 * fan-out (batchGetDAOMetadata). That fan-out was removed — `useResolvedDirectoryDaos`
 * now resolves and parses metadata from a single cached Render("") per DAO, so
 * this module is just the pure parser plus the `parseDAORender` reuse point
 * (useNotifications also parses proposal counts from a render it already holds).
 */

/** Rich DAO metadata parsed from Render output. */
export interface DAOMetadata {
    path: string
    description: string
    memberCount: number
    proposalCount: number
    isActive: boolean
}

/**
 * Parse Render("") output for a single DAO.
 * Returns structured metadata or defaults on parse failure.
 */
export function parseDAORender(path: string, raw: string | null): DAOMetadata {
    const defaults: DAOMetadata = {
        path,
        description: "",
        memberCount: 0,
        proposalCount: 0,
        isActive: false,
    }

    if (!raw) return defaults

    const lines = raw.split("\n").map(l => l.trim()).filter(Boolean)

    // Description: first non-heading, non-separator line
    const descLine = lines.find(l =>
        !l.startsWith("#") &&
        !l.startsWith("|") &&
        !l.startsWith("---") &&
        !l.startsWith("*") &&
        l.length > 5,
    )
    if (descLine) defaults.description = descLine.slice(0, 200)

    // Member count: "Members: N" or line-start "N member(s)" (I3 fix: anchored to reduce false matches)
    const memberMatch = raw.match(/members?:\s*(\d+)/i) || raw.match(/^\s*(\d+)\s+members?\b/im)
    if (memberMatch) defaults.memberCount = parseInt(memberMatch[1], 10)

    // Proposal count: "Proposals: N" or line-start "N proposal(s)" (I3 fix: anchored)
    const proposalMatch = raw.match(/proposals?:\s*(\d+)/i) || raw.match(/^\s*(\d+)\s+proposals?\b/im)
    if (proposalMatch) {
        defaults.proposalCount = parseInt(proposalMatch[1], 10)
        defaults.isActive = defaults.proposalCount > 0
    }

    return defaults
}
