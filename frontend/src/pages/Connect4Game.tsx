import { useOutletContext, useParams } from "react-router-dom"
import type { LayoutContext } from "../types/layout"
import { useNetworkNav } from "../hooks/useNetworkNav"
import { Lobby } from "../games/connect4/Lobby"
import { GameView } from "../games/connect4/GameView"

export default function Connect4Game() {
    const { adena } = useOutletContext<LayoutContext>()
    const { id } = useParams<{ id?: string }>()
    const nav = useNetworkNav()
    const me = adena.connected ? adena.address : ""
    const gameId = id !== undefined && /^\d{1,9}$/.test(id) ? Number(id) : null
    if (id !== undefined && gameId === null) return <div><p>Invalid game id.</p><button type="button" onClick={() => nav("game/connect4")}>Back to lobby</button></div>
    return gameId === null
        ? <Lobby me={me} connected={adena.connected} onOpen={(g) => nav(`game/connect4/${g}`)} />
        : <GameView key={gameId} id={gameId} me={me} connected={adena.connected} onBack={() => nav("game/connect4")} />
}
