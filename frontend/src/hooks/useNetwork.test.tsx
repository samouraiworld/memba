import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook } from "@testing-library/react"
import { MemoryRouter, Routes, Route } from "react-router-dom"
import type { ReactNode } from "react"
import { useNetwork } from "./useNetwork"
import { NETWORKS, ACTIVE_NETWORK_KEY, NETWORK_PREF_STORAGE_KEY, selectableNetworksFor } from "../lib/config"
import { OS_NET_SWITCHED_KEY } from "../lib/networkSwitch"

/** A network the switcher would actually offer for `ACTIVE_NETWORK_KEY`, distinct
 *  from it — never a hard-coded key, and never a hidden/retired one when a visible
 *  alternative exists. (Today's config ships exactly one visible network, so no
 *  visible alternative exists; the fallback below still exercises a real switch
 *  rather than skip the case.) */
function pickSwitchTarget(): string {
    const visible = Object.keys(selectableNetworksFor(ACTIVE_NETWORK_KEY)).find((k) => k !== ACTIVE_NETWORK_KEY)
    return visible ?? Object.keys(NETWORKS).find((k) => k !== ACTIVE_NETWORK_KEY)!
}

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

    it("does nothing when 'switching' to the network already active", () => {
        // Not a switch: it would award the quest and full-page-load to the same
        // URL. The guard lives here rather than at the five call sites, which
        // enforced it five different ways and already disagreed with each other.
        const { result } = renderHook(() => useNetwork(), { wrapper })
        expect(result.current.networkKey).toBe("topaz")
        result.current.switchNetwork("topaz")
        expect(completeQuest).not.toHaveBeenCalled()
        expect(trackNetworkVisit).not.toHaveBeenCalled()
        expect(window.location.href).toBe("")
        expect(localStorage.getItem("memba_network")).toBeNull()
    })
})

describe("useNetwork.switchNetwork — an explicit choice is recorded apart from the URL echo", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.stubGlobal("location", { pathname: "/topaz/settings", href: "" })
    })
    afterEach(() => {
        vi.unstubAllGlobals()
        localStorage.removeItem("memba_network")
        localStorage.removeItem("memba_network_pref")
    })

    it("records the switch as the user's preference, and keeps the echo in step", () => {
        const { result } = renderHook(() => useNetwork(), { wrapper })
        result.current.switchNetwork("gnoland1")
        expect(localStorage.getItem("memba_network_pref")).toBe("gnoland1")
        expect(localStorage.getItem("memba_network")).toBe("gnoland1")
    })

    it("records no preference when 'switching' to the network already active", () => {
        const { result } = renderHook(() => useNetwork(), { wrapper })
        result.current.switchNetwork("topaz")
        expect(localStorage.getItem("memba_network_pref")).toBeNull()
    })
})

describe("useNetwork.switchNetwork — a switch from inside Memba OS stays in Memba OS", () => {
    afterEach(() => {
        vi.unstubAllGlobals()
        localStorage.removeItem("memba_network_pref")
        localStorage.removeItem("memba_network")
        sessionStorage.removeItem(OS_NET_SWITCHED_KEY)
    })

    it("reloads in place inside Memba OS instead of leaving it, and flags the switch for the toast", () => {
        const targetKey = pickSwitchTarget()
        const reload = vi.fn()
        const assign = vi.fn()
        vi.stubGlobal("location", {
            pathname: "/os/feed",
            reload,
            set href(v: string) { assign(v) },
        })
        const { result } = renderHook(() => useNetwork(), { wrapper })
        result.current.switchNetwork(targetKey)
        expect(reload).toHaveBeenCalled()
        expect(assign).not.toHaveBeenCalled()
        expect(localStorage.getItem(NETWORK_PREF_STORAGE_KEY)).toBe(targetKey)
        // Same key os/shell/network.ts's switchOsNetwork writes, so Shell.tsx's
        // takeNetworkSwitchNotice() toast fires for this path too.
        expect(sessionStorage.getItem(OS_NET_SWITCHED_KEY)).toBe(targetKey)
    })

    it("reloads on the bare /os path (no trailing slash)", () => {
        const targetKey = pickSwitchTarget()
        const reload = vi.fn()
        const assign = vi.fn()
        vi.stubGlobal("location", {
            pathname: "/os",
            reload,
            set href(v: string) { assign(v) },
        })
        const { result } = renderHook(() => useNetwork(), { wrapper })
        result.current.switchNetwork(targetKey)
        expect(reload).toHaveBeenCalled()
        expect(assign).not.toHaveBeenCalled()
        expect(sessionStorage.getItem(OS_NET_SWITCHED_KEY)).toBe(targetKey)
    })

    it("reloads on /os/ (trailing slash, no window path yet)", () => {
        const targetKey = pickSwitchTarget()
        const reload = vi.fn()
        const assign = vi.fn()
        vi.stubGlobal("location", {
            pathname: "/os/",
            reload,
            set href(v: string) { assign(v) },
        })
        const { result } = renderHook(() => useNetwork(), { wrapper })
        result.current.switchNetwork(targetKey)
        expect(reload).toHaveBeenCalled()
        expect(assign).not.toHaveBeenCalled()
        expect(sessionStorage.getItem(OS_NET_SWITCHED_KEY)).toBe(targetKey)
    })

    it("navigates (no reload) on /osmosis — the /os check must not match a lookalike path", () => {
        const targetKey = pickSwitchTarget()
        const reload = vi.fn()
        const assign = vi.fn()
        vi.stubGlobal("location", {
            pathname: "/osmosis/settings",
            reload,
            set href(v: string) { assign(v) },
        })
        const { result } = renderHook(() => useNetwork(), { wrapper })
        result.current.switchNetwork(targetKey)
        expect(reload).not.toHaveBeenCalled()
        // "osmosis" isn't a NETWORKS key, so it isn't stripped as a network prefix —
        // the full original path is kept, same as any other unrecognized segment.
        expect(assign).toHaveBeenCalledWith(`/${targetKey}/osmosis/settings`)
        expect(sessionStorage.getItem(OS_NET_SWITCHED_KEY)).toBeNull()
    })

    it("navigates (no reload) on a legacy path with no network segment", () => {
        const targetKey = pickSwitchTarget()
        const reload = vi.fn()
        const assign = vi.fn()
        vi.stubGlobal("location", {
            pathname: "/dashboard",
            reload,
            set href(v: string) { assign(v) },
        })
        const { result } = renderHook(() => useNetwork(), { wrapper })
        result.current.switchNetwork(targetKey)
        expect(reload).not.toHaveBeenCalled()
        expect(assign).toHaveBeenCalledWith(`/${targetKey}/dashboard`)
        expect(sessionStorage.getItem(OS_NET_SWITCHED_KEY)).toBeNull()
    })
})
