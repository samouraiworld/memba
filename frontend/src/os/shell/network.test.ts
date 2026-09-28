import { afterEach, describe, expect, it, vi } from "vitest"
import { ACTIVE_NETWORK_KEY, NETWORK_ECHO_STORAGE_KEY, NETWORK_PREF_STORAGE_KEY, NETWORKS } from "../../lib/config"
import { switchOsNetwork } from "./network"

vi.mock("../../lib/quests", () => ({ completeQuest: vi.fn(), getQuestWalletAddress: vi.fn(() => null) }))
vi.mock("../../lib/questVerifier", () => ({ trackNetworkVisit: vi.fn() }))

const otherNetwork = Object.keys(NETWORKS).find((key) => key !== ACTIVE_NETWORK_KEY)!

afterEach(() => vi.restoreAllMocks())

describe("switchOsNetwork", () => {
    it("restores the old preference if the required echo write fails", async () => {
        const { completeQuest } = await import("../../lib/quests")
        localStorage.setItem(NETWORK_PREF_STORAGE_KEY, ACTIVE_NETWORK_KEY)
        localStorage.setItem(NETWORK_ECHO_STORAGE_KEY, ACTIVE_NETWORK_KEY)
        const setItem = localStorage.setItem.bind(localStorage)
        vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
            if (key === NETWORK_ECHO_STORAGE_KEY && value === otherNetwork) throw new Error("quota")
            setItem(key, value)
        })

        switchOsNetwork(otherNetwork)

        expect(localStorage.getItem(NETWORK_PREF_STORAGE_KEY)).toBe(ACTIVE_NETWORK_KEY)
        expect(localStorage.getItem(NETWORK_ECHO_STORAGE_KEY)).toBe(ACTIVE_NETWORK_KEY)
        expect(completeQuest).not.toHaveBeenCalled()
    })
})
