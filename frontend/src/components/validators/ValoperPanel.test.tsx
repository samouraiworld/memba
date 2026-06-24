import { describe, it, expect } from "vitest"
import { screen } from "@testing-library/react"
import { renderWithProviders } from "../../test/test-utils"
import { ValoperPanel } from "./ValoperPanel"
import type { ValoperWithStatus } from "../../lib/valopers"

const SAMPLE: ValoperWithStatus[] = [
    {
        moniker: "gnocore-val-01",
        description: "Core gno.land validator",
        operatorAddress: "g1operator001",
        signingAddress: "g1signing001",
        signingPubKey: "gpub1a",
        serverType: "cloud",
        status: "active",
    },
    {
        moniker: "zxq-val-01",
        description: "",
        operatorAddress: "g1operator002",
        signingAddress: "g1signing002",
        signingPubKey: "gpub1b",
        serverType: "on-prem",
        status: "candidate",
    },
]

describe("ValoperPanel", () => {
    it("lists each valoper with its moniker and live status pill", () => {
        renderWithProviders(<ValoperPanel valopers={SAMPLE} loading={false} />)
        expect(screen.getByText("gnocore-val-01")).toBeInTheDocument()
        expect(screen.getByText("zxq-val-01")).toBeInTheDocument()
        expect(screen.getByText("Active")).toBeInTheDocument()
        expect(screen.getByText("Candidate")).toBeInTheDocument()
    })

    it("shows the server-type label for each valoper", () => {
        renderWithProviders(<ValoperPanel valopers={SAMPLE} loading={false} />)
        expect(screen.getByText("Cloud")).toBeInTheDocument()
        expect(screen.getByText("On-prem")).toBeInTheDocument()
    })

    it("distinguishes operator address from signing address (the onboarding identity model)", () => {
        renderWithProviders(<ValoperPanel valopers={SAMPLE} loading={false} />)
        expect(screen.getAllByText("Operator").length).toBeGreaterThan(0)
        expect(screen.getAllByText("Signing").length).toBeGreaterThan(0)
    })

    it("renders an empty state when there are no valopers and not loading", () => {
        renderWithProviders(<ValoperPanel valopers={[]} loading={false} />)
        expect(screen.getByText(/no valopers registered yet/i)).toBeInTheDocument()
    })
})
