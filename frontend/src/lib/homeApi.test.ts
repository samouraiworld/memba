import { describe, it, expect, vi } from "vitest"

vi.mock("./api", () => ({ api: { getHomeSnapshot: vi.fn() } }))
const { api } = await import("./api")

describe("fetchHomeSnapshot", () => {
  it("returns the snapshot on success", async () => {
    vi.mocked(api.getHomeSnapshot).mockResolvedValue({ snapshot: { staleSources: [] } } as never)
    const { fetchHomeSnapshot } = await import("./homeApi")
    const snap = await fetchHomeSnapshot("test13")
    expect(snap).not.toBeNull()
  })
  it("returns null on error (endpoint absent)", async () => {
    vi.mocked(api.getHomeSnapshot).mockRejectedValue(new Error("not implemented"))
    const { fetchHomeSnapshot } = await import("./homeApi")
    expect(await fetchHomeSnapshot("test13")).toBeNull()
  })
})
