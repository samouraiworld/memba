/**
 * Chain-style seconds, refreshed every 30 s: what a window compares chain
 * times against (deadlines, pause ends, "ends in").
 *
 * @module os/shell/useNowSeconds
 */
import { useEffect, useState } from "react"

export function useNowSeconds(): number {
    const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
    useEffect(() => {
        const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000)
        return () => clearInterval(id)
    }, [])
    return now
}
