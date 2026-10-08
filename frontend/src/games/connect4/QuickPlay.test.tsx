import { fireEvent, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderWithProviders } from "../../test/test-utils"

const qp = vi.hoisted(() => ({ startQuickPlay: vi.fn(), quickPlayStatus: vi.fn(), endQuickPlay: vi.fn(), forgetQuickPlay: vi.fn() }))
vi.mock("../../lib/quickPlay", async (orig) => ({ ...(await orig<typeof import("../../lib/quickPlay")>()), ...qp }))
const cfg = vi.hoisted(() => ({ path: "gno.land/r/x/connect4" as string | null }))
vi.mock("../../lib/config", async (orig) => ({ ...(await orig<typeof import("../../lib/config")>()), connect4PathFor: () => cfg.path }))
import { QuickPlay } from "./QuickPlay"

beforeEach(() => { localStorage.clear(); cfg.path = "gno.land/r/x/connect4"; Object.values(qp).forEach((f) => f.mockReset()) })

describe("QuickPlay", () => {
    it("is hidden without a wallet", () => {
        const { container } = renderWithProviders(<QuickPlay me="" connected={false} />)
        expect(container).toBeEmptyDOMElement()
    })
    it("proposes a 4h session by default, with the options under a closed Advanced", async () => {
        qp.quickPlayStatus.mockResolvedValue(null)
        qp.startQuickPlay.mockResolvedValue({ expiresAt: Date.now() / 1000 + 14400, spendUsedUgnot: 0, spendLimitUgnot: 5_000_000 })
        renderWithProviders(<QuickPlay me="g1me" connected />)
        const start = await screen.findByRole("button", { name: /Start Quick play · 4h · 1 approval/ })
        expect(screen.getByRole("button", { name: "Advanced" })).toHaveAttribute("aria-expanded", "false")
        fireEvent.click(screen.getByRole("button", { name: "Advanced" }))
        expect(screen.getByRole("button", { name: "4h" })).toHaveAttribute("aria-pressed", "true")
        expect(screen.getByText(/Up to 5 GNOT\/day/)).toBeInTheDocument()
        fireEvent.click(start)
        await waitFor(() => expect(qp.startQuickPlay).toHaveBeenCalledWith("g1me", 14400, undefined))
    })
    it("lets the player sign every transaction instead, and remembers it", async () => {
        qp.quickPlayStatus.mockResolvedValue(null)
        const { unmount } = renderWithProviders(<QuickPlay me="g1me" connected />)
        fireEvent.click(await screen.findByRole("button", { name: "Advanced" }))
        fireEvent.click(screen.getByRole("checkbox", { name: /Sign every transaction/ }))
        // Swapped in place (same cell), so the banner doesn't move; the options stay but are disabled.
        expect(screen.getByRole("button", { name: /Start Quick play/ })).toBeDisabled()
        expect(screen.getByText("Wallet signs every move")).not.toHaveAttribute("data-off")
        expect(screen.getByRole("button", { name: "4h" })).toBeDisabled()
        unmount()
        renderWithProviders(<QuickPlay me="g1me" connected />)
        expect(await screen.findByRole("button", { name: /Start Quick play/ })).toBeDisabled()
    })
    it("ticking Sign every transaction during a live session keeps the pill, End and Forget", async () => {
        qp.quickPlayStatus.mockResolvedValue({ expiresAt: Date.now() / 1000 + 3600, spendUsedUgnot: 0, spendLimitUgnot: 5_000_000 })
        renderWithProviders(<QuickPlay me="g1me" connected />)
        const pill = await screen.findByText(/GNOT budget/)
        fireEvent.click(screen.getByRole("button", { name: "Advanced" }))
        fireEvent.click(screen.getByRole("checkbox", { name: /Sign every transaction/ }))
        expect(pill).toHaveAttribute("data-tone", "paused")
        expect(screen.getByRole("button", { name: "End session" })).toBeEnabled()
        expect(screen.getByRole("button", { name: "Forget on this device" })).toBeEnabled()
        expect(qp.endQuickPlay).not.toHaveBeenCalled()
    })
    it("keeps the session controls but pauses the pill and hides Renew while signing every move", async () => {
        localStorage.setItem("memba.quickplay.signEach", "1")
        qp.quickPlayStatus.mockResolvedValue({ expiresAt: Date.now() / 1000 + 3600, spendUsedUgnot: 4_800_000, spendLimitUgnot: 5_000_000 })
        renderWithProviders(<QuickPlay me="g1me" connected />)
        expect(await screen.findByText(/GNOT budget/)).toHaveAttribute("data-tone", "paused")
        expect(screen.queryByRole("button", { name: /Renew/ })).toBeNull()
        expect(screen.getByRole("button", { name: "End session" })).toBeInTheDocument()
    })
    it("shows time left and budget when on, and ends or forgets", async () => {
        qp.quickPlayStatus.mockResolvedValue({ expiresAt: Date.now() / 1000 + 3 * 3600 + 12 * 60, spendUsedUgnot: 30_000, spendLimitUgnot: 1_000_000 })
        qp.endQuickPlay.mockResolvedValue(undefined)
        renderWithProviders(<QuickPlay me="g1me" connected />)
        expect(await screen.findByText(/3h 1[12]m left/)).toBeInTheDocument()
        expect(screen.getByText(/0\.97 GNOT/)).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "End session" }))
        await waitFor(() => expect(qp.endQuickPlay).toHaveBeenCalledWith("g1me", undefined))
        // Forget stays disabled until End has settled.
        const forget = screen.getByRole("button", { name: "Forget on this device" })
        await waitFor(() => expect(forget).toBeEnabled())
        fireEvent.click(forget)
        expect(qp.forgetQuickPlay).toHaveBeenCalledWith("g1me")
    })
    it("shows a confirming pill (not the start button) while a just-sent session isn't on chain yet", async () => {
        qp.quickPlayStatus.mockResolvedValue("pending")
        renderWithProviders(<QuickPlay me="g1me" connected />)
        expect(await screen.findByText(/Quick play · confirming/)).toBeInTheDocument()
        expect(screen.queryByRole("button", { name: /Start/ })).toBeNull()
        expect(screen.getByRole("button", { name: "Forget on this device" })).toBeEnabled()
    })
    it("shows an error note, not the start button, when the status read fails", async () => {
        qp.quickPlayStatus.mockRejectedValue(new Error("network"))
        renderWithProviders(<QuickPlay me="g1me" connected />)
        expect(await screen.findByText("Couldn't read Quick play status")).toBeInTheDocument()
        expect(screen.queryByRole("button", { name: /Start Quick play/ })).toBeNull()
        // The key can still be dropped with the RPC down.
        expect(screen.getByRole("button", { name: "End session" })).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Forget on this device" }))
        expect(qp.forgetQuickPlay).toHaveBeenCalledWith("g1me")
    })
    it("is hidden when Connect 4 is not deployed on this network", () => {
        cfg.path = null
        const { container } = renderWithProviders(<QuickPlay me="g1me" connected />)
        expect(container).toBeEmptyDOMElement()
    })
    it("closes the panel on Escape and on an outside click, refocusing the toggle", async () => {
        qp.quickPlayStatus.mockResolvedValue(null)
        renderWithProviders(<QuickPlay me="g1me" connected />)
        const toggle = await screen.findByRole("button", { name: "Advanced" })
        fireEvent.click(toggle)
        expect(toggle).toHaveAttribute("aria-controls")
        fireEvent.keyDown(document, { key: "Escape" })
        expect(screen.queryByText(/Stakes still ask/)).toBeNull()
        expect(toggle).toHaveFocus()
        fireEvent.click(toggle)
        fireEvent.pointerDown(document.body)
        expect(screen.queryByText(/Stakes still ask/)).toBeNull()
    })
    it("offers to renew once the budget runs low", async () => {
        qp.quickPlayStatus.mockResolvedValue({ expiresAt: Date.now() / 1000 + 3600, spendUsedUgnot: 4_800_000, spendLimitUgnot: 5_000_000 })
        qp.startQuickPlay.mockResolvedValue({ expiresAt: Date.now() / 1000 + 14400, spendUsedUgnot: 0, spendLimitUgnot: 5_000_000 })
        renderWithProviders(<QuickPlay me="g1me" connected />)
        fireEvent.click(await screen.findByRole("button", { name: "Renew · 1 approval" }))
        await waitFor(() => expect(qp.startQuickPlay).toHaveBeenCalledWith("g1me", 14400, undefined, true))
    })
    it("doesn't offer renew with plenty of budget", async () => {
        qp.quickPlayStatus.mockResolvedValue({ expiresAt: Date.now() / 1000 + 3600, spendUsedUgnot: 0, spendLimitUgnot: 5_000_000 })
        renderWithProviders(<QuickPlay me="g1me" connected />)
        await screen.findByText(/5\.00 GNOT budget/)
        expect(screen.queryByRole("button", { name: /Renew/ })).toBeNull()
    })
    it("turns amber when the budget is used up", async () => {
        qp.quickPlayStatus.mockResolvedValue({ expiresAt: Date.now() / 1000 + 3600, spendUsedUgnot: 990_000, spendLimitUgnot: 1_000_000 })
        renderWithProviders(<QuickPlay me="g1me" connected />)
        const pill = await screen.findByText("⚡ Quick play · budget used up for today")
        expect(pill).toHaveAttribute("data-tone", "warn")
    })
    it("shows a Start failure after the wallet dialog closed the popover", async () => {
        qp.quickPlayStatus.mockResolvedValue(null)
        qp.startQuickPlay.mockImplementation(async () => {
            // Confirming in the transaction dialog is a pointer-down outside the popover.
            fireEvent.pointerDown(document.body)
            throw new Error("insufficient funds")
        })
        renderWithProviders(<QuickPlay me="g1me" connected />)
        fireEvent.click(await screen.findByRole("button", { name: "Advanced" }))
        fireEvent.click(screen.getByRole("button", { name: /Start Quick play/ }))
        expect(await screen.findByText("insufficient funds")).toBeInTheDocument()
        expect(screen.queryByRole("button", { name: "4h" })).toBeNull()
    })
})
