/* global self */
// Only /labs/gnotif/ is controlled by this worker. Memba's PWA owns /.
const SERVER = "https://gnotif.xyz/onyx"
self.addEventListener("install", event => event.waitUntil(self.skipWaiting()))
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()))
self.addEventListener("push", event => {
    let payload
    try { payload = event.data?.json() } catch { /* A malformed push still needs a visible notification. */ }
    const title = typeof payload?.title === "string" ? payload.title.slice(0, 160) : "Gnotif test"
    const body = typeof payload?.body === "string" ? payload.body.slice(0, 1000) : "New activity on Onyx"
    // Echo currently links to /. Pin our test to the Memba home, never a payload's external URL.
    event.waitUntil(self.registration.showNotification(title || "Gnotif test", { body, tag: "memba-gnotif-echo", renotify: true, data: { url: new URL("/os", self.location.origin).href } }))
})
self.addEventListener("notificationclick", event => {
    event.notification.close()
    event.waitUntil((async () => {
        const url = new URL("/os", self.location.origin).href
        const tabs = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
        const tab = tabs.find(t => t.url.startsWith(self.location.origin + "/os"))
        if (tab) return tab.focus()
        return self.clients.openWindow(url)
    })())
})
self.addEventListener("pushsubscriptionchange", event => {
    event.waitUntil((async () => {
        const res = await fetch(SERVER + "/v1/vapid")
        if (!res.ok) throw new Error("Gnotif key is unavailable")
        const { publicKey } = await res.json()
        const next = event.newSubscription ?? await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey })
        const updated = await fetch(SERVER + "/v1/subscription", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...next.toJSON(), oldEndpoint: event.oldSubscription?.endpoint }) })
        if (!updated.ok) throw new Error("Gnotif could not renew the subscription")
        // Tell an open lab about rotation; it will refresh its saved cleanup endpoint.
        for (const client of await self.clients.matchAll({ type: "window" })) client.postMessage({ type: "gnotif-rotated", endpoint: next.endpoint })
    })())
})
