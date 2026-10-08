/** Today's Block Party top 3, read from the game server; honest about failure. */
import { Code, ConnectError } from "@connectrpc/connect"
import { useQuery } from "@tanstack/react-query"
import { gameApi } from "../../../lib/gameApi"

const short = (address: string) => `${address.slice(0, 8)}…${address.slice(-4)}`

export function DailyTop({ chainId, onOpen }: { chainId: string; onOpen: () => void }) {
    const date = new Date().toISOString().slice(0, 10)
    const board = useQuery({ queryKey: ["bp", "leaderboard", chainId, "top3", date], queryFn: () => gameApi.getDailyLeaderboard(date, 3), staleTime: 60_000, retry: 1 })
    return <section className="os-cin-panel" aria-labelledby="arcade-daily-top">
        <h2 id="arcade-daily-top">Daily board</h2>
        {board.isPending ? <p className="os-cin-sub">Loading today's board…</p>
            : board.isError ? <p className="os-cin-sub" role="status">{ConnectError.from(board.error).code === Code.Unimplemented
                ? "The daily board isn't live right now."
                : "The daily board could not be loaded. This is not an empty board."}</p>
            : board.data.entries.length === 0 ? <p className="os-cin-sub">No finished runs today yet.</p>
            : <ol className="os-cin-board">{board.data.entries.map((entry) => <li key={entry.address}><b>{String(entry.rank)}</b><code>{short(entry.address)}</code><b>{String(entry.score)}</b></li>)}</ol>}
        <button type="button" className="os-cin-link" onClick={onOpen}>Full board in the game</button>
    </section>
}
