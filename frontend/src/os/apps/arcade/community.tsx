/** Independent games listed from the editorial directory; external links only, never an Arcade endorsement. */
import { COMMUNITY_GAMES } from "../../../lib/ecosystemDirectory"
import type { EcosystemProject } from "../../../lib/ecosystemDirectory"
import { Card, CardGrid, Pill } from "../../kit"
import { Icon } from "../../shell/icons"

export function CommunityGames({ games = COMMUNITY_GAMES }: { games?: readonly EcosystemProject[] }) {
    if (games.length === 0) return null
    return <section aria-labelledby="arcade-community" className="os-stack os-tight">
        <h3 id="arcade-community" className="os-h os-flush">From the community</h3>
        <CardGrid min={200}>
            {games.map((game) => <Card key={game.id} href={game.url} label={`Visit ${game.name} (opens in a new tab)`}>
                <Icon name="game" />
                <span className="os-grow"><b>{game.name}</b><span className="os-sub os-block">{game.description}</span></span>
                <Pill tone="neutral">External <span aria-hidden="true">↗</span></Pill>
            </Card>)}
        </CardGrid>
        <p className="os-sub">Independent projects, listed by Memba for discovery and not reviewed or audited by Memba. They open outside Memba; some charge GNOT. Check their network and costs before connecting a wallet.</p>
    </section>
}
