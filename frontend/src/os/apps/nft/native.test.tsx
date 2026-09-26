import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { GNO_CHAIN_ID } from "../../../lib/config"
import { NFT_COLLECTIONS_PATH, NFT_MARKETPLACE_V3_PATH } from "../../../lib/nftConfig"
import NftWindow from "./native"

const availability = vi.hoisted(() => ({ enabled: false, launchpad: false, market: false }))
vi.mock("../../../lib/config", async (original) => ({
    ...(await original<typeof import("../../../lib/config")>()),
    isNftEnabled: () => availability.enabled,
    isRealmValidOn: (_network: string, path: string) => path === NFT_COLLECTIONS_PATH ? availability.launchpad : path === NFT_MARKETPLACE_V3_PATH ? availability.market : false,
}))
const session = (isTestnet: boolean) => ({ network: { key: isTestnet ? "testnet12" : "mainnet", isTestnet } }) as never
const base = { query: undefined, close: () => {}, toast: () => {}, fallback: <p>classic page</p> }

describe("NFT window", () => {
    beforeEach(() => { availability.enabled = false; availability.launchpad = false; availability.market = false })

    it("on mainnet, separates implemented screens, absent registry and disabled build flag", () => {
        const openApp = vi.fn()
        render(<NftWindow {...base} section={null} session={session(false)} open={vi.fn()} openApp={openApp} />)
        expect(screen.getByRole("note")).toHaveTextContent("screens are implemented in Memba")
        expect(screen.getByRole("note")).toHaveTextContent(`registry is not deployed on ${GNO_CHAIN_ID}`)
        expect(screen.getByRole("note")).toHaveTextContent("disabled in this build")
        expect(screen.queryByText("classic page")).toBeNull()
        expect(screen.queryByText(/Trade NFTs and hire/)).toBeNull()
        fireEvent.click(screen.getByRole("button", { name: /Open Market/ }))
        expect(openApp).toHaveBeenCalledWith("market")
    })

    it("elsewhere, offers NFT actions only when the flag and relevant realms are available", () => {
        availability.enabled = true
        availability.launchpad = true
        availability.market = true
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

    it("keeps a deployed registry unavailable when the NFT build flag is off", () => {
        availability.launchpad = true
        render(<NftWindow {...base} section={null} session={session(true)} open={vi.fn()} openApp={vi.fn()} />)
        expect(screen.getByRole("note")).toHaveTextContent("disabled in this build")
        expect(screen.queryByRole("button", { name: /Create a collection/ })).toBeNull()
    })

    it("does not advertise NFT trading when only the collection registry is available", () => {
        availability.enabled = true
        availability.launchpad = true
        render(<NftWindow {...base} section={null} session={session(true)} open={vi.fn()} openApp={vi.fn()} />)
        expect(screen.queryByRole("button", { name: /Browse NFTs/ })).toBeNull()
        expect(screen.getByRole("button", { name: /Create a collection/ })).toBeInTheDocument()
    })

    it("renders the fallback for every section other than the home, on any network", () => {
        render(<NftWindow {...base} section="create" session={session(false)} open={vi.fn()} openApp={vi.fn()} />)
        expect(screen.getByText("classic page")).toBeInTheDocument()
        expect(screen.queryByRole("note")).toBeNull()
    })
})
