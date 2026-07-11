/**
 * MintSection — curated Genesis mint flow (mint tickets + server allowlist proofs).
 *
 * When the backend mint-ticket endpoint is live, the public/allowlist forms
 * stop asking for a manual token URI and use the ticket's suggested URI; the
 * allowlist proof auto-loads from the server (paste flow stays as fallback);
 * a tid jump after a mint surfaces the Misprint notice.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { MintSection } from "./MintSection"
import type { CollectionDetail as CollectionInfo } from "../../../lib/launchpad"

const mockFetchMintTicket = vi.fn()
const mockFetchAllowlistProof = vi.fn()

vi.mock("../../../lib/nftApi", () => ({
    fetchMintTicket: (...a: unknown[]) => mockFetchMintTicket(...a),
    fetchAllowlistProof: (...a: unknown[]) => mockFetchAllowlistProof(...a),
}))

const CALLER = "g1samourai000000000000000000000000001"
const ID = `${CALLER}/membas`

const BASE_COL: CollectionInfo = {
    name: "Membas",
    symbol: "MEMBAS",
    id: ID,
    creator: CALLER,
    admin: CALLER,
    royaltyBps: 500,
    royaltyRecip: CALLER,
    phase: 2,
    mintPrice: 20_000_000,
    payDenom: "ugnot",
    minted: 3,
    maxSupply: 555,
    paused: false,
}

const TICKET = { tid: 3, edition: 4, tokenURI: "ipfs://CID/Memba_0004.json" }

function renderMint(run = vi.fn().mockResolvedValue(undefined)) {
    return { run, ...render(<MintSection id={ID} caller={CALLER} col={BASE_COL} run={run} />) }
}

beforeEach(() => {
    mockFetchMintTicket.mockReset().mockResolvedValue(TICKET)
    mockFetchAllowlistProof.mockReset().mockResolvedValue(null)
})

describe("MintSection — curated ticket flow", () => {
    it("shows the ticket edition and hides the public-form manual URI input", async () => {
        renderMint()
        await waitFor(() => expect(screen.getByText(/Memba #0004/)).toBeInTheDocument())
        // public/allowlist manual URI inputs are gone (their distinct placeholder)…
        expect(screen.queryByPlaceholderText(/leave blank for on-chain default/i)).toBeNull()
        // …while the admin card's URI input (different placeholder) remains.
        expect(screen.getByPlaceholderText(/or any URI/i)).toBeInTheDocument()
    })

    it("public mint uses the ticket URI", async () => {
        const { run } = renderMint()
        await waitFor(() => expect(screen.getByText(/Memba #0004/)).toBeInTheDocument())
        fireEvent.click(screen.getByRole("button", { name: /^Mint \(20 GNOT\)$/ }))
        await waitFor(() => expect(run).toHaveBeenCalledTimes(1))
        const msg = run.mock.calls[0][0]
        expect(msg.value.func).toBe("MintPublic")
        expect(msg.value.args).toStrictEqual([ID, TICKET.tokenURI])
    })

    it("keeps the manual URI inputs when the ticket endpoint is off", async () => {
        mockFetchMintTicket.mockResolvedValue(null)
        renderMint()
        await waitFor(() => expect(mockFetchMintTicket).toHaveBeenCalled())
        expect(screen.getAllByPlaceholderText(/leave blank for on-chain default/i).length).toBeGreaterThan(0)
    })

    it("auto-loads the server allowlist proof and mints with it", async () => {
        mockFetchAllowlistProof.mockResolvedValue({ root: "ab", maxQty: 2, proof: "aa,bb" })
        const { run } = renderMint()
        await waitFor(() => expect(screen.getByText(/Allowlisted for 2/)).toBeInTheDocument())
        fireEvent.click(screen.getByRole("button", { name: /Mint \(allowlist\)/ }))
        await waitFor(() => expect(run).toHaveBeenCalledTimes(1))
        const msg = run.mock.calls[0][0]
        expect(msg.value.func).toBe("MintAllowlist")
        expect(msg.value.args).toStrictEqual([ID, "aa,bb", "2", TICKET.tokenURI])
    })

    it("surfaces the Misprint notice when the tid jumps past ours", async () => {
        mockFetchMintTicket
            .mockResolvedValueOnce(TICKET) // initial load
            .mockResolvedValue({ tid: 6, edition: 7, tokenURI: "ipfs://CID/Memba_0007.json" }) // post-mint
        renderMint()
        await waitFor(() => expect(screen.getByText(/Memba #0004/)).toBeInTheDocument())
        fireEvent.click(screen.getByRole("button", { name: /^Mint \(20 GNOT\)$/ }))
        await waitFor(() => expect(screen.getByText(/Misprint/)).toBeInTheDocument())
    })
})
