import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react"
import { addItem, cleanUp, loadDesk, moveItem, removeItem, saveDesk, sameItem, type DeskItem, type DeskItemType } from "./desk"
import { useFeaturedDesk, type FeaturedDeskOptions } from "./useFeaturedDesk"

const NO_LABELS: Readonly<Record<string, string>> = {}

/** Unknown/resuming owner never initialises either a guest desk or a writer. */
export function useDesk(owner: string | null | undefined, networkKey: string, options?: FeaturedDeskOptions) {
    const featured = useFeaturedDesk(owner, networkKey, options)
    const legacy = useLegacyDesk(featured.enabled || options?.blocked ? undefined : owner, networkKey, featured.canUseLegacy, featured.scopeKey)
    const { resetFromStorage: resetFeatured, enabled } = featured
    const { resetFromStorage: resetLegacy } = legacy
    const resetFromStorage = useCallback(() => {
        resetFeatured()
        if (!enabled) resetLegacy()
    }, [resetFeatured, enabled, resetLegacy])
    return { ...(featured.enabled ? featured : { ...legacy, error: null, noteLabels: NO_LABELS, scopeKey: featured.scopeKey }), resetFromStorage }
}

function useLegacyDesk(owner: string | null | undefined, networkKey: string, allowed: () => boolean, leaseKey: string) {
    const generation = useMemo(() => ({ owner, networkKey, allowed, leaseKey }), [owner, networkKey, allowed, leaseKey])
    const active = useRef<object | null>(null)
    useLayoutEffect(() => { active.current = generation; return () => { active.current = null } }, [generation])
    const [state, setState] = useState(() => ({ owner, networkKey, items: owner === undefined ? [] : loadDesk(owner, networkKey) }))
    if (state.owner !== owner || state.networkKey !== networkKey) {
        setState({ owner, networkKey, items: owner === undefined ? [] : loadDesk(owner, networkKey) })
    }
    const update = useCallback((fn: (items: DeskItem[]) => DeskItem[]) => {
        if (active.current !== generation || owner === undefined || !allowed()) return
        setState(s => {
            if (active.current !== generation || s.owner !== owner || s.networkKey !== networkKey || !allowed()) return s
            const items = fn(s.items)
            saveDesk(owner, items, networkKey)
            return { ...s, items }
        })
    }, [generation, owner, networkKey, allowed])
    return {
        items: state.owner === owner && state.networkKey === networkKey ? state.items : [],
        resetFromStorage: useCallback(() => {
            if (active.current !== generation || !allowed()) return
            setState(s => ({ ...s, items: owner === undefined ? [] : loadDesk(owner, networkKey) }))
        }, [generation, owner, networkKey, allowed]),
        isPinned: (item: { ty: DeskItemType; ref: string }) => state.items.some(i => sameItem(i, item)),
        pin: useCallback((item: { ty: DeskItemType; ref: string }) => update(items => addItem(items, item)), [update]),
        unpin: useCallback((index: number) => update(items => removeItem(items, index)), [update]),
        move: useCallback((index: number, c: number, r: number) => update(items => moveItem(items, index, c, r)), [update]),
        tidy: useCallback(() => update(items => cleanUp(items)), [update]),
    }
}
