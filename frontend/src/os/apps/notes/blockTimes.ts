import { useEffect, useState } from 'react'
import { formatRelativeTime } from '../../../lib/blockTime'

/** Block times never change: one read per chain and height for the page's lifetime. */
const known = new Map<string, number>()
type Reader = { chainId?: string; blockTimeMs?(height: string): Promise<number | null> }
type Times = { chain: string; at: Readonly<Record<string, number>>; now: number }

/**
 * "10 minutes ago" for chain heights, best effort: a client that cannot read block times,
 * or a height not read yet, shows nothing rather than a guess.
 */
export function useBlockTimes(client: Reader, heights: readonly string[]): (height: string) => string {
    const chain = client.chainId ?? ''
    const wanted = [...new Set(heights)].sort().join(',')
    const [times, setTimes] = useState<Times>({ chain, at: {}, now: 0 })
    useEffect(() => {
        const read = client.blockTimeMs?.bind(client)
        if (!read || !wanted) return
        let alive = true
        const missing = wanted.split(',').filter(height => !known.has(`${chain}:${height}`))
        const publish = () => {
            const at: Record<string, number> = {}
            for (const height of wanted.split(',')) { const ms = known.get(`${chain}:${height}`); if (ms !== undefined) at[height] = ms }
            setTimes({ chain, at, now: Date.now() })
        }
        void Promise.resolve().then(async () => {
            if (!missing.length) { if (alive) publish(); return }
            // A few at a time: a page of history must not burst the node.
            for (let i = 0; i < missing.length && alive; i += 4) {
                await Promise.all(missing.slice(i, i + 4).map(async height => {
                    try { const ms = await read(height); if (ms !== null) known.set(`${chain}:${height}`, ms) } catch { /* shown without a time */ }
                }))
                if (alive) publish()
            }
        })
        return () => { alive = false }
    }, [client, chain, wanted])
    return height => {
        const ms = times.chain === chain ? times.at[height] : undefined
        return ms === undefined ? '' : formatRelativeTime(new Date(ms), times.now)
    }
}
