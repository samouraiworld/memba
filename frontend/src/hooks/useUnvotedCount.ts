/**
 * useUnvotedCount — returns the number of unvoted proposals across saved DAOs.
 *
 * Powers the notification dot on the 🏛️ DAO nav link.
 * Scans max 5 saved DAOs × 5 active proposals with 2-minute sessionStorage cache.
 */
import { useState, useEffect } from "react"
import { scanUnvotedProposals } from "../lib/dao/voteScanner"

export function useUnvotedCount(address: string | null) {
    const [unvotedCount, setUnvotedCount] = useState(0)
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        if (!address) {
            setUnvotedCount(0) // eslint-disable-line react-hooks/set-state-in-effect
            return
        }

        let cancelled = false
        setLoading(true)

        scanUnvotedProposals(address)
            .then((count) => {
                if (!cancelled) setUnvotedCount(count)
            })
            .catch(() => {
                if (!cancelled) setUnvotedCount(0)
            })
            .finally(() => {
                if (!cancelled) setLoading(false)
            })

        return () => { cancelled = true }
    }, [address])

    return { unvotedCount, loading }
}
