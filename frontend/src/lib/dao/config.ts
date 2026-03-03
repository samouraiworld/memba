/**
 * DAO config — ABCI query helpers for DAO overview and tier distribution.
 *
 * See: gno.land/r/gov/dao, gno.land/p/samcrew/basedao
 */

import { queryRender, queryEval, type DAOConfig, type TierInfo } from "./shared"

/**
 * Parse tier distribution from memberstore render output.
 * Format: "Tier T1 contains 11 members with power: 33"
 */
export function parseMemberstoreTiers(data: string): TierInfo[] {
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
    const thresholdMatch = data.match(/(?:Threshold|Quorum)[:\s]+(\d+%)/i)
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

    // Check archive status (basedao/Memba DAOs only — GovDAO has no Archive)
    let isArchived = false
    if (!memberstorePath) {
        try {
            const archiveResult = await queryEval(rpcUrl, realmPath, `IsArchived()`)
            if (archiveResult) {
                isArchived = archiveResult.includes("true")
            }
        } catch { /* not a Memba DAO or function doesn't exist */ }
    }

    return {
        name: nameMatch?.[1]?.trim() || "Unnamed DAO",
        description,
        threshold: thresholdMatch?.[1] || "60%",
        memberCount: totalMembers,
        memberstorePath,
        tierDistribution,
        isArchived,
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
    return parseMemberstoreTiers(data)
}
