import { useLayoutEffect, useRef, useState } from "react"
import { FreePlayResult } from "../../../games/arcade/freeplay/FreePlayResult"
import type { FreePlayGameRuntime } from "../../../games/arcade/freeplay/FreePlayRuntimeContext"
import { createFreePlaySession, type FreePlaySession } from "../../../games/arcade/freeplay/session"
import { loadFreePlaySnapshot, type FreePlaySnapshot } from "../../../games/arcade/freeplay/snapshot"
import type { SavedRunSelection } from "./YourRuns"

interface Props extends SavedRunSelection { runtime: FreePlayGameRuntime; onClose(): void }
interface View { runtime: FreePlayGameRuntime; game: Props["game"]; id: string; snapshot?: FreePlaySnapshot; session?: FreePlaySession }

/** Independent completed-result consumer: never mounts or retargets an engine. */
export function SavedRunPanel({ game, clientRunId, runtime, onClose }: Props) {
    const heading = useRef<HTMLHeadingElement>(null)
    const [view, setView] = useState<View | null>(null)
    const current = view?.runtime === runtime && view.game === game && view.id === clientRunId ? view : null
    useLayoutEffect(() => {
        const next: View = { runtime, game, id: clientRunId }
        try {
            const snapshot = loadFreePlaySnapshot(runtime.storage, clientRunId)
            if (snapshot?.input.game === game) {
                next.snapshot = snapshot
                if (runtime.client) next.session = createFreePlaySession({ snapshot, client: runtime.client, storage: runtime.storage })
            }
        } catch { /* Keep any readable local result when session persistence fails. */ }
        // The controller owns subscriptions; construction and cleanup must happen after commit.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setView(next)
        heading.current?.focus({ preventScroll: true })
        return () => next.session?.dispose()
    }, [runtime, game, clientRunId])
    return <section className="os-cin-panel os-free-board" aria-label="Saved Free play result">
        <h2 ref={heading} tabIndex={-1}>Saved result</h2>
        {!current ? <p role="status">Opening saved result…</p> : current.session ? <FreePlayResult session={current.session} />
            : current.snapshot ? <>
                <p>Local score: {current.snapshot.input.claimedScore.toLocaleString()}</p>
                <p role="status">Saved locally · not rechecked. Online verification is unavailable; your result is kept.</p>
            </> : <p role="alert">This saved result is missing or unreadable. No new game has started.</p>}
        {current?.snapshot && runtime.connect && <button type="button" className="os-cin-btn" onClick={() => { void runtime.connect?.() }}>Connect account</button>}
        <button type="button" className="os-cin-btn" onClick={onClose}>Back to saved results</button>
    </section>
}
