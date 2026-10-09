import { useEffect, useId, useMemo, useState, useSyncExternalStore } from "react"
import type { FreePlayGame } from "../../../lib/arcadeFreePlay"
import { listFreePlaySnapshots, loadFreePlaySnapshot, type FreePlaySavedRuns, type SnapshotStorage } from "../../../games/arcade/freeplay/snapshot"
import "./free-play-board.css"

export interface SavedRunSelection { game: FreePlayGame; clientRunId: string }
export interface YourRunsProps {
    storage: SnapshotStorage
    /** Opens a game's recovery view. Must never create or launch a run. */
    onOpenSavedRun(selection: SavedRunSelection): void
    /** Host subscribes to storage changes, including same-tab saves if available. */
    subscribe?: (refresh: () => void) => () => void
}
const games = ["block-party", "space-invaders", "barricade"] as const
const names: Record<FreePlayGame, string> = { "block-party": "Block Party", "space-invaders": "Space Invaders", barricade: "BARRICADE" }
const PAGE_SIZE = 10

// Cache synchronous, bounded local reads for useSyncExternalStore. Changing
// storage or game creates a new store, immediately discarding the old page.
function historyStore(storage: SnapshotStorage, game: FreePlayGame) {
    let state: { offset: number; page: FreePlaySavedRuns | null } = { offset: 0, page: null }
    const listeners = new Set<() => void>()
    const read = (offset: number) => {
        try { state = { offset, page: listFreePlaySnapshots(storage, { game, offset, limit: PAGE_SIZE }) } }
        catch { state = { offset, page: null } }
        listeners.forEach(listener => listener())
    }
    read(0)
    return {
        getSnapshot: () => state,
        subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
        refresh: () => read(0),
        previous: () => read(Math.max(0, state.offset - PAGE_SIZE)),
        next: () => { if (state.page?.nextOffset !== undefined) read(state.page.nextOffset) },
    }
}

export function YourRuns({ storage, onOpenSavedRun, subscribe }: YourRunsProps) {
    const title = useId()
    const select = useId()
    const [game, setGame] = useState<FreePlayGame>("block-party")
    const store = useMemo(() => historyStore(storage, game), [storage, game])
    const { page, offset } = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
    const [failure, setFailure] = useState<{ store: typeof store; message: string } | null>(null)
    useEffect(() => subscribe?.(store.refresh), [subscribe, store])
    const open = (clientRunId: string) => {
        // A result may disappear or change since the list was rendered.
        try {
            const saved = loadFreePlaySnapshot(storage, clientRunId)
            if (!saved || saved.input.game !== game) throw new Error("missing_saved_run")
        } catch {
            setFailure({ store, message: "This saved result is missing or unreadable. Refresh the list to try again." })
            return
        }
        setFailure(null)
        onOpenSavedRun({ game, clientRunId })
    }
    const refresh = () => { setFailure(null); store.refresh() }
    return <section className="os-cin-panel os-free-board" aria-labelledby={title}>
        <h2 id={title}>Your runs</h2>
        <p className="os-cin-sub">Recent Free play results saved on this device, up to 20 per game. Scores and saved receipts have not been rechecked online.</p>
        <label htmlFor={select}>Game</label>{" "}
        <select id={select} value={game} onChange={event => setGame(event.target.value as FreePlayGame)}>
            {games.map(id => <option key={id} value={id}>{names[id]}</option>)}
        </select>
        {failure?.store === store && <p role="alert">{failure.message}</p>}
        {!page ? <p role="status">Saved results could not be read. Your browser's local storage may be unavailable or damaged.</p>
            : <>
                {page.unavailable > 0 && <p role="status">{page.unavailable} saved result(s) on this page are missing or unreadable.</p>}
                {page.snapshots.length === 0 ? <p role="status">{page.total === 0 ? "No saved Free play results for this game yet." : "No readable results on this page."}</p>
                    : <ul className="os-free-board-entries" aria-label={`${names[game]} saved results`}>
                        {page.snapshots.map(({ input, binding, result }) => <li key={input.clientRunId}>
                            <div className="os-free-board-row"><span>Local score</span><strong>{input.claimedScore.toLocaleString()}</strong></div>
                            <p className="os-cin-sub">Saved locally · not rechecked</p>
                            {result?.receipt && <p className="os-cin-sub">A saved receipt is available; its current status has not been checked.</p>}
                            <details className="os-free-board-proof"><summary>Saved run details</summary><dl>
                                <dt>Run</dt><dd><code>{input.clientRunId}</code></dd>
                                <dt>Rules</dt><dd>{input.rules} · version {input.simVersion}</dd>
                                {binding && <><dt>Saved network</dt><dd>{binding.target.chainId}</dd><dt>Saved realm</dt><dd><code>{binding.target.realm}</code></dd></>}
                            </dl></details>
                            <button type="button" className="os-cin-btn" aria-label={`Open saved ${names[game]} result ${input.clientRunId}`} onClick={() => open(input.clientRunId)}>Open saved result</button>
                        </li>)}
                    </ul>}
            </>}
        <div className="os-free-board-controls">
            <button type="button" className="os-cin-btn" disabled={offset === 0} onClick={store.previous}>Previous results</button>
            <span>Page {offset / PAGE_SIZE + 1}</span>
            <button type="button" className="os-cin-btn" disabled={page?.nextOffset === undefined} onClick={store.next}>Next results</button>
            <button type="button" className="os-cin-link" onClick={refresh}>Refresh saved results</button>
        </div>
    </section>
}
