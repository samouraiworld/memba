import { screen } from "@testing-library/react"
import { describe, it, expect } from "vitest"
import { AppReviewStars, MIN_RATED_COUNT } from "./AppReviewStars"
import { renderWithProviders } from "../../test/test-utils"

describe("AppReviewStars", () => {
    it("shows a neutral empty state with no rating when there are no reviews", () => {
        renderWithProviders(<AppReviewStars count={0} average={0} />)
        expect(screen.getByText(/no reviews yet/i)).toBeInTheDocument()
        // No misleading star average / numeric score when there's nothing to average.
        expect(screen.queryByTestId("app-review-stars-average")).not.toBeInTheDocument()
    })

    it("suppresses the headline average when the sample is too small (< MIN_RATED_COUNT)", () => {
        renderWithProviders(<AppReviewStars count={2} average={5} />)
        // Integrity: 1–2 reviews must not present as a confident 5.0.
        expect(screen.queryByTestId("app-review-stars-average")).not.toBeInTheDocument()
        expect(screen.getByText(/2 reviews/i)).toBeInTheDocument()
        expect(screen.getByText(/new/i)).toBeInTheDocument()
    })

    it("MIN_RATED_COUNT is 3 (the smallest sample we'll show an average for)", () => {
        expect(MIN_RATED_COUNT).toBe(3)
    })

    it("shows the star average + count once the sample is large enough", () => {
        renderWithProviders(<AppReviewStars count={5} average={4.24} />)
        const avg = screen.getByTestId("app-review-stars-average")
        expect(avg).toHaveTextContent("4.2") // one decimal
        expect(screen.getByText(/5 reviews/i)).toBeInTheDocument()
    })

    it("uses the singular noun for exactly one review", () => {
        renderWithProviders(<AppReviewStars count={1} average={5} />)
        expect(screen.getByText(/1 review\b/i)).toBeInTheDocument()
        expect(screen.queryByText(/1 reviews/i)).not.toBeInTheDocument()
    })
})
