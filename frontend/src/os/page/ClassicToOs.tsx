/**
 * On a Memba OS build, a classic URL (an old link, a bookmark, a redirect from
 * the retired classic site) opens its Memba OS window instead of the classic
 * page, fragment kept. A page with no window (a callback) or on a
 * network hidden from the selector stays classic (see osUrlForClassic).
 *
 * @module os/page/ClassicToOs
 */
import type { ReactNode } from "react"
import { Navigate, useLocation } from "react-router-dom"
import { ACTIVE_NETWORK_KEY, NETWORK_ECHO_STORAGE_KEY, NETWORK_PREF_STORAGE_KEY } from "../../lib/config"
import { osUrlForClassic } from "./classicRoute"

/** /os URLs carry no network: following a /<network>/… link into Memba OS chooses
 *  that network, or a reload (a player waiting on a Connect 4 reveal) would come
 *  back on another one. Idempotent, so writing it while rendering is safe. */
function rememberNetwork(key: string): void {
    try {
        if (localStorage.getItem(NETWORK_PREF_STORAGE_KEY) !== key) localStorage.setItem(NETWORK_PREF_STORAGE_KEY, key)
        if (localStorage.getItem(NETWORK_ECHO_STORAGE_KEY) !== key) localStorage.setItem(NETWORK_ECHO_STORAGE_KEY, key)
    } catch { /* storage blocked: this page still opens on the link's network */ }
}

export default function ClassicToOs({ children }: { children: ReactNode }) {
    const { pathname, search, hash } = useLocation()
    const to = osUrlForClassic(pathname + search, ACTIVE_NETWORK_KEY)
    if (to) rememberNetwork(ACTIVE_NETWORK_KEY)
    return to ? <Navigate to={to + hash} replace /> : children
}
