/**
 * useCollectionAdmin — unit tests.
 *
 * Covers:
 *  - isAdmin true/false based on wallet address vs collection admin
 *  - run() calls doContractBroadcast and sets notice on success
 *  - a rejected fetchCollectionDetail clears loading and sets error (robustness)
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import { useCollectionAdmin } from "./useCollectionAdmin"

// ── Constants ───────────────────────────────────────────────────

const ME = "g1samourai000000000000000000000000001"
const OTHER = "g1other0000000000000000000000000000002"
const COL_ID = `${ME}/cool-collection`

const BASE_COL = {
    name: "Cool Collection",
    symbol: "COOL",
    id: COL_ID,
    creator: ME,
    admin: ME,
    royaltyBps: 500,
    royaltyRecip: ME,
    phase: 2,
    mintPrice: 1_000_000,
    payDenom: "ugnot",
    minted: 0,
    maxSupply: 100,
    paused: false,
}

// ── Mocks ────────────────────────────────────────────────────────

const mockFetchCollectionDetail = vi.fn()
vi.mock("../../lib/launchpadReads", () => ({
    fetchCollectionDetail: (...args: unknown[]) => mockFetchCollectionDetail(...args),
}))

const mockDoContractBroadcast = vi.fn()
vi.mock("../../lib/grc20", () => ({
    doContractBroadcast: (...args: unknown[]) => mockDoContractBroadcast(...args),
}))

// mock friendlyError to pass through the message for easy assertion
vi.mock("../../lib/errorMessages", () => ({
    friendlyError: (e: unknown) =>
        e instanceof Error ? e.message : String(e),
}))

// Mock useOutletContext per address controlled by each test group
let mockAddress = ME

vi.mock("react-router-dom", async (orig) => {
    const mod = await orig<typeof import("react-router-dom")>()
    return {
        ...mod,
        useOutletContext: () => ({ adena: { address: mockAddress } }),
    }
})

// ── Helpers ──────────────────────────────────────────────────────

const MSG = { type: "vm/MsgCall", value: { caller: ME, send: "", pkg_path: "gno.land/r/foo", func: "Bar", args: [] } }

// ── Tests ─────────────────────────────────────────────────────────

describe("useCollectionAdmin — isAdmin", () => {
    beforeEach(() => {
        mockAddress = ME
        mockFetchCollectionDetail.mockResolvedValue({ ...BASE_COL })
    })

    it("isAdmin is true when me === col.admin", async () => {
        const { result } = renderHook(() => useCollectionAdmin(COL_ID))
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.isAdmin).toBe(true)
        expect(result.current.me).toBe(ME)
    })

    it("isAdmin is false when me !== col.admin", async () => {
        mockAddress = OTHER
        mockFetchCollectionDetail.mockResolvedValue({ ...BASE_COL, admin: ME })
        const { result } = renderHook(() => useCollectionAdmin(COL_ID))
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.isAdmin).toBe(false)
        expect(result.current.me).toBe(OTHER)
    })

    it("isAdmin is false when me is empty (not connected)", async () => {
        mockAddress = ""
        const { result } = renderHook(() => useCollectionAdmin(COL_ID))
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.isAdmin).toBe(false)
    })
})

describe("useCollectionAdmin — run()", () => {
    beforeEach(() => {
        mockAddress = ME
        mockFetchCollectionDetail.mockResolvedValue({ ...BASE_COL })
        mockDoContractBroadcast.mockResolvedValue({ hash: "0xabc" })
    })

    it("calls doContractBroadcast with [msg] and memo", async () => {
        const { result } = renderHook(() => useCollectionAdmin(COL_ID))
        await waitFor(() => expect(result.current.loading).toBe(false))

        await act(async () => {
            await result.current.run(MSG, "test memo")
        })

        expect(mockDoContractBroadcast).toHaveBeenCalledWith([MSG], "test memo")
    })

    it("sets notice on success", async () => {
        const { result } = renderHook(() => useCollectionAdmin(COL_ID))
        await waitFor(() => expect(result.current.loading).toBe(false))

        await act(async () => {
            await result.current.run(MSG, "Set phase")
        })

        // notice = `${memo} ✓`
        expect(result.current.notice).toBe("Set phase ✓")
        expect(result.current.error).toBeNull()
    })

    it("sets error via friendlyError on broadcast failure", async () => {
        mockDoContractBroadcast.mockRejectedValue(new Error("user rejected"))
        const { result } = renderHook(() => useCollectionAdmin(COL_ID))
        await waitFor(() => expect(result.current.loading).toBe(false))

        await act(async () => {
            await result.current.run(MSG, "Set phase")
        })

        expect(result.current.error).toBe("user rejected")
        expect(result.current.notice).toBeNull()
    })
})

describe("useCollectionAdmin — robustness: rejected fetch", () => {
    beforeEach(() => {
        mockAddress = ME
    })

    it("clears loading and sets error when fetchCollectionDetail rejects", async () => {
        mockFetchCollectionDetail.mockRejectedValue(new Error("network error"))
        const { result } = renderHook(() => useCollectionAdmin(COL_ID))

        // loading must clear even on fetch failure
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.error).not.toBeNull()
        expect(result.current.col).toBeNull()
    })
})

describe("useCollectionAdmin — reload()", () => {
    beforeEach(() => {
        mockAddress = ME
        mockFetchCollectionDetail.mockReset()
        mockFetchCollectionDetail.mockResolvedValue({ ...BASE_COL })
        mockDoContractBroadcast.mockResolvedValue({ hash: "0xabc" })
    })

    it("reload() re-fetches the collection", async () => {
        const { result } = renderHook(() => useCollectionAdmin(COL_ID))
        await waitFor(() => expect(result.current.loading).toBe(false))

        // fetchCollectionDetail should have been called once on mount
        expect(mockFetchCollectionDetail).toHaveBeenCalledTimes(1)

        await act(async () => {
            result.current.reload()
        })

        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(mockFetchCollectionDetail).toHaveBeenCalledTimes(2)
    })
})
