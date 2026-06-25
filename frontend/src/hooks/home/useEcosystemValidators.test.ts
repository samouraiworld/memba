/**
 * useEcosystemValidators.test.ts
 *
 * Covers:
 * 1. Returns the validator list + total from getValidators()
 * 2. Preserves getValidators()'s voting-power ordering (does not re-sort/reverse)
 * 3. Returns [] / total 0 (band omits section) when getValidators() is empty
 * 4. Degrades gracefully — getValidators() resolving [] on error → empty list
 * 5. Cheap subset only — the heavy enrichment fns are NEVER called
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import React from "react"
import type { ValidatorInfo } from "../../lib/validators"
import { ValidatorHealthStatus } from "../../lib/validatorHealth"

vi.mock("../../lib/validators", () => ({
    getValidators: vi.fn(),
    // Heavy enrichment fns: mock to throw so any accidental call fails the test
    fetchLastBlockSignatures: vi.fn().mockRejectedValue(new Error("MUST NOT BE CALLED: fetchLastBlockSignatures")),
    fetchValoperMonikers: vi.fn().mockRejectedValue(new Error("MUST NOT BE CALLED: fetchValoperMonikers")),
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

    it("does NOT call the heavy enrichment fns (cheap subset only)", async () => {
        vi.mocked(validatorMod.getValidators).mockResolvedValue([makeValidator()])

        const { useEcosystemValidators } = await import("./useEcosystemValidators")
        const { result } = renderHook(() => useEcosystemValidators(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(validatorMod.fetchLastBlockSignatures).not.toHaveBeenCalled()
        expect(validatorMod.fetchValoperMonikers).not.toHaveBeenCalled()
        expect(validatorMod.getAggregatedNetPeers).not.toHaveBeenCalled()
    })
})
