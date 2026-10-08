/** A deliberately isolated Onyx Web Push experiment, using the documented HTTP API. */
export const GNOTIF_SERVER = "https://gnotif.xyz/onyx"
export const ECHO_REALM = "gno.land/r/nym-gfanton001/echo/v0"
export const LAB_SCOPE = "/labs/gnotif/"
const LOCAL_KEY = "memba_gnotif_echo"
interface Saved { endpoint: string; address: string; configured?: boolean; pendingDelete?: boolean }
export interface Trigger { id: string; target: string; event: string; param: string; verified: boolean }
export function decodeKey(key: string): Uint8Array<ArrayBuffer> {
    const s = key.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(key.length / 4) * 4, "=")
    return Uint8Array.from(atob(s), c => c.charCodeAt(0))
}
export function savedSubscription(storage: Storage = localStorage): Saved | null {
    try {
        const v = JSON.parse(storage.getItem(LOCAL_KEY) ?? "null")
        return v && typeof v.endpoint === "string" && typeof v.address === "string" ? v : null
    } catch { return null }
}
export function echoTrigger(value: unknown): Trigger {
    if (!Array.isArray(value)) throw new Error("Gnotif returned an invalid trigger list.")
    const match = value.find(v => v && typeof v.id === "string" && v.target === ECHO_REALM && v.event === "Echo" && v.param === "to" && v.verified === true)
    if (!match) throw new Error("The verified Echo trigger is unavailable. Try again later.")
    return match
}
async function request(path: string, method = "GET", body?: unknown): Promise<Response> {
    const res = await fetch(`${GNOTIF_SERVER}/v1/${path}`, { method, signal: AbortSignal.timeout(8000), headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined })
    if (!res.ok) throw new Error(`Gnotif answered ${res.status}. Try again later.`)
    return res
}
export async function loadEchoTrigger(): Promise<Trigger> {
    return echoTrigger(await (await request(`triggers?target=${encodeURIComponent(ECHO_REALM)}`)).json())
}
/** Never use navigator.serviceWorker.ready: it can resolve Memba's root worker. */
export async function scopedRegistration(): Promise<ServiceWorkerRegistration> {
    if (location.pathname !== LAB_SCOPE && location.pathname !== `${LAB_SCOPE}index.html`) throw new Error("Open the notification test page before enabling.")
    const reg = await navigator.serviceWorker.register(`${LAB_SCOPE}sw.js`, { scope: LAB_SCOPE })
    if (reg.scope !== new URL(LAB_SCOPE, location.origin).href) throw new Error("The notification worker has the wrong scope.")
    if (!reg.active) await new Promise<void>((resolve, reject) => {
        const worker = reg.installing ?? reg.waiting
        if (!worker) { reject(new Error("The notification worker did not start.")); return }
        const timeout = setTimeout(() => finish(new Error("The notification worker did not activate.")), 10000)
        const changed = () => {
            if (worker.state === "activated") finish()
            else if (worker.state === "redundant") finish(new Error("The notification worker was replaced."))
        }
        const finish = (error?: Error) => { clearTimeout(timeout); worker.removeEventListener("statechange", changed); if (error) reject(error); else resolve() }
        worker.addEventListener("statechange", changed); changed()
    })
    return reg
}
export async function enableEcho(address: string, trigger: Trigger, reg: ServiceWorkerRegistration): Promise<void> {
    if (reg.scope !== new URL(LAB_SCOPE, location.origin).href) throw new Error("The notification worker has the wrong scope.")
    // All values are public, but test addresses must be real Gno addresses.
    if (!/^g1[023456789acdefghjklmnpqrstuvwxyz]{38}$/.test(address)) throw new Error("Enter a valid Onyx Gno address.")
    if (savedSubscription()?.pendingDelete) throw new Error("Retry notification cleanup before enabling again.")
    if (await Notification.requestPermission() !== "granted") throw new Error("Notifications are blocked. Allow this site in your browser settings to try again.")
    const key = await (await request("vapid")).json()
    if (typeof key.publicKey !== "string") throw new Error("Gnotif returned an invalid push key.")
    const bytes = decodeKey(key.publicKey)
    const existing = await reg.pushManager.getSubscription()
    const existingKey = existing?.options.applicationServerKey ? new Uint8Array(existing.options.applicationServerKey) : null
    if (existingKey && (existingKey.length !== bytes.length || !existingKey.every((n, i) => n === bytes[i]))) {
        throw new Error("This test has a different push key. Turn notifications off before trying again.")
    }
    const sub = existing ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes })
    // Preserve the endpoint before any remote operation so failed setup can be cleaned up.
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify({ endpoint: sub.endpoint, address, configured: false })) } catch { await sub.unsubscribe(); throw new Error("This browser cannot save notification settings. Notifications were not enabled.") }
    await request("subscription", "PUT", sub.toJSON())
    await request("subscription/optins", "PUT", { endpoint: sub.endpoint, optins: [{ trigger: trigger.id, value: address }] })
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ endpoint: sub.endpoint, address, configured: true }))
}
export async function disableEcho(reg: ServiceWorkerRegistration): Promise<void> {
    if (reg.scope !== new URL(LAB_SCOPE, location.origin).href) throw new Error("The notification worker has the wrong scope.")
    const sub = await reg.pushManager.getSubscription()
    const saved = savedSubscription()
    const endpoint = sub?.endpoint ?? saved?.endpoint
    if (!endpoint) return
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ endpoint, address: saved?.address ?? "", pendingDelete: true }))
    if (sub && !await sub.unsubscribe()) throw new Error("The browser could not unsubscribe. Try turning notifications off again.")
    const res = await fetch(`${GNOTIF_SERVER}/v1/subscription`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint }), signal: AbortSignal.timeout(8000) })
    if (!res.ok && res.status !== 404) throw new Error("Browser delivery is off; server cleanup failed. Retry cleanup.")
    localStorage.removeItem(LOCAL_KEY)
}
