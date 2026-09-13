/**
 * GovernanceReadinessPanel — the read-only replacement for a rejected
 * "propose ejection" UI. These tests pin its guardrails as much as its layout:
 * it must never offer an action, and it must never turn "we could not read
 * membership" into "zero members".
 */

import { describe, it, expect } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { GovernanceReadinessPanel } from "./GovernanceReadinessPanel"
import { buildGovernanceReadiness } from "../../lib/governanceReadiness"
import type { TierInfo } from "../../lib/dao/shared"

const LIVE_TIERS: TierInfo[] = [
    { tier: "T1", memberCount: 1, power: 3 },
    { tier: "T2", memberCount: 0, power: 0 },
    { tier: "T3", memberCount: 0, power: 0 },
]
const live = (over: Partial<Parameters<typeof buildGovernanceReadiness>[0]> = {}) =>
    buildGovernanceReadiness({ tiers: LIVE_TIERS, votingPowers: [60, 60, 60, 60], ...over })

describe("GovernanceReadinessPanel", () => {
    it("is a named region so screen readers can find it", () => {
        render(<GovernanceReadinessPanel readiness={live()} membershipLoading={false} />)
        expect(screen.getByRole("region", { name: /governance readiness/i })).toBeInTheDocument()
    })

    it("states who can act on the live chain: a single GovDAO member", () => {
        render(<GovernanceReadinessPanel readiness={live()} membershipLoading={false} />)
        expect(screen.getByText("1 GovDAO member")).toBeInTheDocument()
        expect(screen.getByText(/only GovDAO members can create one/i)).toBeInTheDocument()
        expect(screen.getByText(/single member can currently create and pass/i)).toBeInTheDocument()
    })

    it("shows current failure tolerance for the live 4 x 60 set", () => {
        render(<GovernanceReadinessPanel readiness={live()} membershipLoading={false} />)
        const region = screen.getByRole("region", { name: /governance readiness/i })
        expect(within(region).getByText("161 of 240")).toBeInTheDocument()
        expect(within(region).getByText("1 validator")).toBeInTheDocument()
    })

    it("spells out that losing the largest validator would leave zero tolerance", () => {
        render(<GovernanceReadinessPanel readiness={live()} membershipLoading={false} />)
        const whatIf = screen.getByText(/if the largest validator went offline or were removed/i)
        expect(whatIf).toHaveTextContent(/3 validators, quorum 121 of 180/i)
        // The consequence is stated in WORDS, not only as a colour.
        expect(whatIf).toHaveTextContent(/any single remaining validator could then halt consensus/i)
    })

    it("does not cry halt when the reduced set would still tolerate a failure", () => {
        render(<GovernanceReadinessPanel readiness={live({ votingPowers: [60, 60, 60, 60, 60, 60, 60] })} membershipLoading={false} />)
        const whatIf = screen.getByText(/if the largest validator went offline or were removed/i)
        expect(whatIf).not.toHaveTextContent(/could then halt consensus/i)
    })

    it("says membership is being read while it loads — and still shows tolerance", () => {
        render(<GovernanceReadinessPanel readiness={live({ tiers: null })} membershipLoading={true} />)
        expect(screen.getByText(/reading GovDAO membership/i)).toBeInTheDocument()
        expect(screen.getByText("161 of 240")).toBeInTheDocument()
    })

    it("reports unreadable membership as unknown, never as zero members", () => {
        render(<GovernanceReadinessPanel readiness={live({ tiers: null })} membershipLoading={false} />)
        expect(screen.getByText(/couldn't be read from the chain/i)).toBeInTheDocument()
        expect(screen.queryByText(/0 GovDAO members/i)).not.toBeInTheDocument()
    })

    it("handles an empty validator set without a what-if", () => {
        render(<GovernanceReadinessPanel readiness={live({ votingPowers: [] })} membershipLoading={false} />)
        expect(screen.getByText(/no active validators reported/i)).toBeInTheDocument()
        expect(screen.queryByText(/if the largest validator/i)).not.toBeInTheDocument()
    })

    it("offers no action of any kind — it informs, it never prompts", () => {
        // Guardrail from the security and UX reviews: detection may explain, it
        // must never become a button, link or call to act against a validator.
        const { container } = render(<GovernanceReadinessPanel readiness={live()} membershipLoading={false} />)
        expect(screen.queryAllByRole("button")).toHaveLength(0)
        expect(container.querySelectorAll("a, form, input, select")).toHaveLength(0)
    })
})
