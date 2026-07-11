import { afterEach, describe, expect, it, vi } from "vitest"
import { fetchAllowlistProof, fetchMintTicket } from "./nftApi"

const okJson = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

afterEach(() => vi.unstubAllGlobals())

describe("Genesis mint launch endpoints", () => {
    it("fetchMintTicket returns the ticket", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
            okJson({ tid: 3, edition: 4, tokenURI: "ipfs://CID/Memba_0004.json" }),
        ))
        expect(await fetchMintTicket()).toEqual({ tid: 3, edition: 4, tokenURI: "ipfs://CID/Memba_0004.json" })
    })

    it("fetchMintTicket returns null on 404 (feature off) and on network error", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })))
        expect(await fetchMintTicket()).toBeNull()
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")))
        expect(await fetchMintTicket()).toBeNull()
    })

    it("fetchAllowlistProof returns the proof, encodes the address, nulls on 404", async () => {
        const spy = vi.fn().mockResolvedValue(okJson({ root: "ab", maxQty: 2, proof: "aa,bb" }))
        vi.stubGlobal("fetch", spy)
        expect(await fetchAllowlistProof("g1x")).toEqual({ root: "ab", maxQty: 2, proof: "aa,bb" })
        expect(String(spy.mock.calls[0][0])).toContain("/api/nft/allowlist-proof?address=g1x")
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })))
        expect(await fetchAllowlistProof("g1x")).toBeNull()
    })
})
