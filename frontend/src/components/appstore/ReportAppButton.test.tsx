/**
 * ReportAppButton (B1b) — connect-on-action, on-chain disclosure before the
 * wallet prompt, FlagApp broadcast against the ACTIVE realm path, the realm's
 * "already flagged" dedupe treated as success, and the pkgPath guard.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

const mockBroadcast = vi.fn()
vi.mock("../../lib/grc20", () => ({
    doContractBroadcast: (...args: unknown[]) => mockBroadcast(...args),
}))

const mockConnect = vi.fn()
let mockConnected = true
vi.mock("../../hooks/useAdena", () => ({
    useAdena: () => ({ connected: mockConnected, address: "g1reporter", connect: mockConnect }),
}))

import { ReportAppButton } from "./ReportAppButton"
import { buildFlagAppMsg, APPSTORE_REALM_PATH } from "../../lib/appStore"

const PKG = "gno.land/r/samcrew/space_invaders"

beforeEach(() => {
    mockBroadcast.mockReset().mockResolvedValue({ hash: "h" })
    mockConnect.mockReset()
    mockConnected = true
})

describe("buildFlagAppMsg", () => {
    it("targets FlagApp on the ACTIVE realm path with the validated pkgPath", () => {
        const msg = buildFlagAppMsg("g1reporter", PKG)
        expect(msg.value).toMatchObject({
            caller: "g1reporter",
            pkg_path: APPSTORE_REALM_PATH,
            func: "FlagApp",
            args: [PKG],
            send: "",
        })
    })

    it("refuses a non-realm-shaped path before it reaches a broadcast", () => {
        expect(() => buildFlagAppMsg("g1reporter", 'x") or Steal("')).toThrow("invalid app path")
    })
})

describe("ReportAppButton", () => {
    it("confirms the on-chain disclosure, then broadcasts once", async () => {
        render(<ReportAppButton pkgPath={PKG} />)
        fireEvent.click(screen.getByTestId("appreport-btn"))
        // Disclosure BEFORE any wallet prompt.
        expect(screen.getByTestId("appreport-confirm")).toHaveTextContent(/on-chain|can't be withdrawn/i)
        expect(mockBroadcast).not.toHaveBeenCalled()

        fireEvent.click(screen.getByTestId("appreport-yes"))
        await waitFor(() => expect(mockBroadcast).toHaveBeenCalledTimes(1))
        expect(await screen.findByTestId("appreport-done")).toBeInTheDocument()
    })

    it("cancel closes the confirm without broadcasting", () => {
        render(<ReportAppButton pkgPath={PKG} />)
        fireEvent.click(screen.getByTestId("appreport-btn"))
        fireEvent.click(screen.getByTestId("appreport-cancel"))
        expect(screen.queryByTestId("appreport-confirm")).toBeNull()
        expect(mockBroadcast).not.toHaveBeenCalled()
    })

    it("disconnected: connects on click instead of broadcasting", () => {
        mockConnected = false
        render(<ReportAppButton pkgPath={PKG} />)
        fireEvent.click(screen.getByTestId("appreport-btn"))
        expect(mockConnect).toHaveBeenCalled()
        expect(screen.queryByTestId("appreport-confirm")).toBeNull()
        expect(mockBroadcast).not.toHaveBeenCalled()
    })

    it("the realm's 'already flagged' dedupe reads as done, not an error", async () => {
        mockBroadcast.mockRejectedValueOnce(new Error("panic: already flagged"))
        render(<ReportAppButton pkgPath={PKG} />)
        fireEvent.click(screen.getByTestId("appreport-btn"))
        fireEvent.click(screen.getByTestId("appreport-yes"))
        expect(await screen.findByTestId("appreport-done")).toBeInTheDocument()
        expect(screen.queryByTestId("appreport-error")).toBeNull()
    })

    it("a real failure surfaces the retry error; wallet dismissal stays silent", async () => {
        mockBroadcast.mockRejectedValueOnce(new Error("network exploded"))
        render(<ReportAppButton pkgPath={PKG} />)
        fireEvent.click(screen.getByTestId("appreport-btn"))
        fireEvent.click(screen.getByTestId("appreport-yes"))
        expect(await screen.findByTestId("appreport-error")).toBeInTheDocument()

        mockBroadcast.mockRejectedValueOnce(new Error("user denied the request"))
        fireEvent.click(screen.getByTestId("appreport-yes"))
        await waitFor(() => expect(mockBroadcast).toHaveBeenCalledTimes(2))
        expect(screen.queryByTestId("appreport-error")).toBeNull()
        expect(screen.getByTestId("appreport-confirm")).toBeInTheDocument()
    })
})
