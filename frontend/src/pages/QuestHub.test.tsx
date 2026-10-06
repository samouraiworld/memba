/**
 * QuestHub — category tablist keyboard wiring.
 *
 * First test file for this page; scoped to the tablist adoption. The APG
 * keyboard contract itself is covered in hooks/useTabListKeyboard.test.tsx —
 * what these pin is that the page is actually wired through the hook: the
 * roving tabindex only exists if tabProps is spread, and arrow-selection only
 * works if onSelect reaches setCategory.
 *
 * No network mocks needed: the quest catalog is static data and backend quest
 * state only loads once a wallet is connected, so the wallet mocks as absent.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen, fireEvent, waitFor } from "@testing-library/react"
import { useLocation } from "react-router-dom"
import { useState } from "react"
import { renderWithProviders } from "../test/test-utils"

const mockWallet = vi.hoisted(() => ({ address: "" }))
const fetchUserQuestsMock = vi.hoisted(() => vi.fn())

vi.mock("../lib/quests", async importOriginal => ({
    ...(await importOriginal<typeof import("../lib/quests")>()),
    fetchUserQuests: fetchUserQuestsMock,
}))

vi.mock("../hooks/useAdena", () => ({
    useAdena: () => ({
        connected: false,
        address: mockWallet.address,
        pubkeyJSON: "",
        chainId: "",
        installed: false,
        loading: false,
        connect: vi.fn().mockResolvedValue(false),
        disconnect: vi.fn(),
        signArbitrary: vi.fn().mockResolvedValue(null),
    }),
}))

import QuestHub from "./QuestHub"
import { setQuestWalletAddress } from "../lib/quests"

const tab = (name: RegExp) => screen.getByRole("tab", { name })

function LocationProbe() {
    const location = useLocation()
    return <output data-testid="location">{location.search}</output>
}

function HubHarness() {
    const [, refresh] = useState(0)
    return <><button type="button" onClick={() => refresh(value => value + 1)}>Refresh harness</button><QuestHub /></>
}

beforeEach(() => {
    mockWallet.address = ""
    setQuestWalletAddress(null)
    localStorage.clear()
    fetchUserQuestsMock.mockReset().mockResolvedValue(null)
})

describe("QuestHub — category tablist keyboard (APG)", () => {
    it("gives the category tabs a roving tabindex (single tab stop)", () => {
        renderWithProviders(<QuestHub />, { route: "/mainnet/quests" })

        expect(tab(/^All/)).toHaveAttribute("aria-selected", "true")
        expect(tab(/^All/)).toHaveAttribute("tabindex", "0")
        expect(tab(/^Developers/)).toHaveAttribute("tabindex", "-1")
        expect(tab(/^Everyone/)).toHaveAttribute("tabindex", "-1")
        expect(tab(/^Champion/)).toHaveAttribute("tabindex", "-1")
    })

    it("ArrowRight moves selection to the next category", () => {
        renderWithProviders(<QuestHub />, { route: "/mainnet/quests" })

        fireEvent.keyDown(tab(/^All/), { key: "ArrowRight" })
        expect(tab(/^Developers/)).toHaveAttribute("aria-selected", "true")
        expect(tab(/^Developers/)).toHaveAttribute("tabindex", "0")
        expect(tab(/^All/)).toHaveAttribute("tabindex", "-1")
    })

    it("End jumps to the last category and wraps forward to the first", () => {
        renderWithProviders(<QuestHub />, { route: "/mainnet/quests" })

        fireEvent.keyDown(tab(/^All/), { key: "End" })
        expect(tab(/^Champion/)).toHaveAttribute("aria-selected", "true")

        fireEvent.keyDown(tab(/^Champion/), { key: "ArrowRight" })
        expect(tab(/^All/)).toHaveAttribute("aria-selected", "true")
    })
})

describe("QuestHub — URL and wallet state", () => {
    it("restores filters from the URL and passes them to detail links", () => {
        renderWithProviders(<><QuestHub /><LocationProbe /></>, { route: "/mainnet/quests?category=developer&difficulty=beginner&status=available&q=deploy" })
        expect(tab(/^Developers/)).toHaveAttribute("aria-selected", "true")
        expect(screen.getByLabelText("Search quests")).toHaveValue("deploy")
        expect(screen.getByLabelText("Filter by difficulty")).toHaveValue("beginner")
        expect(screen.getByLabelText("Filter by status")).toHaveValue("available")
        const detail = screen.getAllByTestId(/^quest-/)[0]
        const link = new URL((detail as HTMLAnchorElement).href)
        expect(new URLSearchParams(link.search).get("from")).toBe("category=developer&difficulty=beginner&status=available&q=deploy")
    })

    it("updates and clears shareable filters", () => {
        renderWithProviders(<><QuestHub /><LocationProbe /></>, { route: "/mainnet/quests" })
        fireEvent.click(tab(/^Developers/))
        fireEvent.change(screen.getByLabelText("Search quests"), { target: { value: "wallet" } })
        expect(screen.getByTestId("location").textContent).toContain("category=developer")
        expect(screen.getByTestId("location").textContent).toContain("q=wallet")
        fireEvent.click(screen.getByRole("button", { name: "Clear filters" }))
        expect(screen.getByTestId("location")).toHaveTextContent("")
    })

    it("never shows a previous wallet's backend or local progress after switching", async () => {
        const alice = "g1alice"
        const bob = "g1bob"
        localStorage.setItem(`memba_quests_${alice}`, JSON.stringify({ completed: [{ questId: "connect-wallet", completedAt: 1 }], totalXP: 10 }))
        mockWallet.address = alice
        setQuestWalletAddress(alice)
        fetchUserQuestsMock.mockImplementation((address: string) => Promise.resolve(address === alice
            ? { completed: [{ questId: "connect-wallet", completedAt: 1 }], totalXP: 100 }
            : null))
        renderWithProviders(<HubHarness />, { route: "/mainnet/quests" })
        await screen.findByText("100 XP")

        mockWallet.address = bob
        setQuestWalletAddress(bob)
        fireEvent.click(screen.getByRole("button", { name: "Refresh harness" }))
        expect(screen.queryByText("100 XP")).toBeNull()
        expect(screen.queryByText("10 XP")).toBeNull()
        await waitFor(() => expect(fetchUserQuestsMock).toHaveBeenCalledWith(bob))
        expect(screen.getByText("0 XP")).toBeInTheDocument()
    })

    it("labels local XP after a failed server refresh and retries authoritative XP", async () => {
        const address = "g1alice"
        localStorage.setItem(`memba_quests_${address}`, JSON.stringify({ completed: [], totalXP: 10 }))
        mockWallet.address = address
        setQuestWalletAddress(address)
        fetchUserQuestsMock.mockResolvedValueOnce({ completed: [], totalXP: 100 })
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ completed: [], totalXP: 120 })

        renderWithProviders(<QuestHub />, { route: "/mainnet/quests" })
        await screen.findByText("100 XP")

        fireEvent(window, new Event("quest-completed"))
        await screen.findByText("10 XP")
        expect(screen.getByRole("status")).toHaveTextContent("Server XP unavailable; showing saved local progress.")
        fireEvent.click(screen.getByRole("button", { name: "Retry server XP" }))
        await screen.findByText("120 XP")
        expect(screen.queryByText(/Server XP unavailable/)).toBeNull()
    })

    it("does not keep a retired local feedback completion syncing forever", async () => {
        const address = "g1alice"
        localStorage.setItem(`memba_quests_${address}`, JSON.stringify({
            completed: [{ questId: "submit-feedback", completedAt: 1 }], totalXP: 20,
        }))
        mockWallet.address = address
        setQuestWalletAddress(address)
        fetchUserQuestsMock.mockResolvedValue({ completed: [], totalXP: 0 })
        renderWithProviders(<QuestHub />, { route: "/mainnet/quests" })
        await waitFor(() => expect(fetchUserQuestsMock).toHaveBeenCalledWith(address))
        expect(await screen.findByText("0 XP")).toBeInTheDocument()
        expect(screen.queryByText("syncing…")).toBeNull()
    })

    it("still marks a new local quest as pending while the backend has not recorded it", async () => {
        const address = "g1alice"
        localStorage.setItem(`memba_quests_${address}`, JSON.stringify({
            completed: [{ questId: "connect-wallet", completedAt: 1 }], totalXP: 10,
        }))
        mockWallet.address = address
        setQuestWalletAddress(address)
        fetchUserQuestsMock.mockResolvedValue({ completed: [], totalXP: 0 })
        renderWithProviders(<QuestHub />, { route: "/mainnet/quests" })
        await waitFor(() => expect(fetchUserQuestsMock).toHaveBeenCalledWith(address))
        expect(await screen.findByText("syncing…")).toBeInTheDocument()
    })
})
