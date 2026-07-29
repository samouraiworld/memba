import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock the shared ConnectRPC client so we can assert how the bearer is (or isn't) attached.
vi.mock("./api", () => ({
    api: {
        getFlaggedPosts: vi.fn(),
        getModerationLog: vi.fn(),
    },
}))

const apiMod = await import("./api")

describe("feedModerationApi", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.unstubAllGlobals()
    })

    it("fetchFlaggedPosts attaches the operator bearer as a per-call header", async () => {
        vi.mocked(apiMod.api.getFlaggedPosts).mockResolvedValue({ posts: [], nextCursor: 0n } as never)
        const { fetchFlaggedPosts } = await import("./feedModerationApi")

        await fetchFlaggedPosts("s3cret", 0n, 20)

        expect(apiMod.api.getFlaggedPosts).toHaveBeenCalledWith(
            { cursor: 0n, limit: 20 },
            { headers: { Authorization: "Bearer s3cret" } },
        )
    })

    it("fetchFlaggedPosts PROPAGATES an auth error (never a silently-empty queue)", async () => {
        vi.mocked(apiMod.api.getFlaggedPosts).mockRejectedValue(new Error("unauthenticated"))
        const { fetchFlaggedPosts } = await import("./feedModerationApi")

        await expect(fetchFlaggedPosts("wrong", 0n, 20)).rejects.toThrow()
    })

    it("fetchModerationLog calls the PUBLIC RPC with no auth header (no bearer leak)", async () => {
        vi.mocked(apiMod.api.getModerationLog).mockResolvedValue({ entries: [], nextCursor: 0n } as never)
        const { fetchModerationLog } = await import("./feedModerationApi")

        await fetchModerationLog(0n, 50)

        expect(apiMod.api.getModerationLog).toHaveBeenCalledWith({ cursor: 0n, limit: 50 })
        expect(vi.mocked(apiMod.api.getModerationLog).mock.calls[0]).toHaveLength(1) // no 2nd (headers) arg
    })

    it("postModeration sends the bearer + stringified post_id", async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "" })
        vi.stubGlobal("fetch", fetchMock)
        const { postModeration } = await import("./feedModerationApi")

        await postModeration({ postId: 1234n, action: "override_serve", reason: "fp", by: "ops" }, "s3cret")

        expect(fetchMock).toHaveBeenCalledOnce()
        const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
        expect(url).toMatch(/\/api\/feed\/moderation$/)
        expect((opts.headers as Record<string, string>).Authorization).toBe("Bearer s3cret")
        const sent = JSON.parse(opts.body as string)
        // Sent as a JSON NUMBER — the backend decodes into a uint64 (no `,string`
        // tag), so a quoted string would 400. Feed ids are far below 2^53.
        expect(sent.post_id).toBe(1234)
        expect(typeof sent.post_id).toBe("number")
        expect(sent.action).toBe("override_serve")
    })

    it("postModeration surfaces the backend's plain-text rejection (does NOT swallow)", async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: false,
            status: 409,
            text: async () => "post not found, deleted, or blocklisted; cannot serve-override\n",
        })
        vi.stubGlobal("fetch", fetchMock)
        const { postModeration } = await import("./feedModerationApi")

        await expect(
            postModeration({ postId: 2n, action: "override_serve" }, "s3cret"),
        ).rejects.toThrow(/blocklisted/)
    })
})
