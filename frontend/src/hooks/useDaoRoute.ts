import { useParams } from "react-router-dom"
import { parseDaoSplat, encodeSlug } from "../lib/daoSlug"

/**
 * Hook for DAO pages rendered under the dao/* splat route.
 * Extracts the realm path and sub-route parts from the URL.
 *
 * Also provides the encoded slug for navigation (now just the realm path itself).
 */
export function useDaoRoute() {
    const { "*": splat = "" } = useParams()
    const { realmPath, subRoute } = parseDaoSplat(splat)
    const encodedSlug = encodeSlug(realmPath)

    // Extract sub-route params (e.g., proposal ID, channel name, plugin ID)
    const subParts = subRoute.split("/").filter(Boolean)
    const proposalId = subParts[0] === "proposal" ? subParts[1] : undefined
    const channelName = subParts[0] === "channels" ? subParts[1] : undefined
    const pluginId = subParts[0] === "plugin" ? subParts[1] : undefined

    return { realmPath, encodedSlug, proposalId, channelName, pluginId }
}
