import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ACTIVE_NETWORK_KEY, NETWORK_PREF_STORAGE_KEY } from "../../lib/config"

vi.mock("../../lib/quests", () => ({ completeQuest: vi.fn(), getQuestWalletAddress: vi.fn(() => "g1quest") }))
vi.mock("../../lib/questVerifier", () => ({ trackNetworkVisit: vi.fn() }))

// The OS network is read once, at module load: each case sets the stored
// preference and the flag first, then loads a fresh copy of the module.
async function load(flag: "true" | "false", pref: string | null) {
    vi.resetModules()
    vi.stubEnv("VITE_ENABLE_EVM", flag)
    localStorage.clear()
    if (pref !== null) localStorage.setItem(NETWORK_PREF_STORAGE_KEY, pref)
    return import("./network")
}

const reload = vi.fn()
const realLocation = window.location

beforeEach(() => {
    reload.mockClear()
    Object.defineProperty(window, "location", { value: { ...realLocation, reload }, writable: true })
})

afterEach(() => {
    Object.defineProperty(window, "location", { value: realLocation, writable: true })
    vi.unstubAllEnvs()
    sessionStorage.clear()
    localStorage.clear()
})

describe("Memba OS network with the EVM flag off", () => {
    it("ignores a stored Base preference and offers Gno networks only", async () => {
        const net = await load("false", "base-sepolia")
        expect(net.activeOsNetwork()).toMatchObject({ key: ACTIVE_NETWORK_KEY, family: "gno" })
        expect(net.selectableOsNetworks().every((n) => n.family === "gno")).toBe(true)
    })

    it("refuses to switch to Base", async () => {
        const net = await load("false", null)
        net.switchOsNetwork("base-sepolia")
        expect(localStorage.getItem(NETWORK_PREF_STORAGE_KEY)).toBeNull()
        expect(reload).not.toHaveBeenCalled()
    })
})

describe("Memba OS network with the EVM flag on", () => {
    it("offers Base Sepolia next to the Gno networks, never Base mainnet", async () => {
        const net = await load("true", null)
        const keys = net.selectableOsNetworks().map((n) => n.key)
        expect(keys).toContain(ACTIVE_NETWORK_KEY)
        expect(keys).toContain("base-sepolia")
        expect(keys).not.toContain("base")
        expect(net.selectableOsNetworks().find((n) => n.key === "base-sepolia")).toEqual({
            key: "base-sepolia", family: "evm", chainId: "84532", label: "Base Sepolia", isTestnet: true, rpcHost: "sepolia.base.org",
        })
    })

    it("loads on Base Sepolia when it is the stored choice", async () => {
        const net = await load("true", "base-sepolia")
        expect(net.activeOsNetwork()).toMatchObject({ key: "base-sepolia", family: "evm", chainId: "84532" })
    })

    it("does not restore hidden Base mainnet from storage", async () => {
        const net = await load("true", "base")
        expect(net.activeOsNetwork()).toMatchObject({ key: ACTIVE_NETWORK_KEY, family: "gno" })
    })

    it("switches to Base Sepolia: saves the choice and reloads, without Gno quest credit", async () => {
        const net = await load("true", null)
        const { completeQuest } = await import("../../lib/quests")
        net.switchOsNetwork("base-sepolia")
        expect(localStorage.getItem(NETWORK_PREF_STORAGE_KEY)).toBe("base-sepolia")
        expect(reload).toHaveBeenCalledTimes(1)
        expect(completeQuest).not.toHaveBeenCalled()
    })

    it("refuses hidden Base mainnet", async () => {
        const net = await load("true", null)
        net.switchOsNetwork("base")
        expect(localStorage.getItem(NETWORK_PREF_STORAGE_KEY)).toBeNull()
        expect(reload).not.toHaveBeenCalled()
    })

    it("switches back from Base Sepolia to the Gno network config was loaded with", async () => {
        const net = await load("true", "base-sepolia")
        net.switchOsNetwork(ACTIVE_NETWORK_KEY)
        expect(localStorage.getItem(NETWORK_PREF_STORAGE_KEY)).toBe(ACTIVE_NETWORK_KEY)
        expect(reload).toHaveBeenCalledTimes(1)
    })

    it("does nothing when Base Sepolia is already the OS network", async () => {
        const net = await load("true", "base-sepolia")
        net.switchOsNetwork("base-sepolia")
        expect(reload).not.toHaveBeenCalled()
    })

    it("announces the switch by name after the reload", async () => {
        const net = await load("true", "base-sepolia")
        sessionStorage.setItem(net.OS_NET_SWITCHED_KEY, "base-sepolia")
        expect(net.takeNetworkSwitchNotice()).toBe("Switched to Base Sepolia · testnet: sandbox funds, nothing here is real")
    })

    it("names Base Sepolia by its name and gno.land networks by their chain id", async () => {
        const net = await load("true", null)
        const names = net.selectableOsNetworks().map(net.networkName)
        expect(names).toContain("Base Sepolia")
        expect(names).toContain(net.activeOsNetwork().chainId)
    })
})
