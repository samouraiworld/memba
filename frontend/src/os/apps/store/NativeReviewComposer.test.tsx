import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { OsSession } from "../../shell/useOsSession"
import { SignerContext, type SignerApi } from "../../sign/signerContext"
import { NativeReviewComposer } from "./NativeReviewComposer"
import type { StoreReviewDraft } from "./reviewRequest"

const mocks = vi.hoisted(() => ({ request: vi.fn(), freshPrice: vi.fn(), broadcast: vi.fn(), fetchAppStrict: vi.fn() }))
vi.mock("./reviewRequest", () => ({ storeReviewRequest: mocks.request }))
vi.mock("../../../lib/grc20", async (importActual) => {
    const actual = await importActual<typeof import("../../../lib/grc20")>()
    return {
        ...actual,
        networkGasPriceFresh: mocks.freshPrice,
        // The module's own fresh quote calls networkGasPriceFresh internally, out of a mock's reach.
        freshFeeForGasWanted: async (gasWanted: number) => actual.feeForGasWanted(gasWanted, await mocks.freshPrice()),
        doContractBroadcast: mocks.broadcast,
    }
})
vi.mock("../../../lib/config", async (importActual) => ({
    ...await importActual<typeof import("../../../lib/config")>(),
    isAppReviewsAvailable: () => true, isRealmValidOn: () => true,
}))
vi.mock("../../../lib/appStore", async (importActual) => ({
    ...await importActual<typeof import("../../../lib/appStore")>(),
    fetchAppStrict: mocks.fetchAppStrict,
}))

function session(status: "guest" | "member" | "resuming", openConnect = vi.fn(), chainId = "gnoland-1"): OsSession {
    return { status, address: status === "member" ? "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5" : "", network: { key: "mainnet", chainId }, openConnect } as unknown as OsSession
}

const sign = vi.fn()
const signer: SignerApi = { sign, pending: [], notices: [], unread: 0, version: 0, markRead: vi.fn() }
const onSubmitted = vi.fn()

function show(current: OsSession) {
    return render(<SignerContext.Provider value={signer}><NativeReviewComposer session={current} subject="gno.land/r/samcrew/app" appName="Test App" onSubmitted={onSubmitted} /></SignerContext.Provider>)
}

/** Asks for the review sheet and lets the fee read settle. */
async function submit() {
    fireEvent.click(screen.getByRole("button", { name: "Review in Memba OS" }))
    await act(async () => {})
}

/** Opens the editor, fills it in, and asks for the review sheet; returns what the request builder received. */
async function review(stars: string, body = "") {
    fireEvent.click(screen.getByRole("button", { name: "Write a review" }))
    fireEvent.click(screen.getByRole("radio", { name: stars }))
    if (body) fireEvent.change(screen.getByRole("textbox", { name: /Your review/ }), { target: { value: body } })
    await submit()
    return mocks.request.mock.calls[0]?.[0] as StoreReviewDraft
}

beforeEach(() => {
    sessionStorage.clear()
    sign.mockReset()
    onSubmitted.mockReset()
    mocks.request.mockReset().mockReturnValue({})
    mocks.freshPrice.mockReset().mockResolvedValue({ gas: 1000, ugnot: 2 })
    mocks.broadcast.mockReset().mockResolvedValue({ hash: "a".repeat(64) })
    mocks.fetchAppStrict.mockReset().mockResolvedValue({ status: "live", name: "Test App" })
})
afterEach(() => { vi.restoreAllMocks() })

describe("native review composer", () => {
    it("opens the OS review sheet and retains a draft until the transaction is submitted", async () => {
        show(session("member"))
        expect(screen.queryByRole("radiogroup", { name: "Your rating" })).not.toBeInTheDocument()
        expect(mocks.freshPrice).not.toHaveBeenCalled() // no price is read until a review is asked for
        const draft = await review("4 stars", "Useful app")
        expect(draft).toMatchObject({ subject: "gno.land/r/samcrew/app", rating: 4, body: "Useful app", networkKey: "mainnet", price: { gas: 1000, ugnot: 2 } })
        expect(sign).toHaveBeenCalledTimes(1)
        expect(screen.getByRole("textbox", { name: /Your review/ })).toHaveValue("Useful app")
        act(() => draft.onSettled?.("submitted"))
        expect(onSubmitted).toHaveBeenCalledTimes(1)
        expect(screen.getByRole("status")).toHaveTextContent(/submitted to the network/)
        fireEvent.click(screen.getByRole("button", { name: "Write a review" }))
        expect(screen.getByRole("textbox", { name: /Your review/ })).toHaveValue("")
    })

    it("opens OS connection for a guest without preparing a wallet transaction", () => {
        const openConnect = vi.fn()
        show(session("guest", openConnect))
        fireEvent.click(screen.getByRole("button", { name: "Write a review" }))
        expect(screen.getByRole("button", { name: "Connect to review" })).toBeDisabled()
        expect(screen.getByText("Select a rating to post.")).toBeInTheDocument()
        fireEvent.click(screen.getByRole("radio", { name: "5 stars" }))
        expect(screen.queryByText("Select a rating to post.")).not.toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Connect to review" }))
        expect(openConnect).toHaveBeenCalledTimes(1)
        expect(mocks.request).not.toHaveBeenCalled()
        expect(sign).not.toHaveBeenCalled()
    })

    it("restores a guest's draft when connecting remounts the window, and forgets it once posted", async () => {
        const guest = show(session("guest"))
        fireEvent.click(screen.getByRole("button", { name: "Write a review" }))
        fireEvent.click(screen.getByRole("radio", { name: "4 stars" }))
        fireEvent.change(screen.getByRole("textbox", { name: /Your review/ }), { target: { value: "Useful app" } })
        guest.unmount()

        const member = show(session("member"))
        expect(screen.getByRole("radio", { name: "4 stars" })).toBeChecked()
        expect(screen.getByRole("textbox", { name: /Your review/ })).toHaveValue("Useful app")
        await submit()
        const draft = mocks.request.mock.calls[0][0] as StoreReviewDraft
        expect(draft).toMatchObject({ rating: 4, body: "Useful app" })
        act(() => draft.onSettled?.("confirmed"))
        expect(screen.getByRole("status")).toHaveTextContent(/confirmed on chain/)
        member.unmount()

        show(session("member"))
        expect(screen.queryByRole("textbox", { name: /Your review/ })).not.toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Write a review" }))
        expect(screen.getByRole("textbox", { name: /Your review/ })).toHaveValue("")
        expect(screen.getByRole("radio", { name: "4 stars" })).not.toBeChecked()
    })

    it("keeps a draft to its own network and ignores a stored rating outside 0 to 5", () => {
        const first = show(session("guest"))
        fireEvent.click(screen.getByRole("button", { name: "Write a review" }))
        fireEvent.click(screen.getByRole("radio", { name: "4 stars" }))
        first.unmount()
        const elsewhere = show(session("guest", vi.fn(), "another-chain"))
        expect(screen.queryByRole("radiogroup", { name: "Your rating" })).not.toBeInTheDocument()
        elsewhere.unmount()

        for (const rating of [9, -1, 2.5]) {
            sessionStorage.setItem("memba_os_review_draft:gnoland-1:gno.land/r/samcrew/app", JSON.stringify({ rating, body: "Useful app" }))
            const restored = show(session("guest"))
            expect(screen.queryByRole("textbox", { name: /Your review/ })).not.toBeInTheDocument()
            restored.unmount()
        }
    })

    it("keeps working when the browser blocks session storage", async () => {
        vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked") })
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked") })
        vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("blocked") })
        show(session("member"))
        const draft = await review("3 stars", "Useful app")
        expect(draft).toMatchObject({ rating: 3, body: "Useful app" })
        act(() => draft.onSettled?.("confirmed"))
        expect(screen.getByRole("status")).toHaveTextContent(/confirmed on chain/)
    })

    it("returns focus to the toggle when a posted review collapses the form, without taking it from elsewhere", async () => {
        show(session("member"))
        const first = await review("4 stars")
        screen.getByRole("button", { name: "Review in Memba OS" }).focus()
        act(() => first.onSettled?.("confirmed"))
        expect(screen.getByRole("button", { name: "Write a review" })).toHaveFocus()

        mocks.request.mockClear()
        const second = await review("4 stars")
        const elsewhere = document.body.appendChild(document.createElement("button"))
        elsewhere.focus()
        act(() => second.onSettled?.("confirmed"))
        expect(elsewhere).toHaveFocus()
        elsewhere.remove()
    })

    it("says an unknown outcome plainly and leaves the draft ready to post again", async () => {
        show(session("member"))
        const draft = await review("3 stars", "Useful app")
        act(() => draft.onSettled?.("unknown"))
        expect(screen.getByRole("alert")).toHaveTextContent(/outcome is unknown.*Refresh the reviews.*replaces your rating and text/)
        expect(screen.getByRole("textbox", { name: /Your review/ })).toHaveValue("Useful app")
        expect(screen.getByRole("button", { name: "Review in Memba OS" })).toBeEnabled()
        expect(onSubmitted).not.toHaveBeenCalled()
    })

    it("keeps the draft when the signature is cancelled", async () => {
        show(session("member"))
        const draft = await review("3 stars", "Useful app")
        act(() => draft.onSettled?.("cancelled"))
        expect(screen.getByRole("radio", { name: "3 stars" })).toBeChecked()
        expect(screen.getByRole("textbox", { name: /Your review/ })).toHaveValue("Useful app")
        expect(screen.queryByRole("alert")).not.toBeInTheDocument()
        expect(onSubmitted).not.toHaveBeenCalled()
    })

    it("shows why a review could not be prepared as an alert, and keeps the draft", async () => {
        mocks.request.mockImplementation(() => { throw new Error("App reviews are not available on this network.") })
        show(session("member"))
        await review("5 stars", "Useful app")
        expect(screen.getByRole("alert")).toHaveTextContent("App reviews are not available on this network.")
        expect(sign).not.toHaveBeenCalled()
        expect(screen.getByRole("textbox", { name: /Your review/ })).toHaveValue("Useful app")
    })

    it("blocks a review whose text is over the realm's byte limit", async () => {
        show(session("member"))
        // 1,001 characters fit the field's character limit and take 2,002 bytes.
        await review("5 stars", "é".repeat(1001))
        expect(screen.getByRole("alert")).toHaveTextContent("Review text is too long in UTF-8 bytes.")
        expect(screen.getByText("2002 / 2,000 bytes")).toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Review in Memba OS" })).toBeDisabled()
        expect(mocks.request).not.toHaveBeenCalled()
    })

    it("opens no sheet when the chain does not report a gas price, and says so", async () => {
        mocks.freshPrice.mockRejectedValue(new Error("offline"))
        show(session("member"))
        await review("4 stars", "Useful app")
        expect(screen.getByRole("alert")).toHaveTextContent("The network fee could not be read. Try again in a moment.")
        expect(mocks.request).not.toHaveBeenCalled()
        expect(sign).not.toHaveBeenCalled()
        expect(screen.getByRole("button", { name: "Review in Memba OS" })).toBeEnabled()
    })

    it("asks for one sheet while the fee is read, and keeps the review as shown until it opens", async () => {
        let answer: (price: { gas: number; ugnot: number }) => void = () => {}
        mocks.freshPrice.mockReturnValue(new Promise((resolve) => { answer = resolve }))
        show(session("member"))
        fireEvent.click(screen.getByRole("button", { name: "Write a review" }))
        fireEvent.click(screen.getByRole("radio", { name: "4 stars" }))
        fireEvent.click(screen.getByRole("button", { name: "Review in Memba OS" }))
        const waiting = screen.getByRole("button", { name: "Checking fee…" })
        expect(waiting).toHaveAttribute("aria-disabled", "true")
        expect(waiting).toBeEnabled() // focusable: the sheet hands focus back to it
        expect(screen.getByRole("status")).toHaveTextContent("Reading the network fee from the chain…")
        expect(screen.getByRole("textbox", { name: /Your review/ }).closest("[inert]")).not.toBeNull()
        fireEvent.click(waiting)
        fireEvent.click(waiting)
        expect(mocks.freshPrice).toHaveBeenCalledTimes(1)
        await act(async () => { answer({ gas: 1000, ugnot: 2 }) })
        expect(sign).toHaveBeenCalledTimes(1)
        expect(screen.getByRole("button", { name: "Review in Memba OS" })).not.toHaveAttribute("aria-disabled", "true")
        expect(screen.getByRole("textbox", { name: /Your review/ }).closest("[inert]")).toBeNull()
    })

    it("opens no sheet for a form that was closed while the fee was read", async () => {
        let answer: (price: { gas: number; ugnot: number }) => void = () => {}
        mocks.freshPrice.mockReturnValue(new Promise((resolve) => { answer = resolve }))
        show(session("member"))
        fireEvent.click(screen.getByRole("button", { name: "Write a review" }))
        fireEvent.click(screen.getByRole("radio", { name: "4 stars" }))
        fireEvent.click(screen.getByRole("button", { name: "Review in Memba OS" }))
        fireEvent.click(screen.getByRole("button", { name: "Close editor" }))
        await act(async () => { answer({ gas: 1000, ugnot: 2 }) })
        expect(mocks.request).not.toHaveBeenCalled()
        expect(sign).not.toHaveBeenCalled()
        // The draft is still there, and the next submit reads the fee again.
        fireEvent.click(screen.getByRole("button", { name: "Write a review" }))
        expect(screen.getByRole("radio", { name: "4 stars" })).toBeChecked()
        expect(screen.getByRole("button", { name: "Review in Memba OS" })).not.toHaveAttribute("aria-disabled", "true")
    })

    it("keeps the button focusable and inactive while the session is resuming", () => {
        sessionStorage.setItem("memba_os_review_draft:gnoland-1:gno.land/r/samcrew/app", JSON.stringify({ rating: 4, body: "" }))
        const openConnect = vi.fn()
        show(session("resuming", openConnect))
        // It says what it waits for: a click here does nothing yet.
        const button = screen.getByRole("button", { name: "Restoring your session…" })
        expect(button).toBeEnabled()
        expect(button).toHaveAttribute("aria-disabled", "true")
        fireEvent.click(button)
        expect(openConnect).not.toHaveBeenCalled()
        expect(mocks.freshPrice).not.toHaveBeenCalled()
        expect(sign).not.toHaveBeenCalled()
    })

    it("opens no sheet for a window that closed while the fee was read", async () => {
        let answer: (price: { gas: number; ugnot: number }) => void = () => {}
        mocks.freshPrice.mockReturnValue(new Promise((resolve) => { answer = resolve }))
        const view = show(session("member"))
        fireEvent.click(screen.getByRole("button", { name: "Write a review" }))
        fireEvent.click(screen.getByRole("radio", { name: "4 stars" }))
        fireEvent.click(screen.getByRole("button", { name: "Review in Memba OS" }))
        view.unmount()
        await act(async () => { answer({ gas: 1000, ugnot: 2 }) })
        expect(mocks.request).not.toHaveBeenCalled()
        expect(sign).not.toHaveBeenCalled()
    })

    it("quotes again after a fee rise: the next sheet and the wallet get the new fee", async () => {
        const { storeReviewRequest } = await vi.importActual<typeof import("./reviewRequest")>("./reviewRequest")
        mocks.request.mockImplementation(storeReviewRequest)
        mocks.freshPrice.mockResolvedValueOnce({ gas: 1000, ugnot: 1 })
        show(session("member"))
        await review("4 stars", "Useful app")
        const first = sign.mock.calls[0][0] as ReturnType<typeof storeReviewRequest>
        expect(first.lines(undefined)).toContainEqual(["Network fee", "0.0204 GNOT"])
        // The price doubles before the wallet opens: the first sheet is refused.
        mocks.freshPrice.mockResolvedValue({ gas: 1000, ugnot: 2 })
        await expect(first.recheck?.(undefined)).rejects.toThrow(/network fee increased/)

        await submit()
        await waitFor(() => expect(sign).toHaveBeenCalledTimes(2))
        const second = sign.mock.calls[1][0] as ReturnType<typeof storeReviewRequest>
        expect(second.lines(undefined)).toContainEqual(["Network fee", "0.0408 GNOT"])
        await expect(second.recheck?.(undefined)).resolves.toBeUndefined()
        const beforeSign = vi.fn()
        await second.send(undefined, beforeSign)
        expect(mocks.broadcast).toHaveBeenCalledWith(second.prepare(undefined).msgs, "Review app", { gasWanted: 17_000_000, gasFee: 40_800, beforeSign })
    })
})
