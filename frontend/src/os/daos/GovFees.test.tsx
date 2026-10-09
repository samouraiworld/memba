import { render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { FEE_SOURCES, readGovFees, type FeeSnapshot } from "../../lib/dao/govFees"
import { GovFees } from "./GovFees"
vi.mock("../../lib/config", () => ({ GNO_CHAIN_ID: "gnoland-1", GNO_RPC_URL: "https://rpc.invalid" }))
vi.mock("../../lib/dao/govFees", async original => ({ ...(await original<typeof import("../../lib/dao/govFees")>()), readGovFees: vi.fn() }))
const snapshot = (): FeeSnapshot => ({
    sources: FEE_SOURCES.map(source => ({ source, values: { rate: "1 GNOT", recipient: "g136j0m08pkm2lwwde9dmlx8uee26llent9s5cpf", retainedUgnot: source.mode === "retained" ? 123456n : null } })),
    wallets: [{ address: "g136j0m08pkm2lwwde9dmlx8uee26llent9s5cpf", balanceUgnot: 999_000_000n }],
})
const show = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><GovFees /></QueryClientProvider>)
    return client
}
beforeEach(() => { vi.resetAllMocks(); vi.mocked(readGovFees).mockResolvedValue(snapshot()) })
describe("fee transparency for guests", () => {
    it("shows retained fees exactly and never labels receiving balances as accumulated revenue", async () => {
        show()
        expect(await screen.findByText("0.123456 GNOT")).toBeInTheDocument()
        expect(screen.getByText("Total historical app revenue: not available")).toBeInTheDocument()
        expect(screen.getByText(/excludes players’ stakes/)).toBeInTheDocument()
        expect(screen.getByText(/neither accumulated fee totals nor a DAO treasury balance/)).toBeInTheDocument()
        expect(screen.getByText("g136j0m08pkm2lwwde9dmlx8uee26llent9s5cpf ↗")).toHaveAttribute("href", expect.stringContaining("chainId=gnoland-1"))
    })
    it("keeps source failures and balance failures distinct from zero", async () => {
        const data = snapshot(); data.sources[3].values = null; data.wallets[0].balanceUgnot = null
        vi.mocked(readGovFees).mockResolvedValue(data)
        show()
        expect(await screen.findByText("Fee data unavailable")).toBeInTheDocument()
        expect(screen.getByText("Balance unavailable")).toBeInTheDocument()
        expect(screen.queryByText("0 GNOT")).toBeNull()
    })
    it("marks preserved values when refreshing fails", async () => {
        const client = show()
        await screen.findByText("0.123456 GNOT")
        vi.mocked(readGovFees).mockRejectedValue(new Error("offline"))
        await client.refetchQueries()
        await waitFor(() => expect(screen.getByText(/Values below are from the previous read/)).toBeInTheDocument())
        expect(screen.getByText("0.123456 GNOT")).toBeInTheDocument()
    })
})
