import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"

// getTokenInfo is the live on-chain read for the token unfurl card; formatSupply
// stays real so the card's number formatting is exercised end-to-end.
vi.mock("../../lib/grc20", async (orig) => ({
    ...(await orig<typeof import("../../lib/grc20")>()),
    getTokenInfo: vi.fn(),
}))
// queryRender is the on-chain read behind the validator card; parseValoperDetail
// (real) parses whatever it returns, so the card's full path is exercised.
vi.mock("../../lib/dao/shared", async (orig) => ({
    ...(await orig<typeof import("../../lib/dao/shared")>()),
    queryRender: vi.fn(),
}))
// getProposalDetail is the on-chain read behind the proposal card.
vi.mock("../../lib/dao/proposals", async (orig) => ({
    ...(await orig<typeof import("../../lib/dao/proposals")>()),
    getProposalDetail: vi.fn(),
}))

import { PostUnfurls } from "./PostUnfurls"
import { getTokenInfo } from "../../lib/grc20"
import { queryRender } from "../../lib/dao/shared"
import { getProposalDetail } from "../../lib/dao/proposals"

const mockTokenInfo = vi.mocked(getTokenInfo)
const mockRender = vi.mocked(queryRender)
const mockProposal = vi.mocked(getProposalDetail)

function renderWithClient(ui: ReactNode) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

beforeEach(() => { mockTokenInfo.mockReset(); mockRender.mockReset(); mockProposal.mockReset() })

describe("PostUnfurls", () => {
    it("renders a realm card for a gno.land realm reference", () => {
        render(<PostUnfurls body="vote on r/samcrew/memba_feed_v1 now" />)
        const card = screen.getByTestId("feed-unfurl-realm")
        expect(card).toHaveAttribute("href", "https://gno.land/r/samcrew/memba_feed_v1")
        expect(card).toHaveTextContent("memba_feed_v1")
        expect(card).toHaveTextContent("r/samcrew")
    })

    it("renders a link card (with host) for a plain URL", () => {
        render(<PostUnfurls body="see https://example.com/post" />)
        const card = screen.getByTestId("feed-unfurl-link")
        expect(card).toHaveAttribute("href", "https://example.com/post")
        expect(card).toHaveTextContent("example.com")
    })

    it("renders nothing for a body with no references", () => {
        const { container } = render(<PostUnfurls body="a plain thought" />)
        expect(container.firstChild).toBeNull()
    })

    it("opens links safely in a new tab", () => {
        render(<PostUnfurls body="r/gno/land" />)
        const card = screen.getByTestId("feed-unfurl-realm")
        expect(card).toHaveAttribute("target", "_blank")
        expect(card).toHaveAttribute("rel", "noopener noreferrer")
    })

    it("renders a LIVE token card (supply + holders) for a Memba token link", async () => {
        mockTokenInfo.mockResolvedValue({
            name: "Memba", symbol: "MEMBA", decimals: 6,
            totalSupply: "102500100", admin: "g1admin", knownAccounts: 42,
        })
        renderWithClient(<PostUnfurls body="holding https://app.memba.world/test13/tokens/MEMBA" />)

        const card = await screen.findByTestId("feed-unfurl-token")
        expect(card).toHaveAttribute("href", "https://app.memba.world/test13/tokens/MEMBA")
        // Wait for the on-chain read to resolve — formatSupply("102500100", 6) → "102.5001".
        expect(await screen.findByText(/102\.5001/)).toBeInTheDocument()
        expect(card).toHaveTextContent("Memba")
        expect(card).toHaveTextContent(/42/)
    })

    it("falls back gracefully to a plain symbol card when token info is unavailable", async () => {
        mockTokenInfo.mockResolvedValue(null)
        renderWithClient(<PostUnfurls body="https://app.memba.world/test13/tokens/GHOST" />)

        const card = await screen.findByTestId("feed-unfurl-token")
        expect(card).toHaveAttribute("href", "https://app.memba.world/test13/tokens/GHOST")
        // Degrades to just the symbol — never a crash, never fabricated numbers.
        expect(card).toHaveTextContent("GHOST")
    })

    it("renders a LIVE validator card (moniker + server type) for a Memba validator link", async () => {
        const addr = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
        mockRender.mockResolvedValue([
            "## Zooma Ops",
            "Reliable test13 operator",
            `- Operator Address: ${addr}`,
            "- Signing Address: g1sign00000000000000000000000000000000000",
            "- Server Type: cloud",
        ].join("\n"))
        renderWithClient(<PostUnfurls body={`gm ${`https://app.memba.world/test13/validators/${addr}`}`} />)

        const card = await screen.findByTestId("feed-unfurl-validator")
        expect(card).toHaveAttribute("href", `https://app.memba.world/test13/validators/${addr}`)
        // Wait for the valoper read to resolve.
        expect(await screen.findByText("Zooma Ops")).toBeInTheDocument()
        expect(card).toHaveTextContent(/cloud/i)
    })

    it("falls back to a plain address card for an unregistered validator", async () => {
        const addr = "g1ghostxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
        mockRender.mockResolvedValue(null)
        renderWithClient(<PostUnfurls body={`https://app.memba.world/test13/validators/${addr}`} />)

        const card = await screen.findByTestId("feed-unfurl-validator")
        expect(card).toHaveAttribute("href", `https://app.memba.world/test13/validators/${addr}`)
        // Degrades to a truncated address — never a crash.
        expect(card).toHaveTextContent(/g1ghost/i)
    })

    it("renders a LIVE proposal card (title + status) for a Memba DAO proposal link", async () => {
        const url = "https://app.memba.world/test13/dao/gno.land/r/gov/dao/proposal/5"
        mockProposal.mockResolvedValue({ id: 5, title: "Fund the grants program", status: "open", yesPercent: 72 } as never)
        renderWithClient(<PostUnfurls body={`vote ${url}`} />)

        const card = await screen.findByTestId("feed-unfurl-proposal")
        expect(card).toHaveAttribute("href", url)
        expect(await screen.findByText("Fund the grants program")).toBeInTheDocument()
        expect(card).toHaveTextContent(/open/i)
    })

    it("falls back to 'Proposal #<id>' when the proposal can't be read", async () => {
        const url = "https://app.memba.world/test13/dao/gno.land/r/gov/dao/proposal/9"
        mockProposal.mockResolvedValue(null)
        renderWithClient(<PostUnfurls body={url} />)

        const card = await screen.findByTestId("feed-unfurl-proposal")
        expect(card).toHaveTextContent("Proposal #9")
    })
})
