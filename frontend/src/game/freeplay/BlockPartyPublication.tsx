import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { FreePlayClient } from '../../lib/arcadeFreePlay'
import { FreePlayResult } from '../../games/arcade/freeplay/FreePlayResult'
import { useFreePlayResult } from '../../games/arcade/freeplay/useFreePlayResult'
import { listFreePlaySnapshots, type FreePlaySavedRuns, type FreePlaySnapshot, type SnapshotStorage } from '../../games/arcade/freeplay/snapshot'
import type { FreePlaySession } from '../../games/arcade/freeplay/session'
import { createBlockPartyPublication } from './publication'
import { blockPartyFreePlaySnapshot, type CompletedPracticeRound } from './round'

function ResultExport({ snapshot }: { snapshot: FreePlaySnapshot }) {
    return <details><summary>Export this result</summary>
        <p>Keep a copy of this result to recover it later.</p>
        <textarea aria-label="Block Party result export" readOnly rows={8} value={JSON.stringify(snapshot, null, 2)} />
    </details>
}
function ActiveResult({ session }: { session: FreePlaySession }) {
    const { snapshot } = useFreePlayResult(session)
    return <><FreePlayResult session={session} /><ResultExport snapshot={snapshot} /></>
}

/** Only explicit buttons in FreePlayResult call the network. */
export function BlockPartyPublication({ snapshot, storage, client }: { snapshot: FreePlaySnapshot; storage: SnapshotStorage; client?: FreePlayClient }) {
    const controller = useMemo(() => createBlockPartyPublication({ snapshot, storage, client }), [snapshot, storage, client])
    const view = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
    useEffect(() => { controller.start(); return () => controller.dispose() }, [controller])
    if (view.session) return <ActiveResult session={view.session} />
    return <section aria-label="Keep this Block Party result">
        {view.storageError ? <p role="alert">Local storage is unavailable or this saved result conflicts with another run. Your game is complete; keep an export before leaving.</p>
            : view.ready ? <p>Result saved locally. Onchain publication is currently unavailable.</p> : <p>Keeping your result…</p>}
        <ResultExport snapshot={view.snapshot} />
    </section>
}

export function BlockPartyCompletedRound({ round, storage, client }: { round: CompletedPracticeRound; storage: SnapshotStorage; client?: FreePlayClient }) {
    const { roundId, roundMode, roundSeed, roundModifier, actionLog, score, roundOver } = round
    const snapshot = useMemo(() => blockPartyFreePlaySnapshot({ roundId, roundMode, roundSeed, roundModifier, actionLog, score, roundOver }), [roundId, roundMode, roundSeed, roundModifier, actionLog, score, roundOver])
    if (!snapshot) return <p>This round remains available locally, but cannot be certified with the current rules.</p>
    return <BlockPartyPublication snapshot={snapshot} storage={storage} client={client} />
}

/** Common index only: opening/reopening does not allocate a run or read the API. */
export function BlockPartySavedRuns({ storage, client }: { storage: SnapshotStorage; client?: FreePlayClient }) {
    const [page, setPage] = useState<FreePlaySavedRuns | null>(null)
    const [selected, setSelected] = useState<FreePlaySnapshot | null>(null)
    const [error, setError] = useState(false)
    const load = (offset = 0) => {
        try { setPage(listFreePlaySnapshots(storage, { game: 'block-party', offset })); setError(false) }
        catch { setError(true) }
    }
    return <section aria-label="Saved Block Party results">
        <button type="button" onClick={() => load()}>Show saved Block Party results</button>
        {error && <p role="alert">Saved results could not be read. Your exported copies can still be kept.</p>}
        {page && <>
            {page.total === 0 && <p>No saved Block Party results yet.</p>}
            {page.unavailable > 0 && <p role="status">Some saved results in this page could not be read.</p>}
            <ul>{page.snapshots.map(snapshot => <li key={snapshot.input.clientRunId}>
                <button type="button" onClick={() => setSelected(snapshot)}>Review saved score {snapshot.input.claimedScore.toLocaleString()} · {snapshot.input.clientRunId.slice(-8)}</button>
            </li>)}</ul>
            {page.nextOffset !== undefined && <button type="button" onClick={() => load(page.nextOffset)}>More saved results</button>}
        </>}
        {selected && <div>
            <button type="button" onClick={() => setSelected(null)}>Close saved result</button>
            <BlockPartyPublication snapshot={selected} storage={storage} client={client} />
        </div>}
    </section>
}
