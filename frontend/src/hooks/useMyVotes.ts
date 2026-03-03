/**
 * useMyVotes — returns cross-DAO vote history for the connected wallet.
 *
 * Powers the enhanced "My Votes" section on the profile page.
 * Scans saved DAOs for proposals the user has voted on.
 * Cached in sessionStorage with 5-minute TTL.
 */
import { useState, useEffect } from "react"
import { scanMyVotes, type MyVoteEntry } from "../lib/dao/voteScanner"

export type { MyVoteEntry } from "../lib/dao/voteScanner"

export function useMyVotes(address: string | null) {
    const [votes, setVotes] = useState<MyVoteEntry[]>([])
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        if (!address) {
            setVotes([]) // eslint-disable-line react-hooks/set-state-in-effect
            return
        }

        let cancelled = false
        setLoading(true)

        scanMyVotes(address)
            .then((result) => {
                if (!cancelled) setVotes(result)
            })
            .catch(() => {
                if (!cancelled) setVotes([])
            })
            .finally(() => {
                if (!cancelled) setLoading(false)
            })

        return () => { cancelled = true }
    }, [address])

    return { votes, loading }
}
