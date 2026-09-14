import { NETWORKS, PRO_UI_ENABLED } from "./config"

/** Exact overview route only: profile, hacker, and unrelated routes stay legacy. */
export function isProValidatorsRoute(pathname: string, enabled = PRO_UI_ENABLED): boolean {
    if (!enabled) return false
    const match = /^\/([^/]+)\/validators\/?$/.exec(pathname)
    return !!match && Object.hasOwn(NETWORKS, match[1])
}
