import { NETWORKS, PRO_GOVERNANCE_ENABLED } from "./config"
import { parseDaoSplat } from "./daoSlug"

/** Presentation only. Creation, treasury, membership and extension flows stay legacy. */
export function isProGovernanceRoute(pathname: string, enabled = PRO_GOVERNANCE_ENABLED): boolean {
    if (!enabled) return false
    const match = /^\/([^/]+)\/dao\/(.+?)\/?$/.exec(pathname)
    if (!match || !Object.hasOwn(NETWORKS, match[1]) || match[2].includes("~")) return false
    const { realmPath, subRoute } = parseDaoSplat(match[2])
    return !!realmPath && (subRoute === "" || /^proposal\/\d+$/.test(subRoute))
}
