import { useCallback, useState } from "react"
import { addItem, cleanUp, loadDesk, moveItem, removeItem, saveDesk, sameItem, type DeskItem, type DeskItemType } from "./desk"

/**
 * The desktop items of whoever is using this browser: a wallet's own desk, or
 * the guest desk. `owner` undefined means "not known yet" (a session is still
 * resuming): no items are shown rather than flashing the guest desk.
 */
export function useDesk(owner: string | null | undefined) {
    const [state, setState] = useState(() => ({ owner, items: owner === undefined ? [] : loadDesk(owner) }))
    // Another owner (sign-in, sign-out): load their desk. Adjusting state while
    // rendering is React's pattern for state derived from a changing prop.
    if (state.owner !== owner) setState({ owner, items: owner === undefined ? [] : loadDesk(owner) })

    const update = useCallback((fn: (items: DeskItem[]) => DeskItem[]) => {
        setState((s) => {
            if (s.owner === undefined) return s
            const items = fn(s.items)
            saveDesk(s.owner, items)
            return { ...s, items }
        })
    }, [])

    return {
        items: state.owner === owner ? state.items : [],
        isPinned: (item: { ty: DeskItemType; ref: string }) => state.items.some((i) => sameItem(i, item)),
        pin: useCallback((item: { ty: DeskItemType; ref: string }) => update((items) => addItem(items, item)), [update]),
        unpin: useCallback((index: number) => update((items) => removeItem(items, index)), [update]),
        move: useCallback((index: number, c: number, r: number) => update((items) => moveItem(items, index, c, r)), [update]),
        tidy: useCallback(() => update((items) => cleanUp(items)), [update]),
    }
}
