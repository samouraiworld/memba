/**
 * useCollectionAdmin — shared hook for NFT Creator Studio admin pages.
 *
 * Loads a single collection by id, derives `isAdmin` (me === col.admin),
 * and exposes a `run(msg, memo)` transaction helper that wraps
 * doContractBroadcast with friendly error translation and auto-reload.
 *
 * ROBUSTNESS: a cancelled-flag guard prevents setState-after-unmount;
 * a failed fetchCollectionDetail always clears `loading` and sets `error`.
 *
 * @module pages/studio/useCollectionAdmin
 */

import { useState, useEffect, useCallback, useRef } from "react"
import { useOutletContext } from "react-router-dom"
import { fetchCollectionDetail } from "../../lib/launchpadReads"
import type { CollectionDetail as CollectionInfo } from "../../lib/launchpad"
import { doContractBroadcast, type AminoMsg } from "../../lib/grc20"
import { friendlyError } from "../../lib/errorMessages"
import type { LayoutContext } from "../../types/layout"

export interface CollectionAdminResult {
    col: CollectionInfo | null
    isAdmin: boolean
    me: string
    loading: boolean
    notice: string | null
    error: string | null
    run: (msg: AminoMsg, memo: string) => Promise<void>
    reload: () => void
}

export function useCollectionAdmin(id: string): CollectionAdminResult {
    const { adena } = useOutletContext<LayoutContext>()
    const me = adena?.address || ""

    const [col, setCol] = useState<CollectionInfo | null>(null)
    const [loading, setLoading] = useState(true)
    const [notice, setNotice] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    // Increment to trigger a re-fetch without changing `id`
    const [fetchEpoch, setFetchEpoch] = useState(0)

    const cancelledRef = useRef(false)

    useEffect(() => {
        cancelledRef.current = false
        setLoading(true)

        fetchCollectionDetail(id)
            .then((detail) => {
                if (cancelledRef.current) return
                setCol(detail)
                setError(null)
            })
            .catch((e: unknown) => {
                if (cancelledRef.current) return
                setCol(null)
                setError(friendlyError(e))
            })
            .finally(() => {
                if (!cancelledRef.current) {
                    setLoading(false)
                }
            })

        return () => {
            cancelledRef.current = true
        }
    }, [id, fetchEpoch])

    const reload = useCallback(() => {
        setFetchEpoch((n) => n + 1)
    }, [])

    const run = useCallback(
        async (msg: AminoMsg, memo: string) => {
            setError(null)
            setNotice(null)
            try {
                await doContractBroadcast([msg], memo)
                setNotice(`${memo} ✓`)
                reload()
            } catch (e) {
                setError(friendlyError(e))
            }
        },
        [reload],
    )

    const isAdmin = me !== "" && col?.admin === me

    return { col, isAdmin, me, loading, notice, error, run, reload }
}
