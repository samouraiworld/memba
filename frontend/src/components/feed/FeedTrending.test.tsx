import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import type { FeedPost } from "../../lib/feedApi"
import { FeedTrending } from "./FeedTrending"

vi.mock("../../hooks/home/useActorUsernames", () => ({ useActorUsernames: () => new Map() }))

const post = (id: bigint, body: string, replyCount: number): FeedPost => ({
    id, author: "g1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", body, replyTo: 0n, blockH: 0n, blockTs: 0n,
    editedAt: 0n, flagCount: 0, hidden: false, deleted: false, replyCount,
} as FeedPost)

describe("FeedTrending", () => {
    it("renders nothing when no post has replies", () => {
        const { container } = render(<FeedTrending posts={[post(1n, "a", 0)]} onOpenThread={() => {}} />)
        expect(container.firstChild).toBeNull()
    })

    it("lists posts that have replies and opens a thread on click", () => {
        const onOpen = vi.fn()
        render(<FeedTrending posts={[post(1n, "hot post", 3), post(2n, "quiet", 0)]} onOpenThread={onOpen} />)
        expect(screen.getByText("hot post")).toBeInTheDocument()
        expect(screen.queryByText("quiet")).toBeNull() // replyCount 0 → excluded
        fireEvent.click(screen.getByText("hot post"))
        expect(onOpen).toHaveBeenCalledWith(1n)
    })
})
