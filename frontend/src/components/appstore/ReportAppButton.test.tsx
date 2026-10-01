/**
 * ReportAppButton (B1b) — connect-on-action, the disclosure (deposit, threshold) before
 * the wallet prompt, FlagApp against the ACTIVE realm path, and the pkgPath guard.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

const mockBroadcast = vi.fn()
vi.mock("../../lib/appStore", async (importActual) => ({
    ...await importActual<typeof import("../../lib/appStore")>(),
    submitAppReport: (...args: unknown[]) => mockBroadcast(...args),
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
    it("states the deposit and the hide threshold, then sends once", async () => {
        render(<ReportAppButton pkgPath={PKG} />)
        fireEvent.click(screen.getByTestId("appreport-btn"))
        // Disclosure BEFORE any wallet prompt: 1,103 bytes at the storage price is about 0.11 GNOT.
        expect(screen.getByTestId("appreport-confirm")).toHaveTextContent(/can't be withdrawn\. It pays a storage deposit of about 0\.11 GNOT that is not returned.*Reports from 5 different accounts hide/)
        expect(mockBroadcast).not.toHaveBeenCalled()

        fireEvent.click(screen.getByTestId("appreport-yes"))
        await waitFor(() => expect(mockBroadcast).toHaveBeenCalledWith("g1reporter", PKG))
        expect(mockBroadcast).toHaveBeenCalledTimes(1)
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

    it("a check made before the wallet says what stopped it", async () => {
        const { NothingSentError } = await import("../../lib/appStore")
        mockBroadcast.mockRejectedValueOnce(new NothingSentError("You have already reported this listing."))
        render(<ReportAppButton pkgPath={PKG} />)
        fireEvent.click(screen.getByTestId("appreport-btn"))
        fireEvent.click(screen.getByTestId("appreport-yes"))
        expect(await screen.findByTestId("appreport-error")).toHaveTextContent("You have already reported this listing.")
        expect(screen.queryByTestId("appreport-done")).toBeNull()
    })

    it("a real failure surfaces the retry error; wallet dismissal stays silent", async () => {
        mockBroadcast.mockRejectedValueOnce(new Error("insufficient fee: network exploded"))
        render(<ReportAppButton pkgPath={PKG} />)
        fireEvent.click(screen.getByTestId("appreport-btn"))
        fireEvent.click(screen.getByTestId("appreport-yes"))
        // Any other failure, even one whose text mentions a fee, is not shown raw.
        expect(await screen.findByTestId("appreport-error")).toHaveTextContent("The report did not go through. A transaction that fails on chain still costs its network fee.")

        mockBroadcast.mockRejectedValueOnce(new Error("user denied the request"))
        fireEvent.click(screen.getByTestId("appreport-yes"))
        await waitFor(() => expect(mockBroadcast).toHaveBeenCalledTimes(2))
        expect(screen.queryByTestId("appreport-error")).toBeNull()
        expect(screen.getByTestId("appreport-confirm")).toBeInTheDocument()
    })
})
