/**
 * Proposal Explorer CSV export — pure builder used by the plugin's export
 * button. Text columns (title, status, author) and the header go through
 * csvCell; numeric columns are written as bare numbers.
 */

import { csvCell } from "../../lib/csv"
import type { DAOProposal } from "../../lib/dao"

export type ProposalCsvRow = Pick<DAOProposal, "id" | "title" | "status" | "author" | "yesVotes" | "noVotes" | "abstainVotes" | "yesPercent" | "noPercent">

const HEADERS = ["ID", "Title", "Status", "Author", "Yes Votes", "No Votes", "Abstain", "Yes %", "No %"]

/** A numeric cell: the number itself, or empty when it is not a finite number. */
function numberCell(value: number): string {
    return Number.isFinite(value) ? String(value) : ""
}

export function buildProposalsCsv(rows: ProposalCsvRow[]): string {
    const lines = rows.map(p => [
        numberCell(p.id),
        csvCell(p.title ?? ""),
        csvCell(p.status ?? ""),
        csvCell(p.author || ""),
        numberCell(p.yesVotes),
        numberCell(p.noVotes),
        numberCell(p.abstainVotes),
        numberCell(p.yesPercent),
        numberCell(p.noPercent),
    ].join(","))
    return [HEADERS.map(csvCell).join(","), ...lines].join("\n")
}
