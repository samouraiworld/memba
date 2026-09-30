import { act as settle, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { OnChainComment, OnChainReview } from "../../lib/reviews"
import { renderWithProviders } from "../../test/test-utils"
import { ReviewCard, type ReviewAct } from "./ReviewCard"

const fetchComments = vi.hoisted(() => vi.fn())
vi.mock("../../lib/reviews", async (importActual) => ({ ...await importActual<typeof import("../../lib/reviews")>(), fetchComments }))
vi.mock("../../lib/blockTimeRpc", () => ({ fetchBlockTime: vi.fn().mockResolvedValue(null) }))

const AUTHOR = "g1m68u69m43n6x3t7v5auemxuk9vulescrjy0vxx"
const OTHER = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const review: OnChainReview = { id: 12, subject: "gno.land/r/x/app", author: AUTHOR, rating: 4, body: "Solid app", createdAt: 10, editedAt: 0, deleted: false, likes: 3, dislikes: 1, flags: 0, reputation: 0 }
const reply: OnChainComment = { id: 13, reviewId: 12, author: OTHER, body: "Agreed", createdAt: 11, editedAt: 0, deleted: false, likes: 0, dislikes: 0, flags: 0, reputation: 0 }

const onRefetch = vi.fn()
function show(viewer: string | null, act: ReviewAct, plain = false) {
    return renderWithProviders(<ReviewCard review={review} onRefetch={onRefetch} viewer={viewer} act={act} plain={plain} />)
}
const done = () => vi.fn<ReviewAct>().mockResolvedValue(true)

beforeEach(() => { onRefetch.mockReset(); fetchComments.mockReset().mockResolvedValue([reply]) })

describe("ReviewCard actions", () => {
    it("hands each action to `act` as the call it is, and reloads when it was carried out", async () => {
        const act = done()
        show(OTHER, act)
        fireEvent.click(screen.getByRole("button", { name: "Like — 3" }))
        await waitFor(() => expect(act).toHaveBeenLastCalledWith({ kind: "react", target: 12, on: "review", reaction: "like" }))
        await waitFor(() => expect(onRefetch).toHaveBeenCalledTimes(1))
        fireEvent.click(screen.getByRole("button", { name: "Dislike — 1" }))
        await waitFor(() => expect(act).toHaveBeenLastCalledWith({ kind: "react", target: 12, on: "review", reaction: "dislike" }))
        await waitFor(() => expect(onRefetch).toHaveBeenCalledTimes(2))
        fireEvent.click(screen.getByRole("button", { name: "Flag for moderation" }))
        await waitFor(() => expect(act).toHaveBeenLastCalledWith({ kind: "flag", target: 12, on: "review" }))

        // A reply: trimmed, and the thread is read again once it is posted.
        fireEvent.click(screen.getByRole("button", { name: "Reply" }))
        fireEvent.click(await screen.findByRole("button", { name: "+ Add reply" }))
        fireEvent.change(screen.getByPlaceholderText("Write a reply…"), { target: { value: "  Thanks  " } })
        const reads = fetchComments.mock.calls.length
        fireEvent.click(screen.getByRole("button", { name: "Post reply" }))
        await waitFor(() => expect(act).toHaveBeenLastCalledWith({ kind: "reply", review: 12, body: "Thanks" }))
        await waitFor(() => expect(fetchComments.mock.calls.length).toBeGreaterThan(reads))
    })

    it("lets the author edit and delete with the text that was shown, and the reply's author likewise", async () => {
        const act = done()
        const author = show(AUTHOR, act)
        // No reaction or flag on one's own review.
        expect(screen.getByRole("button", { name: "Like — 3" })).toBeDisabled()
        expect(screen.queryByRole("button", { name: "Flag for moderation" })).toBeNull()
        fireEvent.click(screen.getByRole("button", { name: "Edit" }))
        fireEvent.change(screen.getByPlaceholderText("Update your review…"), { target: { value: " Solid app, updated " } })
        fireEvent.click(screen.getByRole("button", { name: "Save" }))
        await waitFor(() => expect(act).toHaveBeenLastCalledWith({ kind: "editReview", review: 12, rating: 4, body: "Solid app, updated", was: "Solid app" }))
        await waitFor(() => expect(screen.queryByPlaceholderText("Update your review…")).toBeNull())
        fireEvent.click(screen.getByRole("button", { name: "Delete" }))
        await waitFor(() => expect(act).toHaveBeenLastCalledWith({ kind: "deleteReview", review: 12 }))
        author.unmount()

        show(OTHER, act)
        fireEvent.click(screen.getByRole("button", { name: "Reply" }))
        const row = (await screen.findByText("Agreed")).closest(".review-comment") as HTMLElement
        fireEvent.click(within(row).getByRole("button", { name: "Edit" }))
        fireEvent.change(within(row).getByRole("textbox"), { target: { value: "Agreed, mostly" } })
        fireEvent.click(within(row).getByRole("button", { name: "Save" }))
        await waitFor(() => expect(act).toHaveBeenLastCalledWith({ kind: "editReply", reply: 13, body: "Agreed, mostly", was: "Agreed" }))
        await waitFor(() => expect(within(row).queryByRole("textbox")).toBeNull())
        fireEvent.click(within(row).getByRole("button", { name: "Delete" }))
        await waitFor(() => expect(act).toHaveBeenLastCalledWith({ kind: "deleteReply", reply: 13 }))
    })

    it("keeps an edit open with its text and reloads nothing when the action was handed over or cancelled", async () => {
        const act = vi.fn<ReviewAct>().mockResolvedValue(false)
        show(AUTHOR, act)
        fireEvent.click(screen.getByRole("button", { name: "Edit" }))
        fireEvent.change(screen.getByPlaceholderText("Update your review…"), { target: { value: "Draft edit" } })
        fireEvent.click(screen.getByRole("button", { name: "Save" }))
        await waitFor(() => expect(act).toHaveBeenCalledTimes(1))
        await settle(async () => {})
        expect(screen.getByPlaceholderText("Update your review…")).toHaveValue("Draft edit")
        expect(onRefetch).not.toHaveBeenCalled()
    })

    it("shows why an action did not go through", async () => {
        const act = vi.fn<ReviewAct>().mockRejectedValue(new Error("This review is no longer available. Refresh the reviews."))
        show(OTHER, act)
        fireEvent.click(screen.getByRole("button", { name: "Like — 3" }))
        expect(await screen.findByRole("alert")).toHaveTextContent("This review is no longer available. Refresh the reviews.")
        expect(onRefetch).not.toHaveBeenCalled()
    })

    it("asks once while an action is in flight, with its control still focusable", async () => {
        let finish: (value: boolean) => void = () => {}
        const act = vi.fn<ReviewAct>(() => new Promise((resolve) => { finish = resolve }))
        show(OTHER, act)
        const like = screen.getByRole("button", { name: "Like — 3" })
        like.focus()
        fireEvent.click(like)
        await waitFor(() => expect(like).toHaveAttribute("aria-disabled", "true"))
        expect(like).toBeEnabled()
        expect(like).toHaveFocus()
        fireEvent.click(like)
        fireEvent.click(screen.getByRole("button", { name: "Flag for moderation" }))
        expect(act).toHaveBeenCalledTimes(1)
        await settle(async () => { finish(true) })
        expect(like).toHaveAttribute("aria-disabled", "false")
    })

    it("refuses a reply or an edit over the realm's byte limits before anything is asked", async () => {
        const act = done()
        const other = show(OTHER, act)
        fireEvent.click(screen.getByRole("button", { name: "Reply" }))
        fireEvent.click(await screen.findByRole("button", { name: "+ Add reply" }))
        // 501 two-byte characters: 1,002 bytes, over the 1,000-byte reply limit though under it in characters.
        fireEvent.change(screen.getByPlaceholderText("Write a reply…"), { target: { value: "é".repeat(501) } })
        expect(screen.getByRole("alert")).toHaveTextContent("A reply is limited to 1,000 bytes.")
        expect(screen.getByRole("button", { name: "Post reply" })).toBeDisabled()
        other.unmount()

        show(AUTHOR, act)
        fireEvent.click(screen.getByRole("button", { name: "Edit" }))
        fireEvent.change(screen.getByPlaceholderText("Update your review…"), { target: { value: "é".repeat(1001) } })
        expect(screen.getByRole("alert")).toHaveTextContent("A review is limited to 2,000 bytes.")
        expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
        expect(act).not.toHaveBeenCalled()
    })

    it("lets a visitor press every action, which asks for the wallet there, and words instead of emoji in Memba OS", async () => {
        const act = vi.fn().mockResolvedValue(false)
        show(null, act, true)
        const like = screen.getByRole("button", { name: "Like — 3" })
        expect(like).toHaveTextContent("Like 3")
        expect(screen.getByRole("button", { name: "Dislike — 1" })).toHaveTextContent("Dislike 1")
        fireEvent.click(like)
        await waitFor(() => expect(act).toHaveBeenLastCalledWith({ kind: "react", target: 12, on: "review", reaction: "like" }))
        fireEvent.click(screen.getByRole("button", { name: "Flag for moderation" }))
        await waitFor(() => expect(act).toHaveBeenLastCalledWith({ kind: "flag", target: 12, on: "review" }))
        fireEvent.click(screen.getByRole("button", { name: "Reply" }))
        fireEvent.click(await screen.findByRole("button", { name: "+ Add reply" }))
        fireEvent.change(screen.getByPlaceholderText("Write a reply…"), { target: { value: "hello" } })
        fireEvent.click(screen.getByRole("button", { name: "Post reply" }))
        await waitFor(() => expect(act).toHaveBeenLastCalledWith({ kind: "reply", review: 12, body: "hello" }))
        expect(screen.queryByText("Connect wallet to reply.")).toBeNull()
        expect(document.body.textContent).not.toMatch(/[\u{1F44D}\u{1F44E}\u{1F4AC}\u{1F6A9}]/u)
    })
})
