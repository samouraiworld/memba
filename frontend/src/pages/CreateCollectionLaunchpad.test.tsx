import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

const ME = "g1creator00000000000000000000000000001"

vi.mock("../lib/config", async (orig) => ({
    ...(await orig<typeof import("../lib/config")>()),
    isNftEnabled: () => true,
    isNftLaunchpadValid: () => true,
}))

vi.mock("../hooks/useNetworkNav", () => ({
    useNetworkPath: () => (p: string) => `/test/${p}`,
}))

vi.mock("react-router-dom", async (orig) => {
    const real = await orig<typeof import("react-router-dom")>()
    return { ...real, useOutletContext: () => ({ adena: { address: ME } }) }
})

const mockBroadcast = vi.fn().mockResolvedValue(undefined)
vi.mock("../lib/grc20", () => ({ doContractBroadcast: (...a: unknown[]) => mockBroadcast(...a) }))

vi.mock("../components/nft/NFTMedia", () => ({
    NFTMedia: ({ alt }: { alt: string }) => <div data-testid="nft-media">{alt}</div>,
}))

import { CreateCollectionLaunchpad } from "./CreateCollectionLaunchpad"

const renderPage = () => render(<MemoryRouter><CreateCollectionLaunchpad /></MemoryRouter>)

beforeEach(() => {
    vi.clearAllMocks()
    mockBroadcast.mockResolvedValue(undefined)
})

describe("CreateCollectionLaunchpad — reworked", () => {
    it("renders the sectioned form (name, slug, symbol) when NFT is enabled", () => {
        renderPage()
        expect(screen.getByLabelText(/name/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/slug/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/symbol/i)).toBeInTheDocument()
    })

    it("the live preview reflects the typed name and symbol", () => {
        renderPage()
        fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Cool NFTs" } })
        fireEvent.change(screen.getByLabelText(/symbol/i), { target: { value: "COOL" } })
        const preview = screen.getByTestId("create-preview")
        expect(preview).toHaveTextContent("Cool NFTs")
        expect(preview).toHaveTextContent("COOL")
    })

    it("shows the derived collection ID once the slug is valid", () => {
        renderPage()
        fireEvent.change(screen.getByLabelText(/slug/i), { target: { value: "cool-nfts" } })
        expect(screen.getByText(new RegExp(`${ME}/cool-nfts`))).toBeInTheDocument()
    })

    it("keeps launch disabled until the form is valid, then enables + broadcasts", async () => {
        renderPage()
        const launch = screen.getByRole("button", { name: /launch/i })
        expect(launch).toBeDisabled()

        fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Cool NFTs" } })
        fireEvent.change(screen.getByLabelText(/symbol/i), { target: { value: "COOL" } })
        fireEvent.change(screen.getByLabelText(/slug/i), { target: { value: "cool-nfts" } })

        expect(launch).toBeEnabled()
        fireEvent.click(launch)
        const { findByText } = screen
        await findByText(/launching|collection launched/i)
        expect(mockBroadcast).toHaveBeenCalledTimes(1)
    })
})
