import { normalizeStatus, type DAOProposal } from './shared'

const safeCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const statuses = new Set(['ACTIVE', 'ACCEPTED', 'REJECTED', 'EXECUTED', 'EXPIRED', 'INVALIDATED'])

/** The generated realm places this complete footer AFTER every user-controlled
 * title/description. End anchoring keeps copies in prose from becoming fields.
 * This must run before the daokit title discriminator: a proposal title itself
 * can end with "- Proposal Detail". No action metadata is exported by this
 * Render format, so Resource/Executor-like prose is never promoted to an action.
 */
export function parseGeneratedProposalDetail(data: string, id: number): DAOProposal | null | undefined {
    const normalized = data.replaceAll('\r\n', '\n')
    const footer = /\n\nAuthor: (g1[a-z0-9]+)\n\nCategory: ([^\n]*)\n\nStatus: ([A-Z]+)\n\nYES: (\d+) \| NO: (\d+) \| ABSTAIN: (\d+)\nTotal Power: (\d+)\/(\d+)\n(?:Membership changed; create a new proposal to collect votes from the current members\.\n)?(?:Voting closes at block: \d+\n(?:\*\*EXPIRED\*\* — voting period has ended\.\n)?)?$/.exec(normalized)
    if (!footer) return undefined
    const header = /^# Prop #(\d+) - ([^\n]*)\n/.exec(normalized)
    if (!header || Number(header[1]) !== id || !statuses.has(footer[3])) return null
    const [yesVotes, noVotes, abstainVotes, castPower, electoratePower] = footer.slice(4, 9).map(Number)
    if (![yesVotes, noVotes, abstainVotes, castPower, electoratePower].every(safeCount)
        || yesVotes + noVotes + abstainVotes !== castPower) return null
    // Immutable templates before electorate snapshots used live totalPower().
    // A past accepted/executed vote may exceed today's smaller membership.
    // Keep the historical record, but do not manufacture an approval percentage.
    const usableDenominator = electoratePower > 0 && castPower <= electoratePower
    return {
        id, title: header[2], description: normalized.slice(header[0].length, footer.index),
        category: footer[2], status: normalizeStatus(footer[3]), author: footer[1], proposer: footer[1],
        authorProfile: '', tiers: [], yesVotes, noVotes, abstainVotes,
        yesPercent: usableDenominator ? Math.round(100 * yesVotes / electoratePower) : 0,
        noPercent: usableDenominator ? Math.round(100 * noVotes / electoratePower) : 0,
        // The footer gives weighted power, never a count of distinct humans.
        totalVoters: 0,
    }
}

/** Decode a fresh template v1.0 GetProposalsJSON array, not the permissive
 * list/cache mapper. The render fallback has already established the template
 * format. Missing IDs and malformed arrays fail closed instead of inventing a
 * detail from an unrelated row. Strings remain literal after qeval decoding.
 */
export function readGeneratedProposalRecord(rows: unknown[], id: number): DAOProposal | null {
    const seen = new Set<number>()
    let found: DAOProposal | null = null
    for (const item of rows) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return null
        const row = item as Record<string, unknown>
        if (!safeCount(row.id) || seen.has(row.id)
            || !['title', 'description', 'category', 'status', 'author'].every(key => typeof row[key] === 'string')
            || !statuses.has(row.status as string)
            || !/^g1[a-z0-9]+$/.test(row.author as string)
            || !['yes_votes', 'no_votes', 'abstain_votes', 'total_power', 'created_at_block'].every(key => safeCount(row[key]))) return null
        seen.add(row.id)
        const yesVotes = row.yes_votes as number
        const noVotes = row.no_votes as number
        const abstainVotes = row.abstain_votes as number
        if (!safeCount(yesVotes + noVotes + abstainVotes) || yesVotes + noVotes + abstainVotes !== row.total_power) return null
        if (row.id !== id) continue
        found = {
            id, title: row.title as string, description: row.description as string,
            category: row.category as string, status: normalizeStatus(row.status as string),
            author: row.author as string, proposer: row.author as string,
            authorProfile: '', tiers: [], yesVotes, noVotes, abstainVotes,
            // v1.0 provides neither electorate denominator nor voter count.
            // Do not combine this response with a different-height Render.
            yesPercent: 0, noPercent: 0, totalVoters: 0,
            createdAtBlock: row.created_at_block as number,
        }
    }
    return found
}
