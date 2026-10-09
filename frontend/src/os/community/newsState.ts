import { useSyncExternalStore } from "react"

/** Announcement identity is independent of app releases, networks and wallet accounts. */
export const COMMUNITY_NEWS_KEY = "memba_os_community_news_v1"
const CHANGE = "memba-os-community-news-change"
type NewsState = "new" | "shown" | "read"

function read(): NewsState {
    try {
        const value = localStorage.getItem(COMMUNITY_NEWS_KEY)
        return value === null ? "new" : value === "shown" ? "shown" : "read"
    } catch {
        // Without durable storage, keep the links in News/About rather than repeat a prompt.
        return "read"
    }
}
function subscribe(callback: () => void): () => void {
    window.addEventListener(CHANGE, callback)
    window.addEventListener("storage", callback)
    return () => {
        window.removeEventListener(CHANGE, callback)
        window.removeEventListener("storage", callback)
    }
}
function write(value: "shown" | "read"): boolean {
    let saved = false
    try {
        localStorage.setItem(COMMUNITY_NEWS_KEY, value)
        saved = localStorage.getItem(COMMUNITY_NEWS_KEY) === value
    } catch { /* Public links remain available. */ }
    window.dispatchEvent(new Event(CHANGE))
    return saved
}
export const markCommunityNewsShown = () => read() === "new" && write("shown")
export const markCommunityNewsRead = () => write("read")
export const useCommunityNewsState = () => useSyncExternalStore(subscribe, read, () => "read" as const)
