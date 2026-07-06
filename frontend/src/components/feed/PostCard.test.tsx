/**
 * PostCard — client-side moderation suppression. GetFeedThread returns the
 * thread root in ANY state (it may be a flag-hidden or deleted tombstone), so
 * the card must never render the body of a hidden/deleted post — it renders a
 * tombstone instead. Mirrors the realm's own renderPost suppression rule.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import type { UiPost } from "../../lib/feedTypes"
import { PostCard } from "./PostCard"

const basePost = (over: Partial<UiPost>): UiPost => ({
    id: 42n,
    author: "g1abcabcabcabcabcabcabcabcabcabcabcabcabc",
    body: "secret body text",
    replyTo: 0n,
    blockH: 100n,
    editedAt: 0n,
    flagCount: 0,
    hidden: false,
    deleted: false,
    replyCount: 0,
    ...over,
})

const noop = () => {}

describe("PostCard moderation suppression", () => {
    it("renders a tombstone, not the body, for a deleted post", () => {
        render(<PostCard post={basePost({ deleted: true })} connected={false} selfAddress={undefined} onRefetch={noop} />)
        expect(screen.queryByText("secret body text")).toBeNull()
        expect(screen.getByTestId("feed-post-tombstone")).toBeInTheDocument()
    })

    it("renders a tombstone, not the body, for a flag-hidden post", () => {
        render(<PostCard post={basePost({ hidden: true })} connected={false} selfAddress={undefined} onRefetch={noop} />)
        expect(screen.queryByText("secret body text")).toBeNull()
        expect(screen.getByTestId("feed-post-tombstone")).toBeInTheDocument()
    })

    it("renders the body normally for a visible post (no over-suppression)", () => {
        render(<PostCard post={basePost({})} connected={false} selfAddress={undefined} onRefetch={noop} />)
        expect(screen.getByText("secret body text")).toBeInTheDocument()
        expect(screen.queryByTestId("feed-post-tombstone")).toBeNull()
    })

    it("does not offer a flag action on a hidden post even to a connected non-author", () => {
        render(
            <PostCard
                post={basePost({ hidden: true })}
                connected={true}
                selfAddress="g1someoneelseXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
                onRefetch={noop}
            />,
        )
        expect(screen.queryByTestId("feed-flag-btn")).toBeNull()
    })
})
