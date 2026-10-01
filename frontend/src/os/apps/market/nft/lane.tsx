/**
 * The Market window's NFT lane: Explore, one collection (where a collection
 * offer is made), one token's trade panel (where it is bought, listed, offered
 * for, and sold to an offer), and My trading (where one's own offers are
 * cancelled), each a section of the Market window.
 * Loaded on its own, the first time an NFT section opens.
 *
 * @module os/apps/market/nft/lane
 */
import type { NativeViewProps } from "../../../native/types"
import { Segmented } from "../../../kit"
import { marketNftSection, nftSection, type MarketNftRoute } from "../../../nft/routes"
import { specForTarget } from "../../../shell/windows"
import { CollectionTrade } from "./collection"
import { Explore } from "./explore"
import { ItemTrade } from "./item"
import { MyTrading } from "./mine"
import type { LaneProps } from "./reads"

const VIEWS = [{ id: "explore", name: "Explore" }, { id: "mine", name: "My trading" }] as const

export default function NftLane({ route, session, open, push }: { route: MarketNftRoute } & Pick<NativeViewProps, "session" | "open" | "push">) {
    const lane: LaneProps = {
        chainId: session.network.chainId,
        go: (to) => push(specForTarget({ kind: "app", app: "market", section: marketNftSection(to) })!),
        openNft: (to) => open(specForTarget({ kind: "app", app: "nft", section: nftSection(to) })!),
    }
    return (
        <div className="os-stack">
            <Segmented label="NFT lane" options={VIEWS} value={route.kind === "mine" ? "mine" : "explore"} onChange={(kind) => lane.go({ kind })} />
            {route.kind === "explore" ? <Explore lane={lane} />
                : route.kind === "mine" ? <MyTrading lane={lane} session={session} />
                : route.kind === "collection" ? <CollectionTrade lane={lane} session={session} collection={route.collection} />
                : <ItemTrade lane={lane} session={session} collection={route.collection} number={route.number} />}
        </div>
    )
}
