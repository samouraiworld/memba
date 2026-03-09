/**
 * useScrollToTop — Smooth-scroll viewport to top when trigger transitions to true.
 *
 * Used by modal-opening components: DAORooms, DeployPluginModal, DeploymentPipeline.
 *
 * @module hooks/useScrollToTop
 */

import { useEffect, useRef } from "react"

export function useScrollToTop(trigger: boolean) {
    const prevRef = useRef(trigger)

    useEffect(() => {
        // Only scroll when trigger transitions from false → true
        if (trigger && !prevRef.current) {
            window.scrollTo({ top: 0, behavior: "smooth" })
        }
        prevRef.current = trigger
    }, [trigger])
}
