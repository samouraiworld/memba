import { useEffect, useId, useState } from "react"
import { sameFreePlayTarget, type FreePlayBoard as Board, type FreePlayClient, type FreePlayGame, type FreePlayReceipt, type FreePlayTarget } from "../../../lib/arcadeFreePlay"
import "./free-play-board.css"

export interface FreePlayBoardProps {
    client: Pick<FreePlayClient, "board"> | null
    target: FreePlayTarget
    game: FreePlayGame
    rules: string
    simVersion: number
}

const PAGE_SIZE = 20
// Match the public reader's bound; never load the whole board or invent a total.
const MAX_OFFSET = 100_000
const names: Record<FreePlayGame, string> = { "block-party": "Block Party", "space-invaders": "Space Invaders", barricade: "BARRICADE" }

function Proof({ receipt }: { receipt: FreePlayReceipt }) {
    return <details className="os-free-board-proof">
        <summary aria-label={`Anchoring proof for ${receipt.entry.player}`}>Anchoring proof</summary>
        <dl>
            <dt>Network</dt><dd>{receipt.target.chainId}</dd>
            <dt>Realm</dt><dd><code>{receipt.target.realm}</code></dd>
            <dt>Block</dt><dd>{receipt.height.toLocaleString()}</dd>
            <dt>Run</dt><dd><code>{receipt.entry.runID}</code></dd>
            {receipt.txHash && <><dt>Transaction</dt><dd><code>{receipt.txHash}</code></dd></>}
            <dt>Attester</dt><dd><code>{receipt.attester}</code></dd>
            <dt>Replay hash</dt><dd><code>{receipt.entry.replayHash}</code></dd>
            <dt>State hash</dt><dd><code>{receipt.entry.stateHash}</code></dd>
        </dl>
    </details>
}

type Result = { request: string; client: FreePlayBoardProps["client"]; board: Board | null }

function BoardPage({ client, target, game, rules, simVersion }: FreePlayBoardProps) {
    const title = useId()
    const { chainId, realm } = target
    const [offset, setOffset] = useState(0)
    const [revision, setRevision] = useState(0)
    const [result, setResult] = useState<Result | null>(null)
    const request = `${offset}:${revision}`
    // A page/client change must stop displaying old rows during render, before
    // passive-effect cleanup. Context changes remount this component below.
    const current = result?.request === request && result.client === client ? result : null
    const loading = client !== null && current === null
    const entries = current?.board?.entries
    useEffect(() => {
        if (!client) return
        const controller = new AbortController()
        void (async () => {
            try {
                const board = await client.board({ game, rules, simVersion, offset, limit: PAGE_SIZE }, controller.signal)
                // The shared client validates receipts. This extra context check
                // also rejects a valid reader injected for a different target.
                if (!sameFreePlayTarget(board.target, { chainId, realm }) || board.game !== game || board.rules !== rules || board.simVersion !== simVersion) throw new Error("board_context_changed")
                if (!controller.signal.aborted) setResult({ request, client, board })
            } catch {
                if (!controller.signal.aborted) setResult({ request, client, board: null })
            }
        })()
        return () => controller.abort()
    }, [client, chainId, realm, game, rules, simVersion, offset, request])

    return <section className="os-cin-panel os-free-board" aria-labelledby={title} aria-busy={loading}>
        <h2 id={title}>Free play leaderboard</h2>
        <p className="os-cin-sub">{names[game]} · {target.chainId}</p>
        <p className="os-cin-sub">Each player's best anchored score for these rules.</p>
        <details><summary>Rules and version</summary><p>{rules} · version {simVersion}</p></details>
        {loading ? <p role="status">Loading anchored scores…</p>
            : !client || !current?.board ? <p role="status">This leaderboard is unavailable right now. Scores could not be loaded.</p>
                : entries?.length === 0 ? <p role="status">{offset === 0 ? "No anchored scores yet for these rules." : "No more anchored scores on this page."}</p>
                    : <ol className="os-free-board-entries" start={offset + 1} aria-label={`${names[game]} anchored scores`}>
                        {entries?.map(receipt => <li key={receipt.entry.player}>
                            <div className="os-free-board-row"><code>{receipt.entry.player}</code><strong aria-label={`Score ${receipt.entry.score}`}>{receipt.entry.score.toLocaleString()}</strong></div>
                            <Proof receipt={receipt} />
                        </li>)}
                    </ol>}
        <div className="os-free-board-controls">
            <button type="button" className="os-cin-btn" disabled={loading || offset === 0} onClick={() => setOffset(value => Math.max(0, value - PAGE_SIZE))}>Previous page</button>
            <span>Page {offset / PAGE_SIZE + 1}</span>
            <button type="button" className="os-cin-btn" disabled={loading || entries?.length !== PAGE_SIZE || offset + PAGE_SIZE > MAX_OFFSET} onClick={() => setOffset(value => Math.min(MAX_OFFSET, value + PAGE_SIZE))}>Next page</button>
            {client && <button type="button" className="os-cin-link" disabled={loading} onClick={() => setRevision(value => value + 1)}>Refresh scores</button>}
        </div>
    </section>
}

/** Read-only, injected consumer. No endpoint, auth, active rules or network default. */
export function FreePlayBoard(props: FreePlayBoardProps) {
    const key = JSON.stringify([props.target.chainId, props.target.realm, props.game, props.rules, props.simVersion])
    return <BoardPage key={key} {...props} />
}
