import { beforeEach, describe, expect, it, vi } from "vitest"
import { disableEcho, echoTrigger, enableEcho, ECHO_REALM, LAB_SCOPE, savedSubscription } from "./gnotif"
const ADDRESS = "g1rshnhfc8xazhcpuf99z6td9ykjh0qnrmtzjtvm"
const trigger = { id: "current-id", target: ECHO_REALM, event: "Echo", param: "to", verified: true }
const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/test", options: {}, unsubscribe: vi.fn(async () => true), toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/test", keys: { p256dh: "key", auth: "key" } }) }
const reg = { scope: new URL(LAB_SCOPE, location.origin).href, pushManager: { getSubscription: vi.fn(async () => subscription), subscribe: vi.fn(async () => subscription) } } as unknown as ServiceWorkerRegistration
beforeEach(() => {
    localStorage.clear(); vi.clearAllMocks()
    vi.stubGlobal("Notification", { permission: "granted", requestPermission: vi.fn(async () => "granted") })
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(url.endsWith("vapid") ? JSON.stringify({ publicKey: "BAAA" }) : null, { status: url.endsWith("vapid") ? 200 : 204 })))
})
describe("isolated Gnotif Echo subscription", () => {
    it("accepts only the verified matching realm/event/recipient trigger", () => {
        expect(echoTrigger([{ ...trigger, verified: false }, trigger])).toEqual(trigger)
        expect(() => echoTrigger([{ ...trigger, target: "gno.land/r/other" }])).toThrow()
    })
    it("never requests permission or touches the root registration", async () => {
        await expect(enableEcho(ADDRESS, trigger, { ...reg, scope: location.origin + "/" } as ServiceWorkerRegistration)).rejects.toThrow("wrong scope")
        expect(Notification.requestPermission).not.toHaveBeenCalled()
        expect(fetch).not.toHaveBeenCalled()
    })
    it("sets the runtime trigger and retains the endpoint for cleanup", async () => {
        await enableEcho(ADDRESS, trigger, reg)
        expect(savedSubscription()).toEqual({ endpoint: subscription.endpoint, address: ADDRESS, configured: true })
        expect(fetch).toHaveBeenLastCalledWith(expect.stringContaining("subscription/optins"), expect.objectContaining({ body: JSON.stringify({ endpoint: subscription.endpoint, optins: [{ trigger: "current-id", value: ADDRESS }] }) }))
    })
    it("does not remember failed opt-in setup as enabled", async () => {
        vi.mocked(fetch).mockImplementation(async (url) => new Response(String(url).endsWith("vapid") ? JSON.stringify({ publicKey: "BAAA" }) : null, { status: String(url).endsWith("optins") ? 500 : String(url).endsWith("vapid") ? 200 : 204 }))
        await expect(enableEcho(ADDRESS, trigger, reg)).rejects.toThrow()
        expect(savedSubscription()?.configured).toBe(false)
        expect(savedSubscription()?.endpoint).toBe(subscription.endpoint)
    })
    it("refuses a different push key before changing the remote subscription", async () => {
        vi.mocked(reg.pushManager.getSubscription).mockResolvedValueOnce({ ...subscription, options: { applicationServerKey: new Uint8Array([4, 0]).buffer } } as unknown as PushSubscription)
        await expect(enableEcho(ADDRESS, trigger, reg)).rejects.toThrow("different push key")
        expect(fetch).toHaveBeenCalledTimes(1)
    })
    it("permission denial never registers a remote subscription", async () => {
        vi.mocked(Notification.requestPermission).mockResolvedValue("denied")
        await expect(enableEcho(ADDRESS, trigger, reg)).rejects.toThrow("blocked")
        expect(fetch).not.toHaveBeenCalled()
    })
    it("keeps the endpoint when cleanup fails and retries even after browser unsubscribe", async () => {
        await enableEcho(ADDRESS, trigger, reg)
        vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 500 }))
        await expect(disableEcho(reg)).rejects.toThrow("cleanup failed")
        expect(savedSubscription()?.pendingDelete).toBe(true)
        vi.mocked(reg.pushManager.getSubscription).mockResolvedValueOnce(null)
        await disableEcho(reg)
        expect(savedSubscription()).toBeNull()
        expect(fetch).toHaveBeenLastCalledWith(expect.stringContaining("subscription"), expect.objectContaining({ method: "DELETE", body: JSON.stringify({ endpoint: subscription.endpoint }) }))
    })
    it("refuses to enable again while remote cleanup is pending", async () => {
        localStorage.setItem("memba_gnotif_echo", JSON.stringify({ endpoint: subscription.endpoint, address: ADDRESS, pendingDelete: true }))
        await expect(enableEcho(ADDRESS, trigger, reg)).rejects.toThrow("cleanup")
        expect(Notification.requestPermission).not.toHaveBeenCalled()
    })
})
