/**
 * PostCard — write affordances off the indexed network.
 *
 * These posts come from the one chain the backend indexes. A flag/edit/delete
 * issued from another network carries this post's id to a DIFFERENT post that
 * happens to share it — so the controls must not be offered at all.
 * `submitFeedMsg` refuses regardless; this keeps the UI from inviting it.
 *
 * Separate file from PostCard.test.tsx because that suite pins the gate ON and
 * vi.mock is hoisted per-module.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"

const writable = vi.fn(() => false)
vi.mock("../../lib/config", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/config")>()),
    isFeedWritable: () => writable(),
}))
vi.mock("../../lib/feed", () => ({
    submitFeedMsg: vi.fn(),
    buildFlagPostMsg: vi.fn(() => ({})),
    buildEditPostMsg: vi.fn(() => ({})),
    buildDeletePostMsg: vi.fn(() => ({})),
}))

const { PostCard } = await import("./PostCard")

const SELF = "g1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const OTHER = "g1bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

const post = (author: string) => ({
    id: 5n, author, body: "hello", replyTo: 0n, blockH: 1n, blockTs: 0n,
    editedAt: 0n, flagCount: 0, hidden: false, deleted: false, replyCount: 0,
})

const common = { connected: true, onRefetch: () => {}, onOpenThread: () => {}, onOpenProfile: () => {} }

beforeEach(() => writable.mockReturnValue(false))

describe("PostCard write gate", () => {
    it("hides Flag on someone else's post off the indexed network", () => {
        render(<PostCard post={post(OTHER)} selfAddress={SELF} {...common} />)
        expect(screen.queryByTestId("feed-flag-btn")).toBeNull()
    })

    it("hides the author manage menu off the indexed network", () => {
        render(<PostCard post={post(SELF)} selfAddress={SELF} {...common} />)
        expect(screen.queryByTestId("feed-post-menu")).toBeNull()
    })

    it("shows both again on the indexed network", () => {
        writable.mockReturnValue(true)
        const { unmount } = render(<PostCard post={post(OTHER)} selfAddress={SELF} {...common} />)
        expect(screen.getByTestId("feed-flag-btn")).toBeInTheDocument()
        unmount()

        render(<PostCard post={post(SELF)} selfAddress={SELF} {...common} />)
        expect(screen.getByTestId("feed-post-menu")).toBeInTheDocument()
    })
})
