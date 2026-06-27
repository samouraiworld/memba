/**
 * useNow — a `now` timestamp (ms) that advances on a fixed interval, so relative
 * times ("just now" → "1m" → "2m") and "updated N ago" labels stay alive between
 * data refetches without a per-second re-render. Pauses nothing on its own; the
 * interval is cheap (a single setState). Pass the resulting `now` into the pure
 * `relativeActivityTime(iso, now)` so the value is deterministic + testable.
 *
 * @module hooks/home/useNow
 */
import { useState, useEffect } from "react"

export function useNow(intervalMs = 15_000): number {
    const [now, setNow] = useState(() => Date.now())
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), intervalMs)
        return () => clearInterval(id)
    }, [intervalMs])
    return now
}
