import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { BlockHeatmap } from "./BlockHeatmap"
import type { BlockSample } from "../../lib/validators"

// The heatmap was `role="grid"` around up to a hundred `role="img"` cells. A grid
// must own rows and cells (and promises arrow-key navigation it never had), and a
// hundred individually labelled images is a hundred stops for a screen reader.
// It is one picture: expose it as one image with a summary worth hearing.

function block(height: number, signerCount: number, valsetSize = 4): BlockSample {
    return {
        height,
        signerCount,
        valsetSize,
        perfect: signerCount === valsetSize,
        healthRatio: signerCount / valsetSize,
        time: "2026-09-13T12:00:00Z",
    }
}

describe("BlockHeatmap — accessible summary", () => {
    it("is one image, not a grid of a hundred", () => {
        render(<BlockHeatmap blocks={[block(100, 4), block(101, 2), block(102, 4)]} loading={false} />)
        expect(screen.getAllByRole("img")).toHaveLength(1)
        expect(screen.queryByRole("grid")).not.toBeInTheDocument()
    })

    it("summarises how many blocks were fully signed and which was weakest", () => {
        render(<BlockHeatmap blocks={[block(100, 4), block(101, 2), block(102, 4)]} loading={false} />)
        expect(screen.getByRole("img")).toHaveAccessibleName(
            "Last 3 blocks: 2 of 3 fully signed. Weakest: block 101, 2 of 4 signatures.",
        )
    })

    it("says so plainly when every block was fully signed", () => {
        render(<BlockHeatmap blocks={[block(100, 4), block(101, 4), block(102, 4)]} loading={false} />)
        expect(screen.getByRole("img")).toHaveAccessibleName("Last 3 blocks: all 3 fully signed.")
    })

    it("names the most recent block when several tie for weakest", () => {
        render(<BlockHeatmap blocks={[block(100, 3), block(101, 3), block(102, 4)]} loading={false} />)
        expect(screen.getByRole("img")).toHaveAccessibleName(
            "Last 3 blocks: 1 of 3 fully signed. Weakest: block 101, 3 of 4 signatures.",
        )
    })

    it("uses the singular for a single block", () => {
        render(<BlockHeatmap blocks={[block(100, 4)]} loading={false} />)
        expect(screen.getByRole("img")).toHaveAccessibleName("Last 1 block: all 1 fully signed.")
    })

    it("while loading with nothing yet, says it is loading — once, not per placeholder", () => {
        render(<BlockHeatmap blocks={[]} loading={true} />)
        expect(screen.getAllByRole("img")).toHaveLength(1)
        expect(screen.getByRole("img")).toHaveAccessibleName("Recent blocks loading")
    })

    it("says there is nothing to show when not loading and empty", () => {
        render(<BlockHeatmap blocks={[]} loading={false} />)
        expect(screen.getByRole("img")).toHaveAccessibleName("No recent blocks to show")
    })

    it("keeps the per-block tooltip for mouse users", () => {
        const { container } = render(<BlockHeatmap blocks={[block(100, 4), block(101, 2)]} loading={false} />)
        // Newest first.
        expect(container.querySelector(".hm-cell")).toHaveAttribute("title", "Block 101: 2/4 signed")
    })

    it("does not announce the refresh pulse on every poll", () => {
        render(<BlockHeatmap blocks={[block(100, 4)]} loading={true} />)
        expect(screen.queryByLabelText("Updating…")).not.toBeInTheDocument()
    })
})
