import { useCallback, useId, useLayoutEffect, useRef, useState, type Dispatch } from "react"
import type { ArcadeLaunchIntent } from "../../../games/arcade/LaunchContext"
import { appSpec, isArcadePlayWindow, type DeskSize, type OsWindow, type WindowsAction, type WindowSpec } from "../../shell/windows"

interface Pending {
    scope: string
    key: string
    windowId?: string
    launch: ArcadeLaunchIntent
}

/** Transient, ordered delivery. No intent is placed in windows, URLs or saved state. */
export function useArcadeLaunch({ wins, scope, blocked, dispatch: updateWindows, desk }: {
    wins: readonly OsWindow[]
    scope: string
    blocked: boolean
    dispatch: Dispatch<WindowsAction>
    desk: () => DeskSize
}) {
    const prefix = useId()
    const sequence = useRef(0)
    const [pending, setPending] = useState<Pending[]>([])
    const committed = useRef({ wins, scope, blocked })
    useLayoutEffect(() => {
        committed.current = { wins, scope, blocked }
        // Bind a newly opened window before passive game effects can consume it.
        // Missing/retargeted instances and a changed owner never inherit a command.
        // eslint-disable-next-line react-hooks/set-state-in-effect -- reconcile transient commands with committed window lifetimes
        setPending((previous) => {
            let changed = false
            const next = previous.flatMap((p) => {
                const w = wins.find((w) => w.key === p.key && isArcadePlayWindow(w) && (!p.windowId || w.id === p.windowId))
                if (p.scope !== scope || !w) { changed = true; return [] }
                if (!p.windowId) { changed = true; return [{ ...p, windowId: w.id }] }
                return [p]
            })
            return changed ? next : previous
        })
    }, [wins, scope, blocked])

    // Restore can reuse window IDs; cancel before that replacement is committed.
    const dispatch = useCallback((action: WindowsAction) => {
        if (action.type === "restore" || action.type === "closeAll") setPending([])
        updateWindows(action)
    }, [updateWindows])

    const play = useCallback((spec: WindowSpec) => {
        const current = committed.current
        if (current.blocked || current.scope !== scope) return
        dispatch({ type: "open", spec, desk: desk(), play: true })
        // A/C retain their controls until their adapters are ready. Connect 4 is
        // excluded both here and by the reducer's presentation guard.
        if (!isArcadePlayWindow(spec) || spec.target?.kind !== "app" || spec.target.section !== "space-invaders") return
        const launch: ArcadeLaunchIntent = { id: `${prefix}:${++sequence.current}`, game: "space-invaders", mode: "free" }
        const windowId = current.wins.find((w) => w.key === spec.key)?.id
        setPending((previous) => {
            if (previous.some((p) => p.scope === scope && p.key === spec.key && p.windowId === windowId)) return previous
            return [...previous.filter((p) => p.scope === scope && p.key !== spec.key), { scope, key: spec.key, windowId, launch }]
        })
    }, [dispatch, desk, prefix, scope])

    const consume = useCallback((windowId: string, id: string) => {
        setPending((previous) => previous.filter((p) => p.windowId !== windowId || p.launch.id !== id))
    }, [])

    const returnToArcade = useCallback((id: string) => {
        const current = committed.current
        if (current.blocked || current.scope !== scope || !current.wins.some((w) => w.id === id && isArcadePlayWindow(w))) return
        dispatch({ type: "minimise", id })
        dispatch({ type: "open", spec: appSpec("arcade"), desk: desk() })
    }, [dispatch, desk, scope])

    const launchFor = (w: OsWindow): ArcadeLaunchIntent | undefined => blocked || !isArcadePlayWindow(w) ? undefined :
        pending.find((p) => p.scope === scope && p.windowId === w.id && p.key === w.key)?.launch

    return { dispatch, play, consume, launchFor, returnToArcade }
}
