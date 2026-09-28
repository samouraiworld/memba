import { useSyncExternalStore } from "react"

export const LIVE_WIDGET_KEY = "memba_os_live_widget"
export const SKIP_INTRO_KEY = "memba_os_skip_intro"
const CHANGE_EVENT = "memba-os-preferences-change"

function read(key: string): boolean {
    try { return localStorage.getItem(key) === "1" } catch { return false }
}

function write(key: string, enabled: boolean): void {
    try {
        if (enabled) localStorage.setItem(key, "1")
        else localStorage.removeItem(key)
    } catch { /* The current view remains usable when storage is unavailable. */ }
    window.dispatchEvent(new Event(CHANGE_EVENT))
}

function subscribe(callback: () => void): () => void {
    window.addEventListener(CHANGE_EVENT, callback)
    window.addEventListener("storage", callback)
    return () => {
        window.removeEventListener(CHANGE_EVENT, callback)
        window.removeEventListener("storage", callback)
    }
}

export const readSkipIntro = () => read(SKIP_INTRO_KEY)
export const setSkipIntro = (enabled: boolean) => write(SKIP_INTRO_KEY, enabled)
export const setLiveWidget = (enabled: boolean) => write(LIVE_WIDGET_KEY, enabled)
export const useSkipIntro = () => useSyncExternalStore(subscribe, readSkipIntro, () => false)
export const useLiveWidget = () => useSyncExternalStore(subscribe, () => read(LIVE_WIDGET_KEY), () => false)
