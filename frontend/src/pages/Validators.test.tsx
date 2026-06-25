import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import { renderWithProviders } from "../test/test-utils"
import type { ValidatorInfo, NetworkStats } from "../lib/validators"
import type { ValoperWithStatus } from "../lib/valopers"

// Shared fixtures. Wrapped in vi.hoisted so the (hoisted) vi.mock factories
// below can reference them without a "cannot access before initialization" TDZ.
const { VALIDATOR, STATS, VALOPER } = vi.hoisted(() => {
    // One fully-formed validator so the table renders a row. The page derives
    // the health status itself (real validatorHealth), so we leave it minimal.
    const VALIDATOR = {
        address: "ABCDEF0123456789",
        gnoAddr: "g1validatoraddr00000000000000000000000000",
        moniker: "test-validator",
        pubkey: "cHVia2V5",
        pubkeyType: "tendermint/PubKeyEd25519",
        votingPower: 1000,
        powerPercent: 100,
        rank: 1,
        active: true,
        proposerPriority: 0,
        participationRate: null,
        uptimePercent: null,
        profileUrl: "",
        lastBlockSignatures: [],
        startTime: new Date().toISOString(),
        healthStatus: "unknown",
        healthMeta: null,
        missedBlocks: null,
        incidents: [],
        operationTime: null,
        txContrib: null,
        lastIncidentDate: null,
    } as unknown as ValidatorInfo

    const STATS = {
        blockHeight: 12345,
        avgBlockTime: 5,
        totalValidators: 1,
        totalVotingPower: 1000,
        catchingUp: false,
    } as unknown as NetworkStats

    // One registered operator so the valoper panel renders its container.
    const VALOPER = {
        moniker: "test-valoper",
        operatorAddress: "g1operator00000000000000000000000000000000",
        signingAddress: "g1signing000000000000000000000000000000000",
        signingPubKey: "",
        serverType: "cloud",
        description: "",
        status: "active",
    } as unknown as ValoperWithStatus

    return { VALIDATOR, STATS, VALOPER }
})

// Mock the data layer: keep the real pure helpers (formatters, types) and only
// stub the network fetchers + the merge passthroughs the page calls.
vi.mock("../lib/validators", async () => {
    const actual = await vi.importActual<typeof import("../lib/validators")>("../lib/validators")
    return {
        ...actual,
        getValidators: vi.fn().mockResolvedValue([VALIDATOR]),
        getNetworkStats: vi.fn().mockResolvedValue(STATS),
        getAggregatedNetPeers: vi.fn().mockResolvedValue(null),
        fetchValoperMonikers: vi.fn().mockResolvedValue(new Map()),
        mergeValoperMonikers: vi.fn((vals: ValidatorInfo[]) => vals),
        mergeWithMonitoringData: vi.fn((vals: ValidatorInfo[]) => vals),
        fetchLastBlockSignatures: vi.fn().mockResolvedValue(new Map()),
    }
})

vi.mock("../lib/gnomonitoring", () => ({
    fetchAllMonitoringData: vi.fn().mockResolvedValue(new Map()),
}))

vi.mock("../lib/valopers", async () => {
    const actual = await vi.importActual<typeof import("../lib/valopers")>("../lib/valopers")
    return {
        ...actual,
        fetchValopers: vi.fn().mockResolvedValue([VALOPER]),
    }
})

// Stub the heavy network-roster leaf — irrelevant to section order and avoids
// pulling in telemetry plumbing.
vi.mock("../components/validators/NetworkNodesRoster", () => ({
    NetworkNodesRoster: () => null,
}))

import Validators from "./Validators"

describe("Validators page — section order", () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it("renders the live metrics table BEFORE the valoper roster in document order", async () => {
        renderWithProviders(<Validators />, { route: "/test13/validators" })

        // Wait for the async loadData to populate both sections.
        const table = await screen.findByTestId("validator-table")
        const valoperPanel = await waitFor(() => screen.getByTestId("valoper-panel"))

        // compareDocumentPosition: DOCUMENT_POSITION_FOLLOWING (4) is set on the
        // result when `valoperPanel` comes AFTER `table` in the tree.
        const position = table.compareDocumentPosition(valoperPanel)
        expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        // And the inverse must NOT hold (valoper panel does not precede the table).
        expect(position & Node.DOCUMENT_POSITION_PRECEDING).toBeFalsy()
    })
})
