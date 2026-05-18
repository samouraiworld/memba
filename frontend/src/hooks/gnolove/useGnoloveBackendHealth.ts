/**
 * useGnoloveBackendHealth — lazy `/teams` HEAD probe with auto-degrade.
 *
 * Plan R-4 mitigation: if the gnolove backend goes down, the team hub
 * would otherwise render six red error cards. This hook lets the page
 * detect a backend that's down and swap in the legacy stub instead.
 *
 * Probe semantics:
 *   - First check on mount, then every PROBE_INTERVAL_MS.
 *   - A check is "failing" if the HEAD request rejects OR returns
 *     a 5xx / 0 status. 4xx counts as "up" (the server is responding).
 *   - Backend is considered DOWN after FAIL_THRESHOLD consecutive
 *     failures inside FAIL_WINDOW_MS. The plan's "2× in 30s" rule.
 *   - After recovery, one successful probe clears the down state.
 *
 * @module hooks/gnolove/useGnoloveBackendHealth
 */

import { useEffect, useRef, useState } from "react"
import { GNOLOVE_API_URL } from "../../lib/config"

const PROBE_INTERVAL_MS = 15_000
const FAIL_THRESHOLD = 2
const FAIL_WINDOW_MS = 30_000
const PROBE_TIMEOUT_MS = 5_000

export type BackendHealth = "unknown" | "up" | "down"

interface UseGnoloveBackendHealthOptions {
    /** Set to false to skip probing — useful in tests. */
    enabled?: boolean
    /** Override the URL to probe. Defaults to `${GNOLOVE_API_URL}/teams`. */
    probeUrl?: string
}

export function useGnoloveBackendHealth(opts: UseGnoloveBackendHealthOptions = {}): BackendHealth {
    const { enabled = true, probeUrl = `${GNOLOVE_API_URL}/teams` } = opts
    const [status, setStatus] = useState<BackendHealth>("unknown")
    const failuresRef = useRef<number[]>([])

    useEffect(() => {
        if (!enabled) return
        let cancelled = false

        async function probe() {
            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
            let ok = false
            try {
                const res = await fetch(probeUrl, { method: "HEAD", signal: controller.signal })
                ok = res.status < 500 && res.status !== 0
            } catch {
                ok = false
            } finally {
                clearTimeout(timeout)
            }
            if (cancelled) return

            const now = Date.now()
            if (ok) {
                failuresRef.current = []
                setStatus("up")
            } else {
                // Drop failures older than the window before counting.
                failuresRef.current = [
                    ...failuresRef.current.filter(t => now - t < FAIL_WINDOW_MS),
                    now,
                ]
                if (failuresRef.current.length >= FAIL_THRESHOLD) {
                    setStatus("down")
                }
            }
        }

        probe()
        const interval = setInterval(probe, PROBE_INTERVAL_MS)
        return () => {
            cancelled = true
            clearInterval(interval)
        }
    }, [enabled, probeUrl])

    return status
}
