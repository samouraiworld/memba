import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock the config predicates so we can drive each lane's flag/realm state.
vi.mock("../config", () => ({
    isNftEnabled: vi.fn(() => false),
    isNftMarketV3Valid: vi.fn(() => false),
    isServicesEnabled: vi.fn(() => false),
    isEscrowValid: vi.fn(() => false),
    isTokensEnabled: vi.fn(() => false),
    isTokenOtcValid: vi.fn(() => false),
    isAgentsEnabled: vi.fn(() => false),
    isAgentRegistryValid: vi.fn(() => false),
}))

import { getLiveLanes, isLaneLive, LANES } from "./lanes"
import * as config from "../config"

const setLane = (
    nftEnabled: boolean,
    nftValid: boolean,
    svcEnabled: boolean,
    escrowValid: boolean,
    tokenEnabled: boolean = false,
    tokenValid: boolean = false,
    agentEnabled: boolean = false,
    agentValid: boolean = false,
) => {
    vi.mocked(config.isNftEnabled).mockReturnValue(nftEnabled)
    vi.mocked(config.isNftMarketV3Valid).mockReturnValue(nftValid)
    vi.mocked(config.isServicesEnabled).mockReturnValue(svcEnabled)
    vi.mocked(config.isEscrowValid).mockReturnValue(escrowValid)
    vi.mocked(config.isTokensEnabled).mockReturnValue(tokenEnabled)
    vi.mocked(config.isTokenOtcValid).mockReturnValue(tokenValid)
    vi.mocked(config.isAgentsEnabled).mockReturnValue(agentEnabled)
    vi.mocked(config.isAgentRegistryValid).mockReturnValue(agentValid)
}

describe("marketplace lane registry (panel C2 — tab renders only when live)", () => {
    beforeEach(() => setLane(false, false, false, false))

    it("registers the v1 lanes in order (nft, service, token, agent)", () => {
        expect(LANES.map((l) => l.assetType)).toEqual(["nft", "service", "token", "agent"])
    })

    it("shows NO lanes when nothing is live (no 'coming soon' tabs)", () => {
        expect(getLiveLanes()).toHaveLength(0)
    })

    it("NFT lane needs BOTH the flag and the v3 realm valid", () => {
        setLane(true, false, false, false) // flag on, realm not valid (v3 not registered)
        expect(isLaneLive("nft")).toBe(false)
        setLane(false, true, false, false) // realm valid, flag off
        expect(isLaneLive("nft")).toBe(false)
        setLane(true, true, false, false) // both → live
        expect(isLaneLive("nft")).toBe(true)
    })

    it("Services lane needs BOTH the flag and the escrow realm valid", () => {
        setLane(false, false, true, false)
        expect(isLaneLive("service")).toBe(false)
        setLane(false, false, true, true)
        expect(isLaneLive("service")).toBe(true)
    })

    it("Token lane needs BOTH the flag and the otc realm valid", () => {
        setLane(false, false, false, false, true, false)
        expect(isLaneLive("token")).toBe(false)
        setLane(false, false, false, false, true, true)
        expect(isLaneLive("token")).toBe(true)
    })

    it("Agent lane needs BOTH the flag and the registry realm valid", () => {
        setLane(false, false, false, false, false, false, true, false)
        expect(isLaneLive("agent")).toBe(false)
        setLane(false, false, false, false, false, false, true, true)
        expect(isLaneLive("agent")).toBe(true)
    })

    it("getLiveLanes returns exactly the live lanes", () => {
        setLane(true, true, false, false) // only nft live
        expect(getLiveLanes().map((l) => l.assetType)).toEqual(["nft"])
        setLane(true, true, true, true, true, true, true, true) // all live
        expect(getLiveLanes().map((l) => l.assetType)).toEqual(["nft", "service", "token", "agent"])
    })
})
