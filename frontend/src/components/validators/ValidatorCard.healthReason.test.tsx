/**
 * ValidatorCard — the health REASON must be reachable on a phone.
 *
 * The card showed a red "Down" badge and put the evidence — why it is down — in
 * a `title=` attribute, which a touch screen can never reveal. The card is only
 * rendered on mobile, so for its entire audience the accusation was visible and
 * the explanation was not. The link's aria-label also overrode everything inside
 * it, so screen-reader users heard neither the state nor the reason.
 *
 * Uses the REAL health helpers (no mock), so labels match production.
 */

import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, test } from "vitest"
import { ValidatorCard } from "./ValidatorCard"
import { ValidatorHealthStatus, healthLabel } from "../../lib/validatorHealth"

const base = {
    rank: 2,
    address: "g1hqhetnnz0raw5hps6yxexl7q09a6f8w3anlptt",
    gnoAddr: "g1hqhetnnz0raw5hps6yxexl7q09a6f8w3anlptt",
    moniker: "onbloc-validator-1",
    pubkeyType: "tendermint/PubKeyEd25519",
    votingPower: 60,
    powerPercent: 25,
    operationTime: 1,
    startTime: "",
    uptimePercent: 53.5,
    lastBlockSignatures: [],
}

function renderCard(status: ValidatorHealthStatus, reason: string) {
    const v = { ...base, healthStatus: status, healthMeta: { status, reason, latestIncidentSeverity: null, latestIncidentTime: null } }
    return render(
        <MemoryRouter>
            <ValidatorCard v={v as never} hasMonitoring to="/mainnet/validators/g1hq" />
        </MemoryRouter>,
    )
}

describe("ValidatorCard — health reason", () => {
    test("a Down card shows WHY it is down as visible text", () => {
        renderCard(ValidatorHealthStatus.Down, "Uptime 53.5% (below 90%)")
        expect(screen.getByText("Uptime 53.5% (below 90%)")).toBeVisible()
    })

    test("a Degraded card shows its reason too", () => {
        renderCard(ValidatorHealthStatus.Degraded, "2 recent blocks missed")
        expect(screen.getByText("2 recent blocks missed")).toBeInTheDocument()
    })

    test("a Healthy card stays calm — no reason line", () => {
        const { container } = renderCard(ValidatorHealthStatus.Healthy, "All signals nominal")
        expect(container.querySelector(".val-card__reason")).toBeNull()
        expect(screen.queryByText("All signals nominal")).toBeNull()
    })

    test("an Unknown card adds no reason line", () => {
        const { container } = renderCard(ValidatorHealthStatus.Unknown, "No monitoring data available")
        expect(container.querySelector(".val-card__reason")).toBeNull()
    })

    test("screen readers hear the health state and the reason in the link name", () => {
        renderCard(ValidatorHealthStatus.Down, "Uptime 53.5% (below 90%)")
        const label = healthLabel(ValidatorHealthStatus.Down)
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        expect(screen.getByRole("link", { name: new RegExp(`onbloc-validator-1.*${escaped}.*Uptime 53\\.5% \\(below 90%\\)`) })).toBeInTheDocument()
    })

    test("a Healthy link still names its state, without a reason", () => {
        renderCard(ValidatorHealthStatus.Healthy, "All signals nominal")
        const label = healthLabel(ValidatorHealthStatus.Healthy)
        const link = screen.getByRole("link")
        expect(link).toHaveAccessibleName(expect.stringContaining(label))
        expect(link).not.toHaveAccessibleName(expect.stringContaining("nominal"))
    })

    test("the badge no longer hides the reason in an unreachable tooltip", () => {
        const { container } = renderCard(ValidatorHealthStatus.Down, "Uptime 53.5% (below 90%)")
        expect(container.querySelector(".val-health-badge")!.hasAttribute("title")).toBe(false)
    })
})
