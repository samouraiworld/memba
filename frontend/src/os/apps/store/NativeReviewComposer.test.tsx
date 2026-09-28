import { act, fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
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

beforeEach(() => {
    sign.mockReset()
    onSubmitted.mockReset()
    mocks.request.mockReset().mockReturnValue({})
})

describe("native review composer", () => {
    it("opens the OS review sheet and retains a draft until the transaction is submitted", () => {
        show(session("member"))
        expect(screen.queryByRole("radiogroup", { name: "Your rating" })).not.toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Write a review" }))
        fireEvent.click(screen.getByRole("radio", { name: "4 stars" }))
        fireEvent.change(screen.getByRole("textbox", { name: /Your review/ }), { target: { value: "Useful app" } })
        fireEvent.click(screen.getByRole("button", { name: "Review in Memba OS" }))
        const draft = mocks.request.mock.calls[0][0] as StoreReviewDraft
        expect(draft).toMatchObject({ subject: "gno.land/r/samcrew/app", rating: 4, body: "Useful app", networkKey: "mainnet" })
        expect(sign).toHaveBeenCalledTimes(1)
        expect(screen.getByRole("textbox", { name: /Your review/ })).toHaveValue("Useful app")
        act(() => draft.onSettled?.("submitted"))
        expect(onSubmitted).toHaveBeenCalledTimes(1)
        expect(screen.getByText(/submitted to the network/)).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Write a review" }))
        expect(screen.getByRole("textbox", { name: /Your review/ })).toHaveValue("")
    })

    it("opens OS connection for a guest without preparing a wallet transaction", () => {
        const openConnect = vi.fn()
        show(session("guest", openConnect))
        fireEvent.click(screen.getByRole("button", { name: "Write a review" }))
        fireEvent.click(screen.getByRole("radio", { name: "5 stars" }))
        fireEvent.click(screen.getByRole("button", { name: "Connect to review" }))
        expect(openConnect).toHaveBeenCalledTimes(1)
        expect(mocks.request).not.toHaveBeenCalled()
        expect(sign).not.toHaveBeenCalled()
    })

    it("locks an unknown outcome until the reviewer checks the transaction", () => {
        show(session("member"))
        fireEvent.click(screen.getByRole("button", { name: "Write a review" }))
        fireEvent.click(screen.getByRole("radio", { name: "3 stars" }))
        fireEvent.click(screen.getByRole("button", { name: "Review in Memba OS" }))
        const draft = mocks.request.mock.calls[0][0] as StoreReviewDraft
        act(() => draft.onSettled?.("unknown"))
        expect(screen.getByRole("button", { name: "Review in Memba OS" })).toBeDisabled()
        expect(screen.getByText(/outcome is unknown/)).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "I checked my transaction" }))
        expect(screen.getByRole("button", { name: "Review in Memba OS" })).toBeEnabled()
    })
})
