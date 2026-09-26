/** Arcade lobby. The games themselves remain the existing classic game pages. */
import type { NativeViewProps } from "../../native/types"
import { isBarricadeEnabled, isGameEnabled, isSpaceInvadersEnabled } from "../../../lib/config"
import { AppShell, Card, CardGrid, Pill } from "../../kit"
import { Icon } from "../../shell/icons"
import { specForTarget } from "../../shell/windows"

const sections = [
    { id: "games", name: "Games", icon: "game" },
    { id: "runs", name: "Your runs", icon: "prof" },
    { id: "daily-board", name: "Daily board", icon: "chart" },
] as const

const games = [
    { name: "Block Party", section: "game", detail: "A chain-seeded daily block puzzle", enabled: isGameEnabled },
    { name: "Space Invaders", section: "space-invaders", detail: "Daily arcade waves and free play", enabled: isSpaceInvadersEnabled },
    { name: "BARRICADE", section: "barricade", detail: "Defend the lanes in a daily run", enabled: isBarricadeEnabled },
] as const

export default function ArcadeWindow({ section, open, fallback }: NativeViewProps) {
    if (section !== null && !sections.some((entry) => entry.id === section)) return <>{fallback}</>
    const current = section ?? "games"
    const go = (next: string | null) => open(specForTarget({ kind: "app", app: "arcade", section: next })!)

    return <AppShell label="Arcade" sections={sections} current={current} onSelect={(next) => go(next === "games" ? null : next)}>
        {current === "games" && <div className="os-stack">
            <div>
                <h2>Games</h2>
                <p className="os-sub">Choose a game. Playing needs no wallet; score certification is currently unavailable.</p>
            </div>
            <CardGrid min={200}>
                {games.map((game) => <Card key={game.section} onClick={() => go(game.section)}>
                    <Icon name="game" />
                    <span className="os-grow"><b>{game.name}</b><span className="os-sub os-block">{game.detail}</span></span>
                    <Pill tone={game.enabled() ? "ok" : "neutral"}>{game.enabled() ? "Play" : "Unavailable"}</Pill>
                </Card>)}
            </CardGrid>
            <p className="os-sub">An unavailable game opens its build-gate explanation. Your current build determines which games can play.</p>
        </div>}
        {current === "runs" && <div className="os-stack">
            <h2>Your runs</h2>
            <div className="os-note" role="status">A combined run history is not available yet. Games may keep their own local progress or results; they are not a certified Arcade record.</div>
            <CardGrid min={200}>{games.map((game) => <Card key={game.section} onClick={() => go(game.section)}>
                <span className="os-grow"><b>{game.name}</b><span className="os-sub os-block">Open game</span></span>
            </Card>)}</CardGrid>
        </div>}
        {current === "daily-board" && <div className="os-stack">
            <h2>Daily board</h2>
            <div className="os-note" role="status"><Pill tone="neutral">Not live</Pill>{" "}Certified scores and a combined daily leaderboard are unavailable while Arcade attestation is off. Open a game to see its available modes.</div>
            <CardGrid min={200}>{games.map((game) => <Card key={game.section} onClick={() => go(game.section)}>
                <span className="os-grow"><b>{game.name}</b><span className="os-sub os-block">{game.enabled() ? "Open game" : "Game unavailable in this build"}</span></span>
            </Card>)}</CardGrid>
        </div>}
    </AppShell>
}
