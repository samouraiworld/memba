import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import type { HomeSnapshot } from "../../lib/homeApi"
import type { DirectoryToken } from "../../lib/directory"
import type { ValidatorInfo } from "../../lib/validators"
import { ValidatorHealthStatus } from "../../lib/validatorHealth"

vi.mock("../../hooks/home/useHomeSnapshot", () => ({ useHomeSnapshot: vi.fn() }))
vi.mock("../../hooks/home/useEcosystemTokens", () => ({ useEcosystemTokens: vi.fn() }))
vi.mock("../../hooks/home/useEcosystemValidators", () => ({ useEcosystemValidators: vi.fn() }))

const { useHomeSnapshot } = await import("../../hooks/home/useHomeSnapshot")
const { useEcosystemTokens } = await import("../../hooks/home/useEcosystemTokens")
const { useEcosystemValidators } = await import("../../hooks/home/useEcosystemValidators")
const { EcosystemBand } = await import("./EcosystemBand")

const snap = (counts: Record<string, number>) => ({ counts } as unknown as HomeSnapshot)

const token = (overrides: Partial<DirectoryToken> = {}): DirectoryToken => ({
    slug: "FOO",
    name: "Foo Token",
    symbol: "FOO",
    path: "gno.land/r/samcrew/tokenfactory_v2:FOO",
    ...overrides,
})

function makeValidator(overrides: Partial<ValidatorInfo> = {}): ValidatorInfo {
    return {
        address: "g1test",
        gnoAddr: "g1abcdefghijklmnopqrstuvwxyz0123456789aa",
        moniker: "test-val",
        pubkey: "",
        pubkeyType: "unknown",
        votingPower: 10,
        powerPercent: 50,
        rank: 1,
        active: true,
        proposerPriority: 0,
        participationRate: null,
        uptimePercent: null,
        profileUrl: "",
        lastBlockSignatures: [],
        startTime: "",
        healthStatus: ValidatorHealthStatus.Healthy,
        healthMeta: null,
        missedBlocks: null,
        incidents: [],
        operationTime: null,
        txContrib: null,
        lastIncidentDate: null,
        ...overrides,
    }
}

/** Build a power-desc validator list of length n (powerPercent splits 100 evenly). */
function validators(n: number): ValidatorInfo[] {
    return Array.from({ length: n }, (_, i) =>
        makeValidator({
            moniker: `val-${i}`,
            gnoAddr: `g1val${String(i).padStart(38, "0")}`,
            votingPower: (n - i) * 10,
            powerPercent: Math.round((100 / n) * 100) / 100,
        }),
    )
}

const renderBand = () => render(<MemoryRouter><EcosystemBand networkKey="test13" /></MemoryRouter>)

// Defaults: nothing loading, nothing present. Each test overrides what it needs.
beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useHomeSnapshot).mockReturnValue({ snapshot: null, usable: false, isLoading: false })
    vi.mocked(useEcosystemTokens).mockReturnValue({ tokens: [], loading: false })
    vi.mocked(useEcosystemValidators).mockReturnValue({ validators: [], total: 0, loading: false })
})

describe("EcosystemBand — tokens listing", () => {
    it("lists the real token rows (name + symbol + path) under the tokens count", () => {
        vi.mocked(useHomeSnapshot).mockReturnValue({ snapshot: snap({ tokens: 2, agents: 0, validators: 0 }), usable: true, isLoading: false })
        vi.mocked(useEcosystemTokens).mockReturnValue({
            tokens: [token({ name: "Foo Token", symbol: "FOO" }), token({ name: "Bar", symbol: "BAR", path: "gno.land/r/x:BAR" })],
            loading: false,
        })
        renderBand()

        const section = screen.getByTestId("eco-tokens")
        expect(section).toHaveTextContent("2")
        const rows = within(section).getAllByTestId("eco-token-row")
        expect(rows).toHaveLength(2)
        expect(rows[0]).toHaveTextContent("Foo Token")
        expect(rows[0]).toHaveTextContent("FOO")
        expect(rows[0]).toHaveTextContent("gno.land/r/samcrew/tokenfactory_v2:FOO")
    })

    it("links the tokens section to /{network}/tokens", () => {
        vi.mocked(useHomeSnapshot).mockReturnValue({ snapshot: snap({ tokens: 1 }), usable: true, isLoading: false })
        vi.mocked(useEcosystemTokens).mockReturnValue({ tokens: [token()], loading: false })
        renderBand()

        const section = screen.getByTestId("eco-tokens")
        const links = within(section).getAllByRole("link")
        expect(links.length).toBeGreaterThan(0)
        links.forEach((a) => expect(a).toHaveAttribute("href", "/test13/tokens"))
    })

    it("omits the tokens section entirely when the list is empty (no fabricated rows)", () => {
        vi.mocked(useHomeSnapshot).mockReturnValue({ snapshot: snap({ tokens: 5 }), usable: true, isLoading: false })
        vi.mocked(useEcosystemTokens).mockReturnValue({ tokens: [], loading: false })
        renderBand()

        expect(screen.queryByTestId("eco-tokens")).not.toBeInTheDocument()
        expect(screen.queryByTestId("eco-token-row")).not.toBeInTheDocument()
    })

    it("shows a compact loading state while tokens are fetching (no rows yet)", () => {
        vi.mocked(useEcosystemTokens).mockReturnValue({ tokens: [], loading: true })
        renderBand()

        expect(screen.getByTestId("eco-tokens")).toBeInTheDocument()
        expect(screen.getByTestId("eco-tokens-loading")).toBeInTheDocument()
        expect(screen.queryByTestId("eco-token-row")).not.toBeInTheDocument()
    })
})

describe("EcosystemBand — validators listing", () => {
    it("lists validator rows (moniker + power share % + status) under the count", () => {
        vi.mocked(useEcosystemValidators).mockReturnValue({
            validators: [
                makeValidator({ moniker: "alpha", powerPercent: 60, active: true }),
                makeValidator({ moniker: "bravo", powerPercent: 40, active: true }),
            ],
            total: 2,
            loading: false,
        })
        renderBand()

        const section = screen.getByTestId("eco-validators")
        expect(section).toHaveTextContent("2")
        const rows = within(section).getAllByTestId("eco-validator-row")
        expect(rows).toHaveLength(2)
        expect(rows[0]).toHaveTextContent("alpha")
        expect(rows[0]).toHaveTextContent("60")
    })

    it("falls back to a truncated address when a validator has no moniker", () => {
        vi.mocked(useEcosystemValidators).mockReturnValue({
            validators: [makeValidator({ moniker: "", gnoAddr: "g1abcdefghijklmnopqrstuvwxyz0123456789zz" })],
            total: 1,
            loading: false,
        })
        renderBand()

        const row = screen.getByTestId("eco-validator-row")
        // Truncated: shows a prefix of the address, not the full 40 chars.
        expect(row).toHaveTextContent("g1abcd")
        expect(row).not.toHaveTextContent("g1abcdefghijklmnopqrstuvwxyz0123456789zz")
    })

    it("caps the listing at the top 5 validators and shows a 'view all N' link", () => {
        vi.mocked(useEcosystemValidators).mockReturnValue({ validators: validators(8), total: 8, loading: false })
        renderBand()

        const section = screen.getByTestId("eco-validators")
        // Only the top 5 rows rendered — never a 100-row dump.
        expect(within(section).getAllByTestId("eco-validator-row")).toHaveLength(5)

        const viewAll = within(section).getByTestId("eco-validators-viewall")
        expect(viewAll).toHaveTextContent("8")
        expect(viewAll).toHaveAttribute("href", "/test13/validators")
    })

    it("renders top validators in the order the hook provides (power desc, not re-sorted)", () => {
        // Hook contract: getValidators() is already power-desc; the band must not reorder.
        const list = [
            makeValidator({ moniker: "top", powerPercent: 70 }),
            makeValidator({ moniker: "mid", powerPercent: 20 }),
            makeValidator({ moniker: "low", powerPercent: 10 }),
        ]
        vi.mocked(useEcosystemValidators).mockReturnValue({ validators: list, total: 3, loading: false })
        renderBand()

        const monikers = screen.getAllByTestId("eco-validator-row").map((r) => within(r).getByTestId("eco-validator-name").textContent)
        expect(monikers).toEqual(["top", "mid", "low"])
    })

    it("does not show a 'view all' link when total <= the top-N cap", () => {
        vi.mocked(useEcosystemValidators).mockReturnValue({ validators: validators(3), total: 3, loading: false })
        renderBand()

        expect(screen.queryByTestId("eco-validators-viewall")).not.toBeInTheDocument()
    })

    it("omits the validators section entirely when the list is empty", () => {
        vi.mocked(useEcosystemValidators).mockReturnValue({ validators: [], total: 0, loading: false })
        renderBand()

        expect(screen.queryByTestId("eco-validators")).not.toBeInTheDocument()
        expect(screen.queryByTestId("eco-validator-row")).not.toBeInTheDocument()
    })

    it("shows a compact loading state while validators are fetching", () => {
        vi.mocked(useEcosystemValidators).mockReturnValue({ validators: [], total: 0, loading: true })
        renderBand()

        expect(screen.getByTestId("eco-validators")).toBeInTheDocument()
        expect(screen.getByTestId("eco-validators-loading")).toBeInTheDocument()
        expect(screen.queryByTestId("eco-validator-row")).not.toBeInTheDocument()
    })
})

describe("EcosystemBand — agents tile + overall band", () => {
    it("keeps the agents tile (count only) when the snapshot reports agents > 0", () => {
        vi.mocked(useHomeSnapshot).mockReturnValue({ snapshot: snap({ tokens: 0, agents: 3, validators: 0 }), usable: true, isLoading: false })
        renderBand()

        const agents = screen.getByTestId("eco-agents")
        expect(agents).toHaveTextContent("3")
        expect(agents).toHaveTextContent("agents")
    })

    it("omits the agents tile when its count is 0", () => {
        vi.mocked(useHomeSnapshot).mockReturnValue({ snapshot: snap({ tokens: 0, agents: 0, validators: 0 }), usable: true, isLoading: false })
        renderBand()

        expect(screen.queryByTestId("eco-agents")).not.toBeInTheDocument()
    })

    it("renders nothing at all when there is no data and nothing is loading", () => {
        const { container } = renderBand()
        expect(container.querySelector(".ecosystem-band")).toBeNull()
    })
})
