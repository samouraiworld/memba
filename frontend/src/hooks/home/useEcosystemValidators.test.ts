/**
 * useEcosystemValidators.test.ts
 *
 * Covers:
 * 1. Returns the validator list + total from getValidators()
 * 2. Preserves getValidators()'s voting-power ordering (does not re-sort/reverse)
 * 3. Returns [] / total 0 (band omits section) when getValidators() is empty
 * 4. Degrades gracefully — getValidators() resolving [] on error → empty list
 * 5. Cheap subset — names rows via fetchValoperMonikers (1 cached call), but the
 *    HEAVY enrichment fns (signatures / net-peers) are NEVER called
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import React from "react"
import { applyMonikers } from "./useEcosystemValidators"
import type { ValidatorInfo } from "../../lib/validators"
import { ValidatorHealthStatus } from "../../lib/validatorHealth"

vi.mock("../../lib/validators", () => ({
    getValidators: vi.fn(),
    // Moniker resolution IS allowed — it's one cached Render parse. Default to an
    // empty map; individual tests override to verify enrichment.
    fetchValoperMonikers: vi.fn().mockResolvedValue(new Map<string, string>()),
    // The HEAVY enrichment fns must never run on the home band — mock to throw.
    fetchLastBlockSignatures: vi.fn().mockRejectedValue(new Error("MUST NOT BE CALLED: fetchLastBlockSignatures")),
    getAggregatedNetPeers: vi.fn().mockRejectedValue(new Error("MUST NOT BE CALLED: getAggregatedNetPeers")),
}))

vi.mock("../useNetwork", () => ({
    useNetwork: vi.fn(() => ({ networkKey: "test13", rpcUrl: "https://rpc.test13.gno.land" })),
}))

const validatorMod = await import("../../lib/validators")

function makeWrapper() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return function Wrapper({ children }: { children: ReactNode }) {
        return React.createElement(QueryClientProvider, { client }, children)
    }
}

function makeValidator(overrides: Partial<ValidatorInfo> = {}): ValidatorInfo {
    return {
        address: "g1test",
        gnoAddr: "g1test",
        moniker: "test-val",
        pubkey: "",
        pubkeyType: "unknown",
        votingPower: 10,
        powerPercent: 100,
        rank: 1,
        active: true,
        proposerPriority: 0,
        participationRate: null,
        uptimePercent: null,
        profileUrl: "",
        lastBlockSignatures: [],
        startTime: "",
        healthStatus: ValidatorHealthStatus.Healthy,
        healthMeta: null,
        missedBlocks: null,
        incidents: [],
        operationTime: null,
        txContrib: null,
        lastIncidentDate: null,
        ...overrides,
    }
}

describe("useEcosystemValidators", () => {
    beforeEach(() => vi.clearAllMocks())

    it("returns the validator list and total from getValidators()", async () => {
        const validators = [
            makeValidator({ moniker: "alpha", votingPower: 30, powerPercent: 60 }),
            makeValidator({ moniker: "bravo", votingPower: 20, powerPercent: 40 }),
        ]
        vi.mocked(validatorMod.getValidators).mockResolvedValue(validators)

        const { useEcosystemValidators } = await import("./useEcosystemValidators")
        const { result } = renderHook(() => useEcosystemValidators(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(result.current.total).toBe(2)
        // Preserves getValidators()'s power-desc ordering.
        expect(result.current.validators.map((v) => v.moniker)).toEqual(["alpha", "bravo"])
    })

    it("returns [] / total 0 when getValidators() resolves []", async () => {
        vi.mocked(validatorMod.getValidators).mockResolvedValue([])

        const { useEcosystemValidators } = await import("./useEcosystemValidators")
        const { result } = renderHook(() => useEcosystemValidators(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(result.current.validators).toEqual([])
        expect(result.current.total).toBe(0)
    })

    it("names unnamed rows via fetchValoperMonikers (one cached call)", async () => {
        vi.mocked(validatorMod.getValidators).mockResolvedValue([
            makeValidator({ gnoAddr: "g1aaa", moniker: "" }),
        ])
        vi.mocked(validatorMod.fetchValoperMonikers).mockResolvedValue(new Map([["g1aaa", "gno-core-01"]]))

        const { useEcosystemValidators } = await import("./useEcosystemValidators")
        const { result } = renderHook(() => useEcosystemValidators(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(result.current.validators[0].moniker).toBe("gno-core-01")
        expect(validatorMod.fetchValoperMonikers).toHaveBeenCalledTimes(1)
    })

    it("does NOT call the HEAVY enrichment fns (signatures / net-peers)", async () => {
        vi.mocked(validatorMod.getValidators).mockResolvedValue([makeValidator()])

        const { useEcosystemValidators } = await import("./useEcosystemValidators")
        const { result } = renderHook(() => useEcosystemValidators(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(validatorMod.fetchLastBlockSignatures).not.toHaveBeenCalled()
        expect(validatorMod.getAggregatedNetPeers).not.toHaveBeenCalled()
    })
})

describe("applyMonikers", () => {
    const v = (gnoAddr: string, moniker = ""): ValidatorInfo =>
        ({ gnoAddr, moniker, powerPercent: 10, active: true } as unknown as ValidatorInfo)

    it("names a validator from the map when it has none", () => {
        expect(applyMonikers([v("g1aaa")], new Map([["g1aaa", "gno-core-01"]]))[0].moniker).toBe("gno-core-01")
    })

    it("keeps an existing moniker over the map", () => {
        expect(applyMonikers([v("g1aaa", "already")], new Map([["g1aaa", "from-map"]]))[0].moniker).toBe("already")
    })

    it("leaves moniker empty when the address is not in the map", () => {
        expect(applyMonikers([v("g1bbb")], new Map([["g1aaa", "x"]]))[0].moniker).toBe("")
    })

    it("preserves order and length", () => {
        const out = applyMonikers([v("g1a"), v("g1b"), v("g1c")], new Map([["g1b", "mid"]]))
        expect(out.map((x) => x.gnoAddr)).toEqual(["g1a", "g1b", "g1c"])
        expect(out[1].moniker).toBe("mid")
    })
})
