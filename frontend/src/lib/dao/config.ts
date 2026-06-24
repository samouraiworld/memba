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
 * Extract the governance threshold (e.g. "66%") from a DAO render containing a
 * voting condition. Handles GovDAO's "Threshold: X%"/"Quorum: X%" and the
 * basedao/daocond condition formats ("X% of members", "X% of total voting power",
 * "Threshold needed: X%"). Returns "" when no threshold is present — callers must
 * render "—" rather than fabricate a default (basedao's own default is 60%, which
 * is wrong for any DAO that overrides it, e.g. memba_dao at 66%).
 */
export function parseDaoThreshold(render: string): string {
    if (!render) return ""
    const m =
        render.match(/(?:Threshold(?:\s+needed)?|Quorum)[:\s]+(\d+(?:\.\d+)?)%/i) ||
        render.match(/(\d+(?:\.\d+)?)%\s+of\s+(?:members|total voting power)/i)
    return m ? `${m[1]}%` : ""
}

/**
 * Fetch DAO overview via Render("").
 * Supports GovDAO v3 and basedao formats.
 */
export async function getDAOConfig(
    rpcUrl: string,
    realmPath: string,
    strict = false,
): Promise<DAOConfig | null> {
    // strict=true surfaces an all-RPC-down failure (throws) instead of returning
    // null, so a failed read shows an error+retry rather than a blank DAO (FE-2).
    const data = await queryRender(rpcUrl, realmPath, "", strict)
    if (!data) return null

    // Try GovDAO v3 format first: "# GovDAO" + memberstore link
    const nameMatch = data.match(/^#\s+(.+)$/m)
    const membersMatch = data.match(/##\s+Members\s*(?:\((\d+)\))?/)

    // Description: text between # title and ## section, excluding memberstore links
    let description = ""
    const descMatch = data.match(/^#\s+.+\n+([\s\S]*?)(?:\n##)/m)
    if (descMatch) {
        // Filter out memberstore link lines and empty lines
        const descLines = descMatch[1].split("\n")
            .filter((l) => !l.includes("Memberstore") && !l.includes("memberstore")
                && !l.match(/^#{0,4}\s*Members/i) && l.trim() !== "")
        description = descLines.join("\n").trim()
        // R1: Strip any residual markdown heading markers from description
        description = description.replace(/^#+\s+/gm, '').trim()
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
        name: (nameMatch?.[1]?.trim() || "Unnamed DAO").replace(/^#+\s*/, ''),
        description,
        // GovDAO surfaces the threshold in Render(""); basedao does not (it's on
        // the config page — see getDAOThreshold). "" → callers render "—".
        threshold: parseDaoThreshold(data),
        memberCount: totalMembers,
        memberstorePath,
        tierDistribution,
        isArchived,
    }
}

/**
 * Resolve a DAO's real governance threshold from its config-page render
 * (`Render("config")`), where basedao surfaces the voting condition — the home
 * `Render("")` only links to the config page, so getDAOConfig can't see it. Kept
 * out of getDAOConfig to avoid an extra render on its many hot-path callers;
 * called only where the threshold is displayed (the DAO list). Returns "" on any
 * failure or when absent — callers show "—", never a fabricated default.
 */
export async function getDAOThreshold(rpcUrl: string, realmPath: string): Promise<string> {
    try {
        const data = await queryRender(rpcUrl, realmPath, "config")
        return parseDaoThreshold(data || "")
    } catch {
        return ""
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
