/** Independent games listed from the editorial directory; external links only, never an Arcade endorsement. */
import { COMMUNITY_GAMES, type EcosystemProject } from "../../../lib/ecosystemDirectory"
import { resolveMedia } from "../../../lib/storeMedia"
import { CoverCapsule, Shelf } from "../../kit/storefront"

export function CommunityGames({ games = COMMUNITY_GAMES }: { games?: readonly EcosystemProject[] }) {
    if (games.length === 0) return null
    return <Shelf id="arcade-community" title="From the community">
        <div className="os-cin-grid">
            {games.map((game) => {
                const media = resolveMedia(game.id, null, game.id)
                return <CoverCapsule key={game.id} title={game.name} pitch={game.description} cover={media.cover} accent={media.accent} tags={[]}
                    costTag={{ label: "External ↗", tone: "warn" }} href={game.url} linkLabel={`Visit ${game.name} (opens in a new tab)`} />
            })}
        </div>
        <p className="os-cin-sub">Independent projects, listed by Memba for discovery and not reviewed or audited by Memba. They open outside Memba; some charge GNOT. Check their network and costs before connecting a wallet.</p>
    </Shelf>
}
