/**
 * ReputationBadge.test.tsx — shared reputation chip (marketplace-v2 Phase 1.5b).
 * Renders rating/level/count from an AUTHORITATIVE reputation object, or a neutral
 * "New seller" when null. Never fabricates a rating.
 */
import { render, screen } from "@testing-library/react"
import { describe, it, expect } from "vitest"
import { ReputationBadge } from "./ReputationBadge"

describe("ReputationBadge", () => {
    it("shows rating, level and count when reputation is present", () => {
        render(<ReputationBadge reputation={{ rating: 4.8, count: 42, level: "Top Rated" }} />)
        expect(screen.getByText(/4\.8/)).toBeInTheDocument()
        expect(screen.getByText(/Top Rated/)).toBeInTheDocument()
        expect(screen.getByText(/\(42\)/)).toBeInTheDocument()
    })

    it("shows a neutral 'New seller' state (no star) when reputation is null", () => {
        render(<ReputationBadge reputation={null} />)
        expect(screen.getByText(/new seller/i)).toBeInTheDocument()
        expect(screen.queryByText(/★/)).not.toBeInTheDocument()
    })
})
