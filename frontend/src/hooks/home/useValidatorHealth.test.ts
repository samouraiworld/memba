/**
 * useValidatorHealth.test.ts
 *
 * Covers:
 * 1. Healthy case — 14 active validators, all healthy
 * 2. Degraded case — some degraded validators
 * 3. Down case — some down validators
 * 4. Error case — getValidators throws → hook degrades gracefully
 * 5. Cheap subset only — fetchLastBlockSignatures, fetchValoperMonikers,
 *    getAggregatedNetPeers are NEVER called
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import React from "react"
import type { ValidatorInfo } from "../../lib/validators"
import { ValidatorHealthStatus } from "../../lib/validatorHealth"
import type { HomeSnapshot } from "../../lib/homeApi"

// ── Module-level mocks ────────────────────────────────────────

vi.mock("../../lib/validators", () => ({
    getValidators: vi.fn(),
    // Heavy enrichment fns: mock to throw so any accidental call fails the test
    fetchLastBlockSignatures: vi.fn().mockRejectedValue(new Error("MUST NOT BE CALLED: fetchLastBlockSignatures")),
    fetchValoperMonikers: vi.fn().mockRejectedValue(new Error("MUST NOT BE CALLED: fetchValoperMonikers")),
    getAggregatedNetPeers: vi.fn().mockRejectedValue(new Error("MUST NOT BE CALLED: getAggregatedNetPeers")),
}))

vi.mock("../../lib/validatorHealth", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../lib/validatorHealth")>()
    return {
        ...actual,
        computeNetworkHealth: vi.fn(),
    }
})

vi.mock("../useNetwork", () => ({
    useNetwork: vi.fn(() => ({
        networkKey: "test13",
        rpcUrl: "https://rpc.test13.gno.land",
    })),
}))

// Default: snapshot not usable → on-chain path active for existing tests
vi.mock("./useHomeSnapshot", () => ({
    useHomeSnapshot: vi.fn(() => ({ snapshot: null, usable: false, isLoading: false })),
}))

// ── Resolve mocked modules for per-test control ───────────────

const validatorMod = await import("../../lib/validators")
const healthMod = await import("../../lib/validatorHealth")
const homeSnapshotMod = await import("./useHomeSnapshot")

// ── Wrapper ───────────────────────────────────────────────────

function makeWrapper() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return function Wrapper({ children }: { children: ReactNode }) {
        return React.createElement(QueryClientProvider, { client }, children)
    }
}

// ── Helpers ───────────────────────────────────────────────────

/** Build a minimal ValidatorInfo with overridable healthStatus + active flag */
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

// ── Tests ─────────────────────────────────────────────────────

describe("useValidatorHealth — healthy case", () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it("status is 'healthy' with 14 active healthy validators", async () => {
        const validators = Array.from({ length: 14 }, () =>
            makeValidator({ healthStatus: ValidatorHealthStatus.Healthy }),
        )
        vi.mocked(validatorMod.getValidators).mockResolvedValue(validators)
        vi.mocked(healthMod.computeNetworkHealth).mockReturnValue({
            total: 14,
            healthy: 14,
            degraded: 0,
            down: 0,
            unknown: 0,
            avgUptime: null,
            latestIncident: null,
        })

        const { useValidatorHealth } = await import("./useValidatorHealth")
        const { result } = renderHook(() => useValidatorHealth(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(result.current.status).toBe("healthy")
        expect(result.current.active).toBe(14)
        expect(result.current.total).toBe(14)
    })
})

describe("useValidatorHealth — degraded case", () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it("status is 'degraded' when degraded > 0 and down === 0", async () => {
        const validators = [
            ...Array.from({ length: 12 }, () => makeValidator({ healthStatus: ValidatorHealthStatus.Healthy })),
            ...Array.from({ length: 2 }, () => makeValidator({ healthStatus: ValidatorHealthStatus.Degraded })),
        ]
        vi.mocked(validatorMod.getValidators).mockResolvedValue(validators)
        vi.mocked(healthMod.computeNetworkHealth).mockReturnValue({
            total: 14,
            healthy: 12,
            degraded: 2,
            down: 0,
            unknown: 0,
            avgUptime: null,
            latestIncident: null,
        })

        const { useValidatorHealth } = await import("./useValidatorHealth")
        const { result } = renderHook(() => useValidatorHealth(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(result.current.status).toBe("degraded")
    })
})

describe("useValidatorHealth — down case", () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it("status is 'down' when down > 0 (even if degraded > 0 too)", async () => {
        const validators = [
            ...Array.from({ length: 10 }, () => makeValidator({ healthStatus: ValidatorHealthStatus.Healthy })),
            ...Array.from({ length: 2 }, () => makeValidator({ healthStatus: ValidatorHealthStatus.Degraded })),
            ...Array.from({ length: 2 }, () => makeValidator({ healthStatus: ValidatorHealthStatus.Down })),
        ]
        vi.mocked(validatorMod.getValidators).mockResolvedValue(validators)
        vi.mocked(healthMod.computeNetworkHealth).mockReturnValue({
            total: 14,
            healthy: 10,
            degraded: 2,
            down: 2,
            unknown: 0,
            avgUptime: null,
            latestIncident: null,
        })

        const { useValidatorHealth } = await import("./useValidatorHealth")
        const { result } = renderHook(() => useValidatorHealth(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(result.current.status).toBe("down")
    })
})

describe("useValidatorHealth — error case", () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it("degrades gracefully when getValidators throws (returns loading=false with defaults)", async () => {
        vi.mocked(validatorMod.getValidators).mockRejectedValue(new Error("RPC timeout"))

        const { useValidatorHealth } = await import("./useValidatorHealth")
        const { result } = renderHook(() => useValidatorHealth(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        // Should not throw. On error, status must be "unknown" — NOT a false
        // "healthy" (truthful UI: never imply health when the data failed to load).
        expect(result.current.status).toBe("unknown")
        expect(result.current.active).toBe(0)
        expect(result.current.total).toBe(0)
        expect(result.current.latestIncident).toBeNull()
    })
})

describe("useValidatorHealth — cheap subset only", () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it("does NOT call fetchLastBlockSignatures", async () => {
        vi.mocked(validatorMod.getValidators).mockResolvedValue([makeValidator()])
        vi.mocked(healthMod.computeNetworkHealth).mockReturnValue({
            total: 1, healthy: 1, degraded: 0, down: 0, unknown: 0,
            avgUptime: null, latestIncident: null,
        })

        const { useValidatorHealth } = await import("./useValidatorHealth")
        const { result } = renderHook(() => useValidatorHealth(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(validatorMod.fetchLastBlockSignatures).not.toHaveBeenCalled()
    })

    it("does NOT call fetchValoperMonikers", async () => {
        vi.mocked(validatorMod.getValidators).mockResolvedValue([makeValidator()])
        vi.mocked(healthMod.computeNetworkHealth).mockReturnValue({
            total: 1, healthy: 1, degraded: 0, down: 0, unknown: 0,
            avgUptime: null, latestIncident: null,
        })

        const { useValidatorHealth } = await import("./useValidatorHealth")
        const { result } = renderHook(() => useValidatorHealth(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(validatorMod.fetchValoperMonikers).not.toHaveBeenCalled()
    })

    it("does NOT call getAggregatedNetPeers", async () => {
        vi.mocked(validatorMod.getValidators).mockResolvedValue([makeValidator()])
        vi.mocked(healthMod.computeNetworkHealth).mockReturnValue({
            total: 1, healthy: 1, degraded: 0, down: 0, unknown: 0,
            avgUptime: null, latestIncident: null,
        })

        const { useValidatorHealth } = await import("./useValidatorHealth")
        const { result } = renderHook(() => useValidatorHealth(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(validatorMod.getAggregatedNetPeers).not.toHaveBeenCalled()
    })
})

describe("useValidatorHealth — snapshot usable", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(homeSnapshotMod.useHomeSnapshot).mockReturnValue({
            snapshot: {
                validatorsHealth: { status: "degraded", active: 12, total: 14 },
            } as unknown as HomeSnapshot,
            usable: true,
            isLoading: false,
        })
    })

    it("returns status/active/total from snapshot.validatorsHealth", async () => {
        const { useValidatorHealth } = await import("./useValidatorHealth")
        const { result } = renderHook(() => useValidatorHealth(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(result.current.status).toBe("degraded")
        expect(result.current.active).toBe(12)
        expect(result.current.total).toBe(14)
    })

    it("returns avgUptime=null and latestIncident=null (not in snapshot v1)", async () => {
        const { useValidatorHealth } = await import("./useValidatorHealth")
        const { result } = renderHook(() => useValidatorHealth(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(result.current.avgUptime).toBeNull()
        expect(result.current.latestIncident).toBeNull()
    })

    it("does NOT call getValidators when snapshot is usable (query gated off)", async () => {
        const { useValidatorHealth } = await import("./useValidatorHealth")
        const { result } = renderHook(() => useValidatorHealth(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(validatorMod.getValidators).not.toHaveBeenCalled()
    })
})

describe("useValidatorHealth — snapshot NOT usable (fallback to on-chain)", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(homeSnapshotMod.useHomeSnapshot).mockReturnValue({
            snapshot: null,
            usable: false,
            isLoading: false,
        })
    })

    it("calls getValidators and returns on-chain values when snapshot is not usable", async () => {
        const validators = Array.from({ length: 10 }, () =>
            makeValidator({ healthStatus: ValidatorHealthStatus.Healthy }),
        )
        vi.mocked(validatorMod.getValidators).mockResolvedValue(validators)
        vi.mocked(healthMod.computeNetworkHealth).mockReturnValue({
            total: 10,
            healthy: 10,
            degraded: 0,
            down: 0,
            unknown: 0,
            avgUptime: null,
            latestIncident: null,
        })

        const { useValidatorHealth } = await import("./useValidatorHealth")
        const { result } = renderHook(() => useValidatorHealth(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(validatorMod.getValidators).toHaveBeenCalled()
        expect(result.current.status).toBe("healthy")
        expect(result.current.active).toBe(10)
        expect(result.current.total).toBe(10)
    })
})
