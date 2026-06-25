import { describe, it, expect } from "vitest"
import { screen, within } from "@testing-library/react"
import { renderWithProviders } from "../../test/test-utils"
import { ValoperPanel } from "./ValoperPanel"
import type { ValoperWithStatus } from "../../lib/valopers"

function valoper(
    over: Partial<ValoperWithStatus> &
        Pick<ValoperWithStatus, "moniker" | "operatorAddress" | "status">,
): ValoperWithStatus {
    return {
        description: "",
        signingAddress: "",
        signingPubKey: "",
        serverType: "",
        ...over,
    }
}

// 2 active + 3 candidates, deliberately out of alphabetical order so we also
// exercise the per-section sort.
const MIXED: ValoperWithStatus[] = [
    valoper({ moniker: "zeta-active", operatorAddress: "g1act002", signingAddress: "g1sig002", status: "active", serverType: "cloud", description: "Zeta core validator" }),
    valoper({ moniker: "alpha-active", operatorAddress: "g1act001", signingAddress: "g1sig001", status: "active", serverType: "on-prem" }),
    valoper({ moniker: "yankee-cand", operatorAddress: "g1can003", signingAddress: "g1sig003", status: "candidate" }),
    valoper({ moniker: "bravo-cand", operatorAddress: "g1can001", signingAddress: "g1sig001b", status: "candidate", serverType: "data-center" }),
    valoper({ moniker: "mike-cand", operatorAddress: "g1can002", status: "candidate" }),
]

const ALL_ACTIVE: ValoperWithStatus[] = [
    valoper({ moniker: "active-one", operatorAddress: "g1a1", signingAddress: "g1s1", status: "active" }),
    valoper({ moniker: "active-two", operatorAddress: "g1a2", signingAddress: "g1s2", status: "active" }),
]

const ALL_CANDIDATE: ValoperWithStatus[] = [
    valoper({ moniker: "cand-one", operatorAddress: "g1c1", status: "candidate" }),
    valoper({ moniker: "cand-two", operatorAddress: "g1c2", status: "candidate" }),
]

// testids the component exposes so tests can scope queries to one section's
// container — that scoping is how we prove the two lists are truly isolated.
const ACTIVE_SECTION = "valoper-section-active"
const CANDIDATE_SECTION = "valoper-section-candidate"

function monikersIn(testId: string): (string | null)[] {
    return within(screen.getByTestId(testId))
        .getAllByTestId("valoper-card")
        .map(c => within(c).getByTestId("valoper-card-moniker").textContent)
}

describe("ValoperPanel — candidate / active split", () => {
    it("renders two separate sections with the right headings and counts", () => {
        renderWithProviders(<ValoperPanel valopers={MIXED} loading={false} />)

        const active = screen.getByTestId(ACTIVE_SECTION)
        const candidates = screen.getByTestId(CANDIDATE_SECTION)

        // Headings.
        expect(within(active).getByText(/active validator operators/i)).toBeInTheDocument()
        expect(within(candidates).getByRole("heading", { name: /candidates/i })).toBeInTheDocument()

        // Per-section counts (2 active, 3 candidates).
        expect(within(active).getByText("2")).toBeInTheDocument()
        expect(within(candidates).getByText("3")).toBeInTheDocument()
    })

    it("isolates candidate cards from the active section (and vice-versa)", () => {
        renderWithProviders(<ValoperPanel valopers={MIXED} loading={false} />)

        const active = screen.getByTestId(ACTIVE_SECTION)
        const candidates = screen.getByTestId(CANDIDATE_SECTION)

        // Active monikers live ONLY under the active section.
        expect(within(active).getByText("alpha-active")).toBeInTheDocument()
        expect(within(active).getByText("zeta-active")).toBeInTheDocument()
        expect(within(active).queryByText("bravo-cand")).toBeNull()
        expect(within(active).queryByText("mike-cand")).toBeNull()
        expect(within(active).queryByText("yankee-cand")).toBeNull()

        // Candidate monikers live ONLY under the candidates section.
        expect(within(candidates).getByText("bravo-cand")).toBeInTheDocument()
        expect(within(candidates).getByText("mike-cand")).toBeInTheDocument()
        expect(within(candidates).getByText("yankee-cand")).toBeInTheDocument()
        expect(within(candidates).queryByText("alpha-active")).toBeNull()
        expect(within(candidates).queryByText("zeta-active")).toBeNull()
    })

    it("sorts each section alphabetically by moniker", () => {
        renderWithProviders(<ValoperPanel valopers={MIXED} loading={false} />)

        expect(monikersIn(ACTIVE_SECTION)).toEqual(["alpha-active", "zeta-active"])
        expect(monikersIn(CANDIDATE_SECTION)).toEqual(["bravo-cand", "mike-cand", "yankee-cand"])
    })

    it("explains what a candidate is (not yet in the consensus set)", () => {
        renderWithProviders(<ValoperPanel valopers={MIXED} loading={false} />)
        const candidates = screen.getByTestId(CANDIDATE_SECTION)
        expect(within(candidates).getByText(/not yet in the consensus set/i)).toBeInTheDocument()
    })

    it("all-active input → active cards present, no candidates section", () => {
        renderWithProviders(<ValoperPanel valopers={ALL_ACTIVE} loading={false} />)

        const active = screen.getByTestId(ACTIVE_SECTION)
        expect(within(active).getByText("active-one")).toBeInTheDocument()
        expect(within(active).getByText("active-two")).toBeInTheDocument()

        // No candidate section anywhere.
        expect(screen.queryByTestId(CANDIDATE_SECTION)).toBeNull()
    })

    it("all-candidate input → candidates section present, no active section", () => {
        renderWithProviders(<ValoperPanel valopers={ALL_CANDIDATE} loading={false} />)

        const candidates = screen.getByTestId(CANDIDATE_SECTION)
        expect(within(candidates).getByText("cand-one")).toBeInTheDocument()
        expect(within(candidates).getByText("cand-two")).toBeInTheDocument()

        // No active section.
        expect(screen.queryByTestId(ACTIVE_SECTION)).toBeNull()
    })
})

describe("ValoperPanel — preserved behaviour", () => {
    it("keeps the top summary line with active + candidate counts", () => {
        renderWithProviders(<ValoperPanel valopers={MIXED} loading={false} />)
        expect(
            screen.getByText(/registered validator operators · 2 active · 3 candidates/i),
        ).toBeInTheDocument()
    })

    it("keeps the Become a validator CTA", () => {
        renderWithProviders(<ValoperPanel valopers={MIXED} loading={false} />)
        expect(screen.getByRole("link", { name: /become a validator/i })).toBeInTheDocument()
    })

    it("shows the server-type label for each valoper", () => {
        renderWithProviders(<ValoperPanel valopers={MIXED} loading={false} />)
        expect(screen.getByText("Cloud")).toBeInTheDocument()
        expect(screen.getByText("On-prem")).toBeInTheDocument()
        expect(screen.getByText("Data center")).toBeInTheDocument()
    })

    it("distinguishes operator address from signing address (the onboarding identity model)", () => {
        renderWithProviders(<ValoperPanel valopers={MIXED} loading={false} />)
        expect(screen.getAllByText("Operator").length).toBeGreaterThan(0)
        expect(screen.getAllByText("Signing").length).toBeGreaterThan(0)
    })

    it("keeps each card a keyboard-reachable button (a11y)", () => {
        renderWithProviders(<ValoperPanel valopers={MIXED} loading={false} />)
        const cards = screen.getAllByTestId("valoper-card")
        expect(cards.length).toBe(MIXED.length)
        cards.forEach(card => {
            expect(card).toHaveAttribute("role", "button")
            expect(card).toHaveAttribute("tabindex", "0")
        })
    })

    it("links valoper profiles to a test13 gnoweb host, never mainnet gno.land (regression)", () => {
        renderWithProviders(<ValoperPanel valopers={MIXED} loading={false} />)
        const valoperLinks = screen
            .getAllByRole("link")
            .filter(a => (a.getAttribute("href") || "").includes("/r/gnops/valopers:"))
        expect(valoperLinks.length).toBe(MIXED.length)
        valoperLinks.forEach(a => {
            expect(a.getAttribute("href") || "").not.toMatch(/\/\/gno\.land\//)
        })
    })

    it("renders an empty state when there are no valopers and not loading", () => {
        renderWithProviders(<ValoperPanel valopers={[]} loading={false} />)
        expect(screen.getByText(/no valopers registered yet/i)).toBeInTheDocument()
        expect(screen.queryByTestId(ACTIVE_SECTION)).toBeNull()
        expect(screen.queryByTestId(CANDIDATE_SECTION)).toBeNull()
    })

    it("shows the loading hint when empty and loading, with no empty-state text", () => {
        renderWithProviders(<ValoperPanel valopers={[]} loading={true} />)
        expect(screen.getByText(/loading/i)).toBeInTheDocument()
        expect(screen.queryByText(/no valopers registered yet/i)).toBeNull()
    })
})
