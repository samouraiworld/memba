import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_NETWORK } from '../../lib/config'
import { NOTE_ID } from '../../lib/notes/config'
import { check } from '../../lib/notes/chain/schema'
import { createFeaturedNoteStorage } from '../../lib/notes/featuredNoteStorage'
import { FEATURED_MAX_CHARS, featuredNoteLabel, planFeaturedNoteSeeds, removeFeaturedDeskItem, type FeaturedDesk, type FeaturedNoteRelease } from '../../lib/notes/featuredNoteSeed'
import { GRID, cleanUp, deskKey, guestDesk, itemTarget, moveItem, sameItem, type DeskItem } from './desk'

type Pin = Pick<DeskItem, 'ty' | 'ref'>
export type FeaturedDeskOptions = { chainId: string; gno: boolean; adopt: boolean; releases: readonly FeaturedNoteRelease[]; blocked?: boolean }
type Adapter = ReturnType<typeof createFeaturedNoteStorage>
type Active = { alive: boolean; generation: object; adapter: Adapter; scope: FeaturedDesk['partition']; releases: readonly FeaturedNoteRelease[] }
const CHANGED = 'memba-featured-desk-changed'
const RESET = 'memba_os_ui_reset_revision'
const ERROR = 'The desktop could not be saved safely. Existing browser data was preserved. Reload or reset local UI data explicitly to retry.'
const EMPTY: DeskItem[] = []
const NO_RELEASES: readonly FeaturedNoteRelease[] = []
const rules = { cols: GRID.cols, rows: GRID.rows, validItem: (item: Pin) => (item.ty === 'note' && NOTE_ID.test(item.ref)) || (item.ty === 'app' && item.ref === 'notes') || itemTarget(item) !== null }

const LEGACY_TYPES: readonly string[] = ['app', 'dao', 'prop', 'msig', 'note']

/**
 * Adopts the desktop the legacy loader actually displayed. Historical tidy used five rows and could place valid pins
 * outside the current grid; old builds also kept entries that `loadDesk` silently skipped (removed apps, unparsable refs).
 * Unreadable or non-array bytes still fail closed: they are preserved for an explicit reset instead of adopted as empty.
 */
function normalizedLegacy(raw: string | null): string | null {
    if (raw === null) return null
    check(raw.length <= FEATURED_MAX_CHARS)
    const value: unknown = JSON.parse(raw)
    check(Array.isArray(value))
    const items = value.flatMap((rawItem: unknown) => {
        if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) return []
        const { ty, ref, c, r } = rawItem as Record<string, unknown>
        if (typeof ty !== 'string' || !LEGACY_TYPES.includes(ty) || typeof ref !== 'string' || ref.length === 0 || ref.length > 256) return []
        const pin = { ty, ref } as Pin
        // Same identity rule as v3, so hidden note pins survive while stale targets are skipped like `loadDesk` did.
        if (!rules.validItem(pin)) return []
        return [{ ...pin, c: Number.isInteger(c) ? c as number : -1, r: Number.isInteger(r) ? r as number : -1 }]
    })
    // Overflow of displayable pins still refuses migration: old bytes are kept intact rather than truncated.
    check(items.length <= GRID.cols * GRID.rows)
    const cells = new Set<string>(), misplaced: number[] = []
    items.forEach((item, i) => {
        const cell = `${item.c}:${item.r}`
        if (item.c < 0 || item.c >= GRID.cols || item.r < 0 || item.r >= GRID.rows || cells.has(cell)) misplaced.push(i)
        else cells.add(cell)
    })
    // Keep every valid position; move only misplaced pins to the first free cells, column by column.
    let next = 0
    for (const i of misplaced) {
        while (cells.has(`${Math.floor(next / GRID.rows)}:${next % GRID.rows}`)) next++
        items[i] = { ...items[i], c: Math.floor(next / GRID.rows), r: next % GRID.rows }
        cells.add(`${items[i].c}:${items[i].r}`)
    }
    // Old bytes are never rewritten; strict adapter validation still checks every adopted identity.
    return JSON.stringify(items)
}

/** A selected v3 authority never falls back to a legacy writer in this scope. */
export function useFeaturedDesk(owner: string | null | undefined, networkKey: string, options?: FeaturedDeskOptions) {
    const chainId = options?.chainId ?? '', eligible = !!options?.gno && owner !== undefined
    const adopt = !!options?.adopt, blocked = !!options?.blocked
    const scopeKey = JSON.stringify([owner, networkKey, chainId, eligible])
    const storageKey = eligible ? `memba_os_desk:v3:${chainId}:${owner ?? 'guest'}` : null
    const previousKey = eligible ? `memba_os_desk:v2:${chainId}:${owner ?? 'guest'}` : null
    const present = useCallback(() => {
        if (!storageKey || !previousKey) return false
        try { return localStorage.getItem(storageKey) !== null || localStorage.getItem(previousKey) !== null }
        catch { return true } // Access failure must not enter the destructive legacy migration.
    }, [storageKey, previousKey])
    const [authority, setAuthority] = useState({ scopeKey, owned: false })
    const enabled = eligible && (adopt || present() || (authority.scopeKey === scopeKey && authority.owned))
    if (authority.scopeKey !== scopeKey || authority.owned !== enabled) setAuthority({ scopeKey, owned: enabled })
    const [, reselect] = useState(0)
    const [epoch, setEpoch] = useState(0)
    const serialized = JSON.stringify(options?.releases ?? NO_RELEASES)
    const releases = useMemo<readonly FeaturedNoteRelease[]>(() => JSON.parse(serialized), [serialized])
    const key = JSON.stringify([scopeKey, enabled, blocked, serialized, epoch])
    const generation = useMemo(() => ({ key }), [key])
    const active = useRef<Active | null>(null)
    const [state, setState] = useState<{ key: string; desk: FeaturedDesk | null; error: string | null }>({ key, desk: null, error: null })
    const current = useCallback((a: Active) => a.alive && active.current === a, [])
    const publish = useCallback((a: Active, error: string | null = null) => {
        if (!current(a)) return
        try {
            const desk = a.adapter.peek()
            if (current(a)) setState({ key: a.generation === generation ? key : '', desk, error })
        } catch { if (current(a)) setState({ key, desk: null, error: ERROR }) }
    }, [current, generation, key])
    const saved = useCallback((a: Active) => {
        publish(a)
        if (current(a)) window.dispatchEvent(new CustomEvent(CHANGED, { detail: a.adapter.key }))
    }, [current, publish])
    const resetFromStorage = useCallback(() => {
        const a = active.current
        if (a) { a.alive = false; active.current = null }
        setEpoch(value => value + 1)
    }, [setEpoch])
    useLayoutEffect(() => {
        const changed = (event: Event) => {
            if (event instanceof StorageEvent && (event.key === RESET || event.key === null)) { resetFromStorage(); return }
            const target = event instanceof StorageEvent ? event.key : (event as CustomEvent).detail
            if (target !== storageKey && target !== previousKey) return
            reselect(value => value + 1)
            const a = active.current
            if (a) publish(a)
        }
        window.addEventListener('storage', changed); window.addEventListener(CHANGED, changed)
        return () => { window.removeEventListener('storage', changed); window.removeEventListener(CHANGED, changed) }
    }, [storageKey, previousKey, publish, resetFromStorage])
    useLayoutEffect(() => {
        if (!enabled || blocked || owner === undefined) return
        let a: Active | null = null, cancelled = false
        try {
            const storage = window.localStorage, scope = { chainId, wallet: owner }
            const readLegacy = () => {
                const scoped = storage.getItem(deskKey(owner, networkKey))
                if (scoped !== null) return normalizedLegacy(scoped)
                // Main's historical contract maps this exact wallet OR known guest to DEFAULT_NETWORK.
                if (networkKey === DEFAULT_NETWORK && storage.getItem(`memba_os_desk:migrated:${owner ?? 'guest'}`) === null) {
                    return normalizedLegacy(storage.getItem(`memba_os_desk:${owner ?? 'guest'}`))
                }
                return null
            }
            const adapter = createFeaturedNoteStorage({ scope, rules, storage, locks: navigator.locks ?? null, readLegacy,
                initial: owner === null ? guestDesk(networkKey) : [], getResetToken: () => storage.getItem(RESET),
                isCurrent: () => a !== null && current(a) })
            a = { alive: true, generation, adapter, scope, releases }; active.current = a
            const live = a
            void adapter.mutate(latest => planFeaturedNoteSeeds(latest, scope, rules, releases).desk)
                .then(() => saved(live), () => publish(live, ERROR))
            return () => { live.alive = false; if (active.current === live) active.current = null }
        } catch {
            if (a) a.alive = false
            active.current = null
            queueMicrotask(() => { if (!cancelled) setState({ key, desk: null, error: ERROR }) })
            return () => { cancelled = true }
        }
    }, [enabled, blocked, owner, chainId, networkKey, generation, releases, key, current, saved, publish])
    const update = useCallback((change: (desk: FeaturedDesk, a: Active) => FeaturedDesk) => {
        const a = active.current
        if (!a || a.generation !== generation || !current(a)) return
        void a.adapter.mutate(latest => {
            if (!current(a)) throw new Error('Desktop session changed')
            return planFeaturedNoteSeeds(change(latest, a), a.scope, rules, a.releases).desk
        }).then(() => saved(a), () => publish(a, ERROR))
    }, [generation, current, saved, publish])
    const desk = state.key === key && enabled && !blocked ? state.desk : null
    const items = useMemo(() => desk ? desk.items.filter(item => itemTarget(item) !== null) : EMPTY, [desk])
    const noteLabels = useMemo(() => {
        const labels: Record<string, string> = {}
        if (desk) for (const releaseKey of ['sushi-v1', 'whitepaper-v1'] as const) {
            const entry = desk.releases[releaseKey]
            if (entry.status === 'seeded') labels[entry.noteId] = featuredNoteLabel(releaseKey)
        }
        return labels
    }, [desk])
    return {
        enabled, items, noteLabels, scopeKey: key, error: state.key === key && enabled ? state.error : null,
        // Check synchronously too: a tab can publish v3 before its storage event is delivered here.
        canUseLegacy: useCallback(() => {
            if (enabled || blocked) return false
            if (!present()) return true
            reselect(value => value + 1); return false
        }, [enabled, blocked, present, reselect]),
        resetFromStorage,
        isPinned: (item: Pin) => items.some(value => sameItem(value, item)),
        pin: useCallback((item: Pin) => {
            const target = { ty: item.ty, ref: item.ref }
            update(latest => {
                if (!itemTarget(target)) throw new Error('Invalid desktop target')
                if (latest.items.some(value => sameItem(value, target))) return latest
                if (latest.items.length >= GRID.cols * GRID.rows) throw new Error('Desktop is full')
                for (let c = 0; c < GRID.cols; c++) for (let r = 0; r < GRID.rows; r++) {
                    if (latest.items.some(value => value.c === c && value.r === r)) continue
                    latest.items.push({ ...target, c, r }); return latest
                }
                throw new Error('Desktop is full')
            })
        }, [update]),
        unpin: useCallback((index: number) => {
            const captured = items[index]; if (!captured) return
            const target = { ty: captured.ty, ref: captured.ref }
            update((latest, a) => {
                const found = latest.items.findIndex(value => sameItem(value, target))
                return found < 0 ? latest : removeFeaturedDeskItem(latest, a.scope, rules, found)
            })
        }, [items, update]),
        move: useCallback((index: number, c: number, r: number) => {
            const captured = items[index]; if (!captured || !Number.isInteger(c) || !Number.isInteger(r)) return
            const target = { ty: captured.ty, ref: captured.ref }
            update(latest => {
                const found = latest.items.findIndex(value => sameItem(value, target))
                if (found >= 0) latest.items = moveItem(latest.items, found, c, r)
                return latest
            })
        }, [items, update]),
        tidy: useCallback(() => update(latest => ({ ...latest, items: cleanUp(latest.items, GRID.rows) })), [update]),
    }
}
