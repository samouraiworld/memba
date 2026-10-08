import { afterEach, beforeEach, expect, it, vi } from "vitest"

const config = vi.hoisted(() => ({ GNO_MONITORING_API_URL: "https://monitoring.example.test" }))
vi.mock("./config", () => config)
import { eraseMonitoringUser } from "./monitoringAuth"

beforeEach(() => { config.GNO_MONITORING_API_URL = "https://monitoring.example.test" })
afterEach(() => vi.unstubAllGlobals())

it("uses authenticated POST erasure and requires its strict 204 contract", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal("fetch", fetch)
    expect(await eraseMonitoringUser("test-token")).toEqual({ ok: true })
    expect(fetch).toHaveBeenCalledWith("https://monitoring.example.test/users/erase", expect.objectContaining({
        method: "POST", headers: { Authorization: "Bearer test-token" }, signal: expect.any(AbortSignal),
    }))
    expect(fetch.mock.calls[0][1]).not.toHaveProperty("body")
})

it.each([200, 202, 400, 401, 404, 405, 410, 500, 503])("never treats HTTP %i as confirmed erasure", async status => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status })))
    const result = await eraseMonitoringUser("test-token")
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
    if (status === 404) expect(result.error).toContain("erasure is unavailable")
})

it.each([new TypeError("offline"), new DOMException("timeout", "TimeoutError")])("keeps uncertain network results retryable", async failure => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(new Response(null, { status: 204 })))
    expect(await eraseMonitoringUser("test-token")).toMatchObject({ ok: false })
    expect(await eraseMonitoringUser("test-token")).toEqual({ ok: true })
})

it("does not claim erasure when monitoring is unconfigured", async () => {
    config.GNO_MONITORING_API_URL = ""
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    expect(await eraseMonitoringUser("test-token")).toMatchObject({ ok: false, error: expect.stringContaining("not configured") })
    expect(fetch).not.toHaveBeenCalled()
})
