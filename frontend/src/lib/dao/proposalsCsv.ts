/**
 * Proposal list CSV export — pure builder used by the proposals list export
 * button. Text columns (title, status, author) and the header go through
 * csvCell; numeric columns are written as bare numbers.
 */

import { csvCell } from "../csv"
import type { DAOProposal } from "./shared"

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

/** Download proposals as a CSV file named after the DAO's realm. */
export function downloadProposalsCsv(realmPath: string, rows: ProposalCsvRow[]): void {
    const blob = new Blob([buildProposalsCsv(rows)], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${realmPath.split("/").pop() || "dao"}-proposals.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
}
