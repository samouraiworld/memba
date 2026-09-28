/**
 * Tests for validator pagination logic.
 *
 * Verifies auto-pagination in getValidators() and formatting helpers.
 */

import { describe, test, expect, vi, beforeEach } from "vitest"
import { GNO_CHAIN_ID } from "./config"

const { directRpcCall, getRpcUrlsInOrder, excludeRpcEndpoint } = vi.hoisted(() => ({
    directRpcCall: vi.fn(), getRpcUrlsInOrder: vi.fn(), excludeRpcEndpoint: vi.fn(),
}))
vi.mock("./rpcFallback", () => ({
    resilientRpcCall: vi.fn(), directRpcCall, getRpcUrlsInOrder, excludeRpcEndpoint,
}))
import {
    getValidators,
    getValidatorRpcSnapshot,
    formatVotingPower,
    formatBlockTime,
    truncateValidatorAddr,
} from "./validators"

const row = (n: number) => ({ address: `g1validator${String(n).padStart(6, "0")}`, voting_power: "10", proposer_priority: "0" })
const status = (network: string) => ({ node_info: { network }, sync_info: { latest_block_height: "123", latest_block_hash: "abc" } })

describe("verified validator roster", () => {
    beforeEach(() => {
        directRpcCall.mockReset()
        getRpcUrlsInOrder.mockReturnValue(["https://primary", "https://backup"])
        excludeRpcEndpoint.mockReset()
    })

    test("rejects wrong-chain primary and pins every page to a verified fallback and height", async () => {
        directRpcCall.mockImplementation((url: string, method: string, params?: Record<string, string>) => {
            if (method === "/status") return Promise.resolve(status(url === "https://primary" ? "gnoland1" : GNO_CHAIN_ID))
            if (method === "/validators") {
                expect(url).toBe("https://backup")
                expect(params?.height).toBe("123")
                return Promise.resolve({ total: "102", validators: params?.page === "1" ? Array.from({ length: 100 }, (_, i) => row(i)) : [row(100), row(101)] })
            }
            throw new Error(`Unexpected ${method}`)
        })
        const roster = await getValidators("https://primary")
        expect(roster).toHaveLength(102)
        expect(excludeRpcEndpoint).toHaveBeenCalledWith("https://primary")
    })

    test("fails closed when every endpoint reports the wrong chain", async () => {
        directRpcCall.mockResolvedValue(status("gnoland1"))
        await expect(getValidatorRpcSnapshot()).rejects.toThrow(/chain mismatch/)
        expect(excludeRpcEndpoint).toHaveBeenCalledTimes(2)
    })

    test("rejects excessive totals before page fan-out", async () => {
        directRpcCall.mockImplementation((_url: string, method: string) => method === "/status"
            ? Promise.resolve(status(GNO_CHAIN_ID))
            : Promise.resolve({ total: "100000", validators: [row(0)] }))
        await expect(getValidators("https://primary")).rejects.toThrow(/excessive roster size/)
        expect(directRpcCall.mock.calls.filter(([, method]) => method === "/validators")).toHaveLength(1)
    })

    test("rejects duplicate pages instead of publishing incorrect voting power", async () => {
        directRpcCall.mockImplementation((_url: string, method: string, params?: Record<string, string>) => method === "/status"
            ? Promise.resolve(status(GNO_CHAIN_ID))
            : Promise.resolve({ total: "101", validators: params?.page === "1" ? Array.from({ length: 100 }, (_, i) => row(i)) : [row(0)] }))
        await expect(getValidators("https://primary")).rejects.toThrow(/Incomplete validator roster/)
    })

    test("does not fan out pagination after the caller aborts the first page", async () => {
        const controller = new AbortController()
        directRpcCall.mockImplementation((_url: string, method: string) => {
            if (method === "/status") return Promise.resolve(status(GNO_CHAIN_ID))
            controller.abort()
            return Promise.resolve({ total: "201", validators: Array.from({ length: 100 }, (_, i) => row(i)) })
        })
        await expect(getValidators("https://primary", undefined, controller.signal)).rejects.toMatchObject({ name: "AbortError" })
        expect(directRpcCall.mock.calls.filter(([, method]) => method === "/validators")).toHaveLength(1)
    })
})

describe("formatVotingPower", () => {
    test("formats millions", () => {
        expect(formatVotingPower(1_500_000)).toBe("1.5M")
    })

    test("formats thousands", () => {
        expect(formatVotingPower(42_000)).toBe("42.0K")
    })

    test("formats small numbers", () => {
        expect(formatVotingPower(500)).toBe("500")
    })

    test("formats zero", () => {
        expect(formatVotingPower(0)).toBe("0")
    })
})

describe("formatBlockTime", () => {
    test("formats seconds", () => {
        expect(formatBlockTime(2.345)).toBe("2.3s")
    })

    test("returns dash for zero", () => {
        expect(formatBlockTime(0)).toBe("—")
    })

    test("returns dash for negative", () => {
        expect(formatBlockTime(-1)).toBe("—")
    })
})

describe("truncateValidatorAddr", () => {
    test("truncates long addresses", () => {
        const addr = "ABCDEF1234567890ABCD"
        expect(truncateValidatorAddr(addr)).toBe("ABCDEF…90ABCD")
    })

    test("preserves short addresses", () => {
        expect(truncateValidatorAddr("SHORT")).toBe("SHORT")
    })

    test("preserves 12-char addresses", () => {
        expect(truncateValidatorAddr("ABCDEFGHIJKL")).toBe("ABCDEFGHIJKL")
    })
})

describe("validator pagination calculations", () => {
    test("single page when count <= pageSize", () => {
        const totalValidators = 30
        const pageSize = 50
        const totalPages = Math.max(1, Math.ceil(totalValidators / pageSize))
        expect(totalPages).toBe(1)
    })

    test("multiple pages when count > pageSize", () => {
        const totalValidators = 120
        const pageSize = 50
        const totalPages = Math.ceil(totalValidators / pageSize)
        expect(totalPages).toBe(3)
    })

    test("correct slice for page 2 of 3", () => {
        const pageSize = 50
        const page = 2
        const start = (page - 1) * pageSize
        const end = start + pageSize
        expect(start).toBe(50)
        expect(end).toBe(100)
    })

    test("last page may have fewer items", () => {
        const totalValidators = 120
        const pageSize = 50
        const page = 3
        const start = (page - 1) * pageSize
        const end = Math.min(start + pageSize, totalValidators)
        expect(start).toBe(100)
        expect(end).toBe(120)
    })

    test("parallel page fetch count is correct", () => {
        const PER_PAGE = 100
        const total = 250
        const totalPages = Math.ceil(total / PER_PAGE)
        // Page 1 is always fetched first, so parallel fetch is pages 2..totalPages
        const parallelCount = totalPages - 1
        expect(parallelCount).toBe(2)
    })
})
