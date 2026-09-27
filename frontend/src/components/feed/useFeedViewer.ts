import { useContext } from "react"
import { useAdena } from "../../hooks/useAdena"
import { FeedViewerContext, type FeedViewerIdentity } from "./feedViewerContext"

export function useFeedViewer(): FeedViewerIdentity {
    const wallet = useAdena()
    const os = useContext(FeedViewerContext)
    return os ?? { connected: wallet.connected, address: wallet.address, connect: wallet.connect, queueOnConnect: true }
}
