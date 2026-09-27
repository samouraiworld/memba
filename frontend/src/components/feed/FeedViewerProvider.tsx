import type { ReactNode } from "react"
import { FeedViewerContext, type FeedViewerIdentity } from "./feedViewerContext"

export function FeedViewerProvider({ value, children }: { value: FeedViewerIdentity; children: ReactNode }) {
    return <FeedViewerContext.Provider value={value}>{children}</FeedViewerContext.Provider>
}
