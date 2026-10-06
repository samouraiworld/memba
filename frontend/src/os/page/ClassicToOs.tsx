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
import { ACTIVE_NETWORK_KEY } from "../../lib/config"
import { osUrlForClassic } from "./classicRoute"

export default function ClassicToOs({ children }: { children: ReactNode }) {
    const { pathname, search, hash } = useLocation()
    const to = osUrlForClassic(pathname + search, ACTIVE_NETWORK_KEY)
    return to ? <Navigate to={to + hash} replace /> : children
}
