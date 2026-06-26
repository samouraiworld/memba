import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen, waitFor, fireEvent } from "@testing-library/react"
import { Route, Routes, useLocation } from "react-router-dom"
import { renderWithProviders } from "../test/test-utils"
import type { ValidatorInfo } from "../lib/validators"
import type { ValoperWithStatus } from "../lib/valopers"

// Keep resolveValidatorProfile + types REAL (pure); only stub the network fetch.
vi.mock("../lib/valopers", async (orig) => ({
    ...(await orig<typeof import("../lib/valopers")>()),
    fetchValopers: vi.fn(),
}))
vi.mock("../lib/validators", async (orig) => ({
    ...(await orig<typeof import("../lib/validators")>()),
    getValidators: vi.fn(),
}))
vi.mock("../lib/profile", () => ({ fetchUserProfile: vi.fn().mockResolvedValue(null) }))
vi.mock("../hooks/useAddressActivity", () => ({
    useAddressActivity: () => ({ items: [], loading: false, error: false, available: false, refetch: vi.fn() }),
}))
vi.mock("../lib/quests", async (orig) => ({
    ...(await orig<typeof import("../lib/quests")>()),
    loadQuestProgress: () => ({ completed: [], totalXP: 0 }),
    fetchUserQuests: vi.fn().mockResolvedValue(null),
    completeQuest: vi.fn(),
    trackPageVisit: vi.fn(),
}))
// The Performance panel does its own fetching; stub it and surface its props.
vi.mock("../components/validators/ValidatorPerformancePanel", () => ({
    ValidatorPerformancePanel: ({ signingAddress, isActive }: { signingAddress: string; isActive: boolean }) =>
        <div data-testid="perf-panel" data-active={String(isActive)} data-addr={signingAddress} />,
}))
vi.mock("../components/validators/ValoperEditDialog", () => ({ ValoperEditDialog: () => null }))

import { fetchValopers } from "../lib/valopers"
import { getValidators } from "../lib/validators"

const OP = "g1operatoraddrxxxxxxxxxxxxxxxxxxxxxxxxxx"
const SIGN = "g1signingaddrxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
const GENESIS = "g1genesisvalxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

const valoper = (over: Partial<ValoperWithStatus> = {}): ValoperWithStatus => ({
    moniker: "Provalidator", description: "since 2018", operatorAddress: OP,
    signingAddress: SIGN, signingPubKey: "gpub1x", serverType: "cloud", status: "active", ...over,
})
const validator = (gnoAddr: string, moniker: string): ValidatorInfo =>
    ({ gnoAddr, address: gnoAddr, moniker } as ValidatorInfo)

function setData(valopers: ValoperWithStatus[], activeGnoAddrs: string[]) {
    vi.mocked(fetchValopers).mockResolvedValue(valopers)
    vi.mocked(getValidators).mockResolvedValue(activeGnoAddrs.map(a => validator(a, a === GENESIS ? "gfanton-1" : "")))
}

function LocationProbe() {
    return <span data-testid="loc">{useLocation().pathname}</span>
}

import ValidatorProfile from "./ValidatorProfile"

function render(addr: string) {
    return renderWithProviders(
        <Routes>
            <Route path="/:network/validators/:address" element={<><LocationProbe /><ValidatorProfile /></>} />
        </Routes>,
        { route: `/test13/validators/${addr}` },
    )
}

describe("ValidatorProfile (unified)", () => {
    beforeEach(() => vi.clearAllMocks())

    it("registered ACTIVE operator → identity header + Performance (active) + persistent reviews; NO Reviews tab", async () => {
        setData([valoper({ status: "active" })], [SIGN])
        render(OP)
        await waitFor(() => expect(screen.getByTestId("validator-profile-page")).toBeInTheDocument())
        expect(screen.getByRole("heading", { name: "Provalidator" })).toBeInTheDocument()
        expect(screen.getByText("● Active")).toBeInTheDocument()
        // Reviews is a persistent section, not a tab.
        expect(screen.getByTestId("vp-reviews")).toBeInTheDocument()
        expect(screen.queryByRole("tab", { name: "Reviews" })).toBeNull()
        // The Performance panel mounts (lazily) only when its tab is opened.
        fireEvent.click(screen.getByRole("tab", { name: /Performance/ }))
        const panel = await screen.findByTestId("perf-panel")
        expect(panel).toHaveAttribute("data-addr", SIGN)
        expect(panel).toHaveAttribute("data-active", "true")
    })

    it("registered CANDIDATE operator → Candidate badge + Performance panel inactive", async () => {
        setData([valoper({ status: "candidate" })], ["g1someoneelse"])
        render(OP)
        await waitFor(() => expect(screen.getByText("○ Candidate")).toBeInTheDocument())
        fireEvent.click(screen.getByRole("tab", { name: /Performance/ }))
        const panel = await screen.findByTestId("perf-panel")
        expect(panel).toHaveAttribute("data-active", "false")
    })

    it("genesis validator (in active set, no valoper) → genesis note + active Performance", async () => {
        setData([], [GENESIS])
        render(GENESIS)
        await waitFor(() => expect(screen.getByTestId("vp-genesis-note")).toBeInTheDocument())
        expect(screen.getByRole("heading", { name: "gfanton-1" })).toBeInTheDocument()
        fireEvent.click(screen.getByRole("tab", { name: /Performance/ }))
        const panel = await screen.findByTestId("perf-panel")
        expect(panel).toHaveAttribute("data-addr", GENESIS)
        expect(panel).toHaveAttribute("data-active", "true")
    })

    it("unknown address → not-found", async () => {
        setData([], ["g1other"])
        render("g1nope")
        await waitFor(() => expect(screen.getByTestId("vp-not-found")).toBeInTheDocument())
    })

    it("signing-address deep link of a registered valoper → redirects to the operator route", async () => {
        setData([valoper({ status: "active" })], [SIGN])
        render(SIGN)
        await waitFor(() => expect(screen.getByTestId("loc")).toHaveTextContent(`/test13/validators/${OP}`))
    })
})
