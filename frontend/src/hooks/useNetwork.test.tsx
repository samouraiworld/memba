import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook } from "@testing-library/react"
import { MemoryRouter, Routes, Route } from "react-router-dom"
import type { ReactNode } from "react"
import { useNetwork } from "./useNetwork"

/**
 * The "Network Hopper" quest (`switch-network`, 15 XP, season 1, LIVE) is awarded
 * by `completeQuest("switch-network")`, which used to be called from TopBar's
 * onChange ALONE. The other three switch surfaces — MobileTabBar, Settings and
 * ChainMismatchBanner — dropped the credit silently. Settings only looked harmless
 * because its button could not actually switch; once that was fixed it became a
 * working switcher that awarded nothing.
 *
 * The instrumentation now lives in `switchNetwork`, so every surface gets it. These
 * pin that, and pin that it fires BEFORE navigation (both are synchronous
 * localStorage writes, and `switchNetwork` ends by assigning `location.href`).
 */
vi.mock("../lib/quests", () => ({
    completeQuest: vi.fn(),
    getQuestWalletAddress: vi.fn(() => "g1testaddr"),
}))
vi.mock("../lib/questVerifier", () => ({ trackNetworkVisit: vi.fn() }))

import { completeQuest, getQuestWalletAddress } from "../lib/quests"
import { trackNetworkVisit } from "../lib/questVerifier"

const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={["/topaz/settings"]}>
        <Routes>
            <Route path="/:network/*" element={children} />
        </Routes>
    </MemoryRouter>
)

describe("useNetwork.switchNetwork — quest credit is awarded from EVERY surface", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.stubGlobal("location", { pathname: "/topaz/settings", href: "" })
    })
    afterEach(() => {
        vi.unstubAllGlobals()
        localStorage.removeItem("memba_network")
    })

    it("awards the quest and records the visit on a real switch", () => {
        const { result } = renderHook(() => useNetwork(), { wrapper })
        result.current.switchNetwork("test13")
        expect(completeQuest).toHaveBeenCalledWith("switch-network")
        expect(trackNetworkVisit).toHaveBeenCalledWith("g1testaddr", "test13")
        expect(localStorage.getItem("memba_network")).toBe("test13")
    })

    it("awards nothing for an unknown network key", () => {
        const { result } = renderHook(() => useNetwork(), { wrapper })
        result.current.switchNetwork("no-such-network")
        expect(completeQuest).not.toHaveBeenCalled()
        expect(trackNetworkVisit).not.toHaveBeenCalled()
    })

    it("does not record a visit when no wallet address is known", () => {
        vi.mocked(getQuestWalletAddress).mockReturnValueOnce(null as unknown as string)
        const { result } = renderHook(() => useNetwork(), { wrapper })
        result.current.switchNetwork("test13")
        // The quest itself is still awarded — only the per-address visit is skipped.
        expect(completeQuest).toHaveBeenCalledWith("switch-network")
        expect(trackNetworkVisit).not.toHaveBeenCalled()
    })

    it("navigates to the new network preserving the rest of the path", () => {
        const { result } = renderHook(() => useNetwork(), { wrapper })
        result.current.switchNetwork("test13")
        expect(window.location.href).toBe("/test13/settings")
    })
})
