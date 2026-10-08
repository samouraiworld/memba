import "../../src/os/os.css"
import "./style.css"
import { disableEcho, enableEcho, LAB_SCOPE, loadEchoTrigger, savedSubscription, scopedRegistration, type Trigger } from "../../src/os/notifications/gnotif"
import { isValidGnoAddressChecksum } from "../../src/lib/dao/address"
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const address = $<HTMLInputElement>("address"), enable = $<HTMLButtonElement>("enable"), disable = $<HTMLButtonElement>("disable"), status = $("status")
let reg: ServiceWorkerRegistration | undefined
let trigger: Trigger | undefined
let busy = false
let configured = false
const say = (message: string) => { status.textContent = message }
const enabled = import.meta.env.VITE_ENABLE_GNOTIF_LAB === "true"
function theme() {
    let pref = "auto"
    try { pref = localStorage.getItem("memba_os_theme") ?? "auto" } catch { /* system default */ }
    document.body.dataset.osTheme = pref === "dark" || pref === "auto" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}
theme(); matchMedia("(prefers-color-scheme: dark)").addEventListener("change", theme)
function controls() {
    enable.disabled = busy || !reg || !trigger
    enable.textContent = configured ? "Update test address" : "Enable notifications"
    disable.disabled = busy
    disable.hidden = !savedSubscription()
    disable.textContent = savedSubscription()?.pendingDelete ? "Retry cleanup" : "Turn off"
    address.disabled = busy
}
function error(err: unknown) { say(err instanceof Error ? err.message : "This browser could not finish the request.") }
async function setup() {
    if (!enabled) { say("This experiment is not enabled in this Memba build."); $("enable").hidden = true; document.querySelector<HTMLElement>(".send")!.hidden = true; return }
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window) || !isSecureContext) { say("Web Push is unavailable here. Try Chrome on desktop over HTTPS. On iPhone, notifications need an installed Home Screen app."); return }
    try {
        reg = await scopedRegistration()
        trigger = await loadEchoTrigger()
        const sub = await reg.pushManager.getSubscription()
        const saved = savedSubscription()
        address.value = saved?.address ?? ""
        configured = Boolean(sub && saved?.configured && !saved.pendingDelete && Notification.permission === "granted")
        say(saved?.pendingDelete ? "Browser delivery is off. Retry server cleanup." : configured ? `Notifications are on for ${saved!.address}.` : Notification.permission === "denied" ? "Notifications are blocked in your browser's site settings." : "Ready. Enable notifications, then send yourself an Echo.")
    } catch (err) { error(err) }
    controls()
}
enable.addEventListener("click", async () => {
    if (!reg || !trigger || busy) return
    const value = address.value.trim()
    if (!isValidGnoAddressChecksum(value)) { say("Enter a valid Onyx Gno address."); address.focus(); return }
    busy = true; controls(); say("Waiting for notification permission…")
    try { await enableEcho(value, trigger, reg); configured = true; say(`Notifications are on for ${value}. Send an Echo from that address.`) } catch (err) { configured = false; error(err) }
    busy = false; controls()
})
disable.addEventListener("click", async () => {
    if (!reg || busy) return
    busy = true; controls()
    try { await disableEcho(reg); configured = false; say("Notifications are off for this browser.") } catch (err) { configured = false; error(err) }
    busy = false; controls()
})
// Read the current subscription on re-entry, including after browser endpoint rotation.
window.addEventListener("focus", () => {
    if (!reg || busy) return
    void reg.pushManager.getSubscription().then(sub => {
        const saved = savedSubscription()
        if (saved && sub && saved.endpoint !== sub.endpoint && !saved.pendingDelete) localStorage.setItem("memba_gnotif_echo", JSON.stringify({ ...saved, endpoint: sub.endpoint }))
        configured = Boolean(sub && saved?.configured && !saved.pendingDelete && Notification.permission === "granted")
        controls()
    }).catch(error)
})
navigator.serviceWorker?.addEventListener("message", event => {
    if (event.data?.type !== "gnotif-rotated" || !reg || event.source !== reg.active) return
    const saved = savedSubscription()
    if (saved && typeof event.data.endpoint === "string" && !saved.pendingDelete) localStorage.setItem("memba_gnotif_echo", JSON.stringify({ ...saved, endpoint: event.data.endpoint }))
})
void setup()
// Keep the scope explicit in this entry, so refactors cannot accidentally use the root page.
if (location.pathname === LAB_SCOPE.slice(0, -1)) location.replace(LAB_SCOPE)
