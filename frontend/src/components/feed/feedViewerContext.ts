import { createContext } from "react"

/** The OS supplies a signed-in identity even when Adena alone is connected. */
export interface FeedViewerIdentity {
    connected: boolean
    address: string | undefined
    connect: () => void | Promise<boolean>
    /** The OS login flow can be cancelled after wallet connection; keep drafts editable. */
    queueOnConnect: boolean
}

export const FeedViewerContext = createContext<FeedViewerIdentity | null>(null)
