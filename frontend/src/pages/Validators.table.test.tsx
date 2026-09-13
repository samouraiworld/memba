import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { screen, fireEvent, within, createEvent } from "@testing-library/react"
import { useLocation } from "react-router-dom"
import { renderWithProviders } from "../test/test-utils"
import { DEFAULT_NETWORK } from "../lib/config"
import { getValidators, type ValidatorInfo, type NetworkStats } from "../lib/validators"

/**
 * The desktop roster table as a keyboard or screen-reader user meets it.
 *
 * What these pin, and why each was broken:
 *  - Sortable headers were `<th onClick>`: unreachable by keyboard, no
 *    `aria-sort`, and every header looked clickable, sortable or not.
 *  - Each row was `<tr role="button" tabIndex={0}>`. A button's children are
 *    presentational, so the copy button and Gnoweb link inside it vanished for
 *    assistive tech (axe `nested-interactive`, which the a11y spec disables
 *    globally), and the row stopped being a table row.
 *  - The row's click handler fired for clicks on those children too: opening
 *    the Gnoweb link in a new tab also navigated the table away.
 */

const { VALIDATOR, STATS } = vi.hoisted(() => {
    const VALIDATOR = {
        address: "ABCDEF0123456789",
        gnoAddr: "g1validatoraddr00000000000000000000000000",
        moniker: "test-validator",
        pubkey: "cHVia2V5",
        pubkeyType: "tendermint/PubKeyEd25519",
        votingPower: 1000,
        powerPercent: 100,
        rank: 1,
        active: true,
        proposerPriority: 0,
        participationRate: null,
        uptimePercent: null,
        profileUrl: "",
        lastBlockSignatures: [],
        startTime: new Date().toISOString(),
        healthStatus: "unknown",
        healthMeta: null,
        missedBlocks: null,
        incidents: [],
        operationTime: null,
        txContrib: null,
        lastIncidentDate: null,
    } as unknown as ValidatorInfo

    const STATS = {
        blockHeight: 12345,
        avgBlockTime: 5,
        totalValidators: 1,
        totalVotingPower: 1000,
        catchingUp: false,
    } as unknown as NetworkStats

    return { VALIDATOR, STATS }
})

vi.mock("../lib/validators", async () => {
    const actual = await vi.importActual<typeof import("../lib/validators")>("../lib/validators")
    return {
        ...actual,
        getValidators: vi.fn().mockResolvedValue([VALIDATOR]),
        getNetworkStats: vi.fn().mockResolvedValue(STATS),
        getAggregatedNetPeers: vi.fn().mockResolvedValue(null),
        fetchValoperMonikers: vi.fn().mockResolvedValue(new Map()),
        mergeValoperMonikers: vi.fn((vals: ValidatorInfo[]) => vals),
        mergeWithMonitoringData: vi.fn((vals: ValidatorInfo[]) => vals),
        fetchLastBlockSignatures: vi.fn().mockResolvedValue(new Map()),
    }
})

vi.mock("../lib/gnomonitoring", () => ({
    fetchAllMonitoringData: vi.fn().mockResolvedValue(new Map()),
}))

vi.mock("../lib/valopers", async () => {
    const actual = await vi.importActual<typeof import("../lib/valopers")>("../lib/valopers")
    return { ...actual, fetchValopers: vi.fn().mockResolvedValue([]) }
})

vi.mock("../components/validators/NetworkNodesRoster", () => ({
    NetworkNodesRoster: () => null,
}))

import Validators from "./Validators"

const START = "/test13/validators"
// No `:network` route param and empty storage in jsdom ⇒ the page resolves the
// default network, exactly as the row's own navigation does.
const PROFILE = `/${DEFAULT_NETWORK}/validators/${VALIDATOR.gnoAddr}`

function LocationProbe() {
    return <output data-testid="location">{useLocation().pathname}</output>
}

async function renderTable(overrides: Partial<ValidatorInfo> = {}) {
    vi.mocked(getValidators).mockResolvedValue([{ ...VALIDATOR, ...overrides }])
    renderWithProviders(<><Validators /><LocationProbe /></>, { route: START })
    await screen.findByTestId("validator-table")
    return screen.getByTestId("validator-row-1")
}

const location = () => screen.getByTestId("location").textContent

describe("Validators table — sortable headers", () => {
    beforeEach(() => vi.clearAllMocks())
    afterEach(() => vi.mocked(getValidators).mockResolvedValue([VALIDATOR]))

    it("sorts from a real button inside the header cell", async () => {
        await renderTable()
        const header = screen.getByRole("columnheader", { name: /Voting Power/ })
        expect(within(header).getByRole("button", { name: "Voting Power" })).toBeInTheDocument()
    })

    it("announces the current sort on the sorted column only", async () => {
        await renderTable()
        expect(screen.getByRole("columnheader", { name: /Rank/ })).toHaveAttribute("aria-sort", "ascending")
        expect(screen.getByRole("columnheader", { name: /Voting Power/ })).not.toHaveAttribute("aria-sort")
    })

    it("moves aria-sort with the sort, and flips its direction on a second press", async () => {
        await renderTable()
        const button = screen.getByRole("button", { name: "Voting Power" })
        fireEvent.click(button)
        expect(screen.getByRole("columnheader", { name: /Voting Power/ })).toHaveAttribute("aria-sort", "descending")
        expect(screen.getByRole("columnheader", { name: /Rank/ })).not.toHaveAttribute("aria-sort")
        fireEvent.click(button)
        expect(screen.getByRole("columnheader", { name: /Voting Power/ })).toHaveAttribute("aria-sort", "ascending")
    })

    it("names the rank column in words, not '#'", async () => {
        await renderTable()
        expect(screen.getByRole("button", { name: "Rank" })).toBeInTheDocument()
    })

    it("offers no sort control on columns that cannot sort", async () => {
        await renderTable()
        for (const name of ["Validator", "Health"]) {
            expect(within(screen.getByRole("columnheader", { name })).queryByRole("button")).not.toBeInTheDocument()
        }
    })
})

describe("Validators table — rows", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
    })
    afterEach(() => vi.mocked(getValidators).mockResolvedValue([VALIDATOR]))

    it("a row is a table row, not a button", async () => {
        const row = await renderTable()
        expect(row).not.toHaveAttribute("role")
        expect(row).not.toHaveAttribute("tabindex")
        expect(screen.queryByRole("button", { name: /validator details/ })).not.toBeInTheDocument()
    })

    it("the validator's name is a link to its page, on the current network", async () => {
        const row = await renderTable()
        expect(within(row).getByRole("link", { name: "test-validator" })).toHaveAttribute("href", PROFILE)
    })

    it("a validator without a moniker is linked by its address", async () => {
        const row = await renderTable({ moniker: "" })
        expect(within(row).getByRole("link", { name: VALIDATOR.address })).toHaveAttribute("href", PROFILE)
    })

    it("clicking elsewhere on the row still opens the validator", async () => {
        const row = await renderTable()
        fireEvent.click(within(row).getByText("100.0%"))
        expect(location()).toBe(PROFILE)
    })

    it("opening the Gnoweb link does not also navigate the table away", async () => {
        const row = await renderTable({ profileUrl: "https://gno.land/r/demo/profile" })
        const link = within(row).getByRole("link", { name: /Gnoweb/ })
        // jsdom cannot follow an external href; stop that, but let the event
        // bubble to the row exactly as a real click does.
        const click = createEvent.click(link)
        click.preventDefault()
        fireEvent(link, click)
        expect(location()).toBe(START)
    })

    it("copying the address does not navigate", async () => {
        const row = await renderTable()
        fireEvent.click(within(row).getByTitle("Copy address"))
        expect(location()).toBe(START)
    })

    it("reads the recent-signature strip as one summary instead of a hundred ticks", async () => {
        // The page rebuilds each row's window from fetchLastBlockSignatures, keyed
        // by lowercase bech32 — a fixture field alone is overwritten.
        const { fetchLastBlockSignatures } = await import("../lib/validators")
        vi.mocked(fetchLastBlockSignatures).mockResolvedValueOnce(
            new Map([[VALIDATOR.gnoAddr.toLowerCase(), [true, false, true, true]]]),
        )
        const row = await renderTable()
        expect(within(row).getByRole("img", { name: "3 of 4 recent blocks signed" })).toBeInTheDocument()
    })
})
