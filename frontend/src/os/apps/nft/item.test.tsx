import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TokenMetadataError } from "../../../lib/nft/metadata"
import { ReadError, RealmRefusedError } from "../../../lib/nft/read"
import NftWindow from "./native"

const reads = vi.hoisted(() => ({ getToken: vi.fn(), fetchTokenMetadata: vi.fn() }))
vi.mock("../../../lib/nft/ledger", async (original) => ({ ...(await original<object>()), getToken: reads.getToken }))
vi.mock("../../../lib/nft/metadata", async (original) => ({ ...(await original<object>()), fetchTokenMetadata: reads.fetchTokenMetadata }))
vi.mock("../../../lib/config", async (original) => ({ ...(await original<typeof import("../../../lib/config")>()), isNftEnabled: () => true, isRealmValidOn: () => true }))

const OWNER = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const URI = `ipfs://bafy${"m".repeat(55)}/7.json`
const token = { collection: "C1", number: 7n, owner: OWNER, status: "active", uri: URI }

function show() {
    const push = vi.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
        <QueryClientProvider client={client}>
            <NftWindow section="c/C1/7" session={{ status: "guest", network: { key: "testnet12" } } as never} active open={vi.fn()} push={push} openApp={vi.fn()} close={() => {}} toast={() => {}} fallback={<p>classic page</p>} />
        </QueryClientProvider>,
    )
    return push
}
const pushed = (push: ReturnType<typeof vi.fn>) => push.mock.calls.map(([spec]) => `${spec.target.app}/${spec.target.section}`)

describe("NFT item page", () => {
    beforeEach(() => {
        reads.getToken.mockReset().mockResolvedValue(token)
        reads.fetchTokenMetadata.mockReset()
    })

    it("shows the token's metadata and what the ledger says about it", async () => {
        reads.fetchTokenMetadata.mockResolvedValue({
            name: "Relevé​ #7", description: "A drawing", image: "https://example.org/7.png",
            attributes: [{ trait_type: "Ink", value: "Sepia" }, { trait_type: "Sheet", value: 3 }],
        })
        const push = show()
        expect(screen.getByRole("status")).toHaveTextContent("Reading the token…")
        expect(await screen.findByRole("heading", { name: "Relevé[U+200B] #7" })).toBeInTheDocument()
        expect(screen.getByRole("img", { name: "Relevé[U+200B] #7" })).toHaveAttribute("src", "https://example.org/7.png")
        expect(screen.getByText("A drawing")).toBeInTheDocument()
        expect(screen.getByLabelText("Attributes")).toHaveTextContent("InkSepiaSheet3")
        expect(screen.getByText("Owner").nextSibling).toHaveTextContent(OWNER)
        expect(screen.getByText("Token URI").nextSibling).toHaveTextContent(URI)
        expect(screen.getByText("Status").nextSibling).toHaveTextContent("Active")
        expect(reads.getToken).toHaveBeenCalledWith("C1", 7n)
        fireEvent.click(screen.getByRole("button", { name: "Trade on Market" }))
        fireEvent.click(screen.getByRole("button", { name: /Collection C1/ }))
        expect(pushed(push)).toEqual(["market/nfts/c/C1/7", "nft/c/C1"])
    })

    it.each([
        ["too_large", "The token's metadata file is larger than this app reads, so it is not shown."],
        ["not_json", "The token's metadata file is not a metadata file this app can read, so it is not shown."],
        ["unsupported", "The token's metadata is not on IPFS, so this app does not fetch it."],
    ] as const)("says why metadata that will never load (%s) is not shown", async (reason, message) => {
        reads.fetchTokenMetadata.mockRejectedValue(new TokenMetadataError(reason))
        show()
        expect(await screen.findByRole("note")).toHaveTextContent(message)
        expect(screen.getByRole("heading", { name: "C1 #7" })).toBeInTheDocument()
        expect(screen.queryByRole("alert")).toBeNull()
    })

    it("offers a retry when the gateway could not be reached", async () => {
        reads.fetchTokenMetadata.mockRejectedValueOnce(new TokenMetadataError("unavailable")).mockResolvedValueOnce({ name: "Relevé #7", description: null, image: null, attributes: [] })
        show()
        expect(await screen.findByRole("alert")).toHaveTextContent("The token's metadata could not be fetched from the IPFS gateway.")
        fireEvent.click(screen.getByRole("button", { name: "Retry" }))
        expect(await screen.findByRole("heading", { name: "Relevé #7" })).toBeInTheDocument()
    })

    it("shows a burned token without an owner or a trade action", async () => {
        reads.getToken.mockResolvedValue({ ...token, owner: "", status: "burned", uri: "" })
        show()
        expect(await screen.findByRole("note")).toHaveTextContent("This token has no metadata address.")
        expect(screen.getByText("Status").nextSibling).toHaveTextContent("Burned")
        expect(screen.getByText("Owner").nextSibling).toHaveTextContent("None: the token no longer exists")
        expect(screen.queryByRole("button", { name: "Trade on Market" })).toBeNull()
        expect(reads.fetchTokenMetadata).not.toHaveBeenCalled()
    })

    it("shows an unreadable token as an error with a retry", async () => {
        reads.getToken.mockRejectedValueOnce(new ReadError("Could not read token")).mockResolvedValueOnce(token)
        reads.fetchTokenMetadata.mockResolvedValue({ name: null, description: null, image: null, attributes: [] })
        show()
        expect(await screen.findByRole("alert")).toHaveTextContent("The token could not be read from this network.")
        fireEvent.click(screen.getByRole("button", { name: "Retry" }))
        expect(await screen.findByRole("heading", { name: "C1 #7" })).toBeInTheDocument()
    })

    it("shows a token the ledger refuses as missing, with no retry that could only be refused again", async () => {
        reads.getToken.mockRejectedValue(new RealmRefusedError("The realm refused to read token"))
        show()
        expect(await screen.findByRole("alert")).toHaveTextContent("Collection C1 has no token #7 on this network.")
        expect(screen.queryByRole("button", { name: "Retry" })).toBeNull()
    })

    it("shows a token that breaks the ledger's rules as unusable, with no retry", async () => {
        reads.getToken.mockRejectedValue(new Error("Inconsistent token owner"))
        show()
        expect(await screen.findByRole("alert")).toHaveTextContent("What this network sent for the token does not follow the realm's rules, so it is not shown.")
        expect(screen.queryByRole("button", { name: "Retry" })).toBeNull()
    })
})
