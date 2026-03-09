/**
 * daoMetadata — Parse DAO Render output for rich directory metadata.
 *
 * Queries Render("") for each DAO to extract:
 * - Description (first non-empty line)
 * - Member count
 * - Proposal count
 * - Active status (has recent proposals based on count > 0)
 *
 * Uses Promise.allSettled with concurrency cap for batch fetching.
 */

import { queryRender } from "./dao/shared"

/** Rich DAO metadata parsed from Render output. */
export interface DAOMetadata {
    path: string
    description: string
    memberCount: number
    proposalCount: number
    isActive: boolean
}

const MAX_CONCURRENT = 10

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

/**
 * Fetch metadata for a single DAO from its Render("") output.
 */
export async function getDAOMetadata(rpcUrl: string, daoPath: string): Promise<DAOMetadata> {
    try {
        const raw = await queryRender(rpcUrl, daoPath, "")
        return parseDAORender(daoPath, raw)
    } catch {
        return parseDAORender(daoPath, null)
    }
}

/**
 * Batch fetch metadata for multiple DAOs.
 * Caps at MAX_CONCURRENT to avoid RPC abuse.
 */
export async function batchGetDAOMetadata(
    rpcUrl: string,
    daoPaths: string[],
): Promise<Map<string, DAOMetadata>> {
    const results = new Map<string, DAOMetadata>()
    const capped = daoPaths.slice(0, MAX_CONCURRENT)

    const settled = await Promise.allSettled(
        capped.map(path => getDAOMetadata(rpcUrl, path)),
    )

    for (const result of settled) {
        if (result.status === "fulfilled") {
            results.set(result.value.path, result.value)
        }
    }

    return results
}
