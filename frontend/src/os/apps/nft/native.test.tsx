import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { GNO_CHAIN_ID } from "../../../lib/config"
import NftWindow from "./native"

const session = (isTestnet: boolean) => ({ network: { key: isTestnet ? "testnet12" : "mainnet", isTestnet } }) as never
const base = { query: undefined, close: () => {}, toast: () => {}, fallback: <p>classic page</p> }

describe("NFT window", () => {
    it("on mainnet, explains NFTs aren't live yet and offers Market instead", () => {
        const openApp = vi.fn()
        render(<NftWindow {...base} section={null} session={session(false)} open={vi.fn()} openApp={openApp} />)
        expect(screen.getByText(`Not on ${GNO_CHAIN_ID} yet`)).toBeInTheDocument()
        expect(screen.getByText(/isn't available yet/)).toBeInTheDocument()
        expect(screen.queryByText("classic page")).toBeNull()
        fireEvent.click(screen.getByRole("button", { name: /Open Market/ }))
        expect(openApp).toHaveBeenCalledWith("market")
    })

    it("elsewhere, offers Browse NFTs, Create a collection and Your studio", () => {
        const open = vi.fn()
        render(<NftWindow {...base} section={null} session={session(true)} open={open} openApp={vi.fn()} />)
        expect(screen.queryByText("classic page")).toBeNull()

        fireEvent.click(screen.getByRole("button", { name: /Browse NFTs/ }))
        expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ target: { kind: "app", app: "market", section: "nfts" } }))

        fireEvent.click(screen.getByRole("button", { name: /Create a collection/ }))
        expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ target: { kind: "app", app: "nft", section: "create" } }))

        fireEvent.click(screen.getByRole("button", { name: /Your studio/ }))
        expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ target: { kind: "app", app: "nft", section: "studio" } }))
    })

    it("renders the fallback for every section other than the home, on any network", () => {
        render(<NftWindow {...base} section="create" session={session(false)} open={vi.fn()} openApp={vi.fn()} />)
        expect(screen.getByText("classic page")).toBeInTheDocument()
        expect(screen.queryByText(/isn't available yet/)).toBeNull()
    })
})
