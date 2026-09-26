import { describe, it, expect } from "vitest"
import { screen, within } from "@testing-library/react"
import { Routes, Route } from "react-router-dom"
import { renderWithProviders } from "../../test/test-utils"
import { ComingSoonGate } from "./ComingSoonGate"

describe("Coming soon previews", () => {
    it.each(["marketplace", "workspace", "reputation", "game", "feed"] as const)("keeps the %s illustration labelled and non-interactive", preview => {
        renderWithProviders(<Routes><Route path="/:network/*" element={<ComingSoonGate title="Upcoming feature" icon="◇" description="A planned feature." features={["Explore your workspace"]} preview={preview} />} /></Routes>, { route: "/mainnet/marketplace" })
        const figure = screen.getByRole("figure", { name: "Upcoming feature design preview" })
        expect(within(figure).getByText("Illustrative · not live")).toBeInTheDocument()
        expect(within(figure).getByText("Illustrative preview")).toBeInTheDocument()
        expect(within(figure).getByText(/does not show live controls/)).toBeInTheDocument()
        expect(figure.querySelectorAll('a, button, input, select, textarea, [tabindex]')).toHaveLength(0)
        expect(screen.getByRole("link", { name: "Back to Home" })).toHaveAttribute("href", "/mainnet/")
    })
})
