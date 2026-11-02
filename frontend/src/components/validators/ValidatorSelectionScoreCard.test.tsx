import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { ValidatorSelectionScoreCard } from "./ValidatorSelectionScoreCard"
import type { SelectionScoreEdition, SelectionScoreEntry } from "../../lib/validatorSelectionScores"

const OPERATOR = "g1n9y62agq998jt8w59az60xcqlftjknjg2grhn4"
const REALM_URL = "https://gno.land/r/samcrew/validator_scores"
const TITLE = "Selection score (testnets)"

// The contract's own example (spec, "JSON shapes"): AviaOne at 87.43, rank 3.
const AVIAONE: SelectionScoreEntry = {
    operator: OPERATOR, moniker: "AviaOne", total: 8743, rank: 3, github: 230, arenaScores: [9000, 8500, 8000, 9100, 8800, 7500],
}

function edition(entries: SelectionScoreEntry[] = [AVIAONE]): SelectionScoreEdition {
    return {
        number: 1, computedAt: "2026-10-13T09:00:00Z", scorecardSHA256: "ab".repeat(32),
        arenas: ["challenge", "test13", "topaz", "sapphire", "pearl", "firedrill"],
        candidates: new Map(entries.map((e): [string, SelectionScoreEntry] => [e.operator, e])),
    }
}

function renderCard(ed: SelectionScoreEdition | null | undefined, operatorAddress = OPERATOR) {
    return render(<ValidatorSelectionScoreCard edition={ed} operatorAddress={operatorAddress} realmUrl={REALM_URL} />)
}

/** The card's figures, label → value, in order. */
function figures(): Array<[string, string]> {
    const card = screen.getByRole("region", { name: TITLE })
    return [...card.querySelectorAll("dt")].map((dt) => [dt.textContent ?? "", dt.nextElementSibling?.textContent ?? ""])
}

describe("ValidatorSelectionScoreCard", () => {
    it("shows the total, the rank, every arena and the GitHub bonus, one decimal each", () => {
        renderCard(edition())
        expect(figures()).toEqual([
            ["Total", "87.4"], ["Rank", "3"],
            ["Challenge", "90.0"], ["Test13", "85.0"], ["Topaz", "80.0"], ["Sapphire", "91.0"], ["Pearl", "88.0"], ["Fire drill", "75.0"],
            ["GitHub bonus", "2.3"],
        ])
    })

    it("names the edition and its date, says what the score is, and links to the on-chain record", () => {
        renderCard(edition())
        expect(screen.getByText("Edition 1 · computed 13 Oct 2026")).toBeInTheDocument()
        expect(screen.getByText(/computed by gno-score-validator from their results on the gno\.land testnets/)).toBeInTheDocument()
        const link = screen.getByRole("link", { name: "View the on-chain record ↗" })
        expect(link).toHaveAttribute("href", REALM_URL)
        expect(link).toHaveAttribute("target", "_blank")
        expect(link).toHaveAttribute("rel", "noopener noreferrer")
    })

    it("finds the operator whatever the case of its address", () => {
        renderCard(edition(), OPERATOR.toUpperCase())
        expect(screen.getByRole("region", { name: TITLE })).toBeInTheDocument()
    })

    it("renders nothing while unread, without an edition, or without an entry for this operator", () => {
        const other = { ...AVIAONE, operator: `g1${"c".repeat(38)}` }
        for (const ed of [undefined, null, edition([]), edition([other])]) {
            const { container, unmount } = renderCard(ed)
            expect(container).toBeEmptyDOMElement()
            unmount()
        }
    })
})
