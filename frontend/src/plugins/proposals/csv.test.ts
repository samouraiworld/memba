import { describe, expect, it } from "vitest"
import { buildProposalsCsv, type ProposalCsvRow } from "./csv"

/** Minimal RFC 4180 reader: returns raw (as written) and decoded fields per record. */
function readCsv(text: string): { raw: string; value: string }[][] {
    const records: { raw: string; value: string }[][] = []
    let record: { raw: string; value: string }[] = []
    let i = 0
    while (i <= text.length) {
        let raw = ""
        let value = ""
        if (text[i] === "\"") {
            const start = i
            i++
            while (i < text.length) {
                if (text[i] === "\"" && text[i + 1] === "\"") { value += "\""; i += 2; continue }
                if (text[i] === "\"") { i++; break }
                value += text[i++]
            }
            raw = text.slice(start, i)
        } else {
            const start = i
            while (i < text.length && text[i] !== "," && text[i] !== "\n") i++
            raw = value = text.slice(start, i)
        }
        record.push({ raw, value })
        if (i >= text.length) { records.push(record); break }
        if (text[i] === "\n") { records.push(record); record = [] }
        i++
    }
    return records
}

const row = (over: Partial<ProposalCsvRow>): ProposalCsvRow => ({
    id: 1, title: "Fund the grant", status: "open", author: "g1aeddlftlfk27ret5rf750d7w5dume3kcsm8r8m",
    yesVotes: 3, noVotes: 1, abstainVotes: 0, yesPercent: 75, noPercent: 25, ...over,
})

const HEADERS = ["ID", "Title", "Status", "Author", "Yes Votes", "No Votes", "Abstain", "Yes %", "No %"]
const NUMERIC = [0, 4, 5, 6, 7, 8]

describe("buildProposalsCsv", () => {
    const hostile = [
        row({ id: 7, title: "=HYPERLINK(\"http://example.invalid\",\"open\")", status: "@SUM(1)", author: "+cmd" }),
        row({ id: 8, title: "-2+3", status: "=1", author: "@alice" }),
        row({ id: 9, title: "\t=1", status: "\r=1", author: "-" }),
        row({ id: 10, title: "Line one\nLine \"two\", with comma", author: "" }),
    ]

    it("produces a header and one record per proposal", () => {
        const records = readCsv(buildProposalsCsv(hostile))
        expect(records).toHaveLength(hostile.length + 1)
        expect(records[0].map((f) => f.value)).toEqual(HEADERS)
        for (const r of records) expect(r).toHaveLength(HEADERS.length)
    })

    it("no decoded field starts with a formula character", () => {
        for (const record of readCsv(buildProposalsCsv(hostile))) {
            for (const field of record) {
                expect(field.value, JSON.stringify(field.value)).not.toMatch(/^[=+\-@\t\r]/)
            }
        }
    })

    it("keeps the text of every string field after the neutralizing quote", () => {
        const records = readCsv(buildProposalsCsv(hostile))
        hostile.forEach((p, k) => {
            const [, title, status, author] = records[k + 1].map((f) => f.value)
            expect(title.replace(/^'/, "")).toBe(p.title)
            expect(status.replace(/^'/, "")).toBe(p.status)
            expect(author.replace(/^'/, "")).toBe(p.author)
        })
    })

    it("quotes every string field, including the header", () => {
        for (const record of readCsv(buildProposalsCsv(hostile))) {
            [1, 2, 3].forEach((c) => expect(record[c].raw.startsWith("\"")).toBe(true))
        }
        readCsv(buildProposalsCsv(hostile))[0].forEach((f) => expect(f.raw.startsWith("\"")).toBe(true))
    })

    it("keeps numeric columns numeric and unquoted", () => {
        const rows = [row({ id: 12, yesVotes: 10, noVotes: 0, abstainVotes: 2, yesPercent: 83, noPercent: 0 })]
        const [, record] = readCsv(buildProposalsCsv(rows))
        for (const c of NUMERIC) {
            expect(record[c].raw).toMatch(/^\d+(\.\d+)?$/)
        }
        expect(NUMERIC.map((c) => Number(record[c].value))).toEqual([12, 10, 0, 2, 83, 0])
    })

    it("returns only the header for no rows", () => {
        expect(readCsv(buildProposalsCsv([]))).toHaveLength(1)
    })
})
