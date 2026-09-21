import { useEffect, useRef } from 'react'
/** Keyed editors invalidate their old async confirmation when context changes. */
export function useCurrentRequest() {
    const current = useRef(false)
    useEffect(() => {
        current.current = true
        return () => { current.current = false }
    }, [])
    return {
        isCurrent: () => current.current,
        assertCurrent: () => { if (!current.current) throw new Error('Wallet or DAO changed. Review the transaction again before signing.') },
    }
}
