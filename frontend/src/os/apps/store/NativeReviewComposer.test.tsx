import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { OsSession } from "../../shell/useOsSession"
import { SignerContext, type SignerApi } from "../../sign/signerContext"
import { NativeReviewComposer } from "./NativeReviewComposer"
import type { StoreReviewDraft } from "./reviewRequest"

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock("./reviewRequest", () => ({ storeReviewRequest: mocks.request }))

function session(status: "guest" | "member", openConnect = vi.fn()): OsSession {
    return { status, address: status === "member" ? `g1${"q".repeat(38)}` : "", network: { key: "mainnet", chainId: "gnoland-1" }, openConnect } as unknown as OsSession
}

const sign = vi.fn()
const signer: SignerApi = { sign, pending: [], notices: [], unread: 0, version: 0, markRead: vi.fn() }
const onSubmitted = vi.fn()

function show(current: OsSession) {
    return render(<SignerContext.Provider value={signer}><NativeReviewComposer session={current} subject="gno.land/r/samcrew/app" appName="Test App" onSubmitted={onSubmitted} /></SignerContext.Provider>)
}

/** Opens the editor, fills it in, and asks for the review sheet; returns what the request builder received. */
function review(stars: string, body = "") {
    fireEvent.click(screen.getByRole("button", { name: "Write a review" }))
    fireEvent.click(screen.getByRole("radio", { name: stars }))
    if (body) fireEvent.change(screen.getByRole("textbox", { name: /Your review/ }), { target: { value: body } })
    fireEvent.click(screen.getByRole("button", { name: "Review in Memba OS" }))
    return mocks.request.mock.calls[0]?.[0] as StoreReviewDraft
}

beforeEach(() => {
    sessionStorage.clear()
    sign.mockReset()
    onSubmitted.mockReset()
    mocks.request.mockReset().mockReturnValue({})
})
afterEach(() => { vi.restoreAllMocks() })

describe("native review composer", () => {
    it("opens the OS review sheet and retains a draft until the transaction is submitted", () => {
        show(session("member"))
        expect(screen.queryByRole("radiogroup", { name: "Your rating" })).not.toBeInTheDocument()
        const draft = review("4 stars", "Useful app")
        expect(draft).toMatchObject({ subject: "gno.land/r/samcrew/app", rating: 4, body: "Useful app", networkKey: "mainnet" })
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

    it("restores a guest's draft when connecting remounts the window, and forgets it once posted", () => {
        const guest = show(session("guest"))
        fireEvent.click(screen.getByRole("button", { name: "Write a review" }))
        fireEvent.click(screen.getByRole("radio", { name: "4 stars" }))
        fireEvent.change(screen.getByRole("textbox", { name: /Your review/ }), { target: { value: "Useful app" } })
        guest.unmount()

        const member = show(session("member"))
        expect(screen.getByRole("radio", { name: "4 stars" })).toBeChecked()
        expect(screen.getByRole("textbox", { name: /Your review/ })).toHaveValue("Useful app")
        fireEvent.click(screen.getByRole("button", { name: "Review in Memba OS" }))
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

    it("keeps working when the browser blocks session storage", () => {
        vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked") })
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked") })
        vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("blocked") })
        show(session("member"))
        const draft = review("3 stars", "Useful app")
        expect(draft).toMatchObject({ rating: 3, body: "Useful app" })
        act(() => draft.onSettled?.("confirmed"))
        expect(screen.getByRole("status")).toHaveTextContent(/confirmed on chain/)
    })

    it("returns focus to the toggle when a posted review collapses the form, without taking it from elsewhere", () => {
        show(session("member"))
        const first = review("4 stars")
        screen.getByRole("button", { name: "Review in Memba OS" }).focus()
        act(() => first.onSettled?.("confirmed"))
        expect(screen.getByRole("button", { name: "Write a review" })).toHaveFocus()

        mocks.request.mockClear()
        const second = review("4 stars")
        const elsewhere = document.body.appendChild(document.createElement("button"))
        elsewhere.focus()
        act(() => second.onSettled?.("confirmed"))
        expect(elsewhere).toHaveFocus()
        elsewhere.remove()
    })

    it("says an unknown outcome plainly and leaves the draft ready to post again", () => {
        show(session("member"))
        const draft = review("3 stars", "Useful app")
        act(() => draft.onSettled?.("unknown"))
        expect(screen.getByRole("alert")).toHaveTextContent(/outcome is unknown.*Refresh the reviews.*replaces your rating and text/)
        expect(screen.getByRole("textbox", { name: /Your review/ })).toHaveValue("Useful app")
        expect(screen.getByRole("button", { name: "Review in Memba OS" })).toBeEnabled()
        expect(onSubmitted).not.toHaveBeenCalled()
    })

    it("keeps the draft when the signature is cancelled", () => {
        show(session("member"))
        const draft = review("3 stars", "Useful app")
        act(() => draft.onSettled?.("cancelled"))
        expect(screen.getByRole("radio", { name: "3 stars" })).toBeChecked()
        expect(screen.getByRole("textbox", { name: /Your review/ })).toHaveValue("Useful app")
        expect(screen.queryByRole("alert")).not.toBeInTheDocument()
        expect(onSubmitted).not.toHaveBeenCalled()
    })

    it("shows why a review could not be prepared as an alert, and keeps the draft", () => {
        mocks.request.mockImplementation(() => { throw new Error("App reviews are not available on this network.") })
        show(session("member"))
        review("5 stars", "Useful app")
        expect(screen.getByRole("alert")).toHaveTextContent("App reviews are not available on this network.")
        expect(sign).not.toHaveBeenCalled()
        expect(screen.getByRole("textbox", { name: /Your review/ })).toHaveValue("Useful app")
    })

    it("blocks a review whose text is over the realm's byte limit", () => {
        show(session("member"))
        // 1,001 characters fit the field's character limit and take 2,002 bytes.
        review("5 stars", "é".repeat(1001))
        expect(screen.getByRole("alert")).toHaveTextContent("Review text is too long in UTF-8 bytes.")
        expect(screen.getByText("2002 / 2,000 bytes")).toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Review in Memba OS" })).toBeDisabled()
        expect(mocks.request).not.toHaveBeenCalled()
    })
})
