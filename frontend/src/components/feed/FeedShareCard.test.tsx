import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { FeedShareCard } from "./FeedShareCard"
import type { FeedPost } from "../../lib/feedApi"

function makePost(over: Partial<FeedPost> = {}): FeedPost {
    return {
        id: 9n,
        author: "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c",
        body: "Gno-native multisig is finally usable.",
        replyTo: 0n,
        blockH: 100n,
        blockTs: 1783960911n,
        editedAt: 0n,
        flagCount: 0,
        hidden: false,
        deleted: false,
        replyCount: 3,
        ...over,
    } as FeedPost
}

// A 2D-context stand-in — jsdom has no canvas, so getContext returns null without this.
function mockCtx() {
    return new Proxy(
        { font: "", fillStyle: "", textAlign: "", textBaseline: "", canvas: { width: 1200, height: 630 } },
        { get: (t, p) => (p in t ? (t as Record<string, unknown>)[p as string] : () => ({ width: 100 })) },
    ) as unknown as CanvasRenderingContext2D
}

let shareMock: ReturnType<typeof vi.fn>

beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(mockCtx() as never)
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb) =>
        (cb as BlobCallback)(new Blob(["png"], { type: "image/png" })),
    )
    shareMock = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "share", { value: shareMock, configurable: true })
    Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true })
})

afterEach(() => {
    vi.restoreAllMocks()
    // @ts-expect-error cleanup injected props
    delete navigator.share
    // @ts-expect-error cleanup injected props
    delete navigator.canShare
})

describe("FeedShareCard", () => {
    it("renders a Share card button", () => {
        render(<FeedShareCard post={makePost()} />)
        expect(screen.getByRole("button", { name: /share card/i })).toBeInTheDocument()
    })

    it("shares a PNG file via the native share sheet when supported", async () => {
        render(<FeedShareCard post={makePost()} />)
        fireEvent.click(screen.getByRole("button", { name: /share card/i }))
        await waitFor(() => expect(shareMock).toHaveBeenCalledOnce())
        const arg = shareMock.mock.calls[0][0]
        expect(arg.files?.[0]).toBeInstanceOf(File)
        expect(arg.files[0].type).toBe("image/png")
        expect(arg.url).toContain("/feed/post/9")
    })
})
