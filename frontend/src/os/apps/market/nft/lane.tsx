/**
 * The Market window's NFT lane: Explore, one collection (where a collection
 * offer is made), one token's trade panel (where it is bought, listed, offered
 * for, and sold to an offer), and My trading (where one's own offers are
 * cancelled), and Operations, the curation desk (where a collection's creator
 * applies for review and managers decide), each a section of the Market window.
 * Loaded on its own, the first time an NFT section opens.
 *
 * @module os/apps/market/nft/lane
 */
import { useEffect, useRef } from "react"
import type { NativeViewProps } from "../../../native/types"
import { Segmented } from "../../../kit"
import { marketNftSection, nftSection, type MarketNftRoute } from "../../../nft/routes"
import { specForTarget } from "../../../shell/windows"
import { useTradingClosed } from "./signing"
import { CollectionTrade } from "./collection"
import { Explore } from "./explore"
import { ItemTrade } from "./item"
import { MyTrading } from "./mine"
import { Application, Operations } from "./operations"
import type { LaneProps } from "./reads"

const VIEWS = [{ id: "explore", name: "Explore" }, { id: "mine", name: "My trading" }, { id: "operations", name: "Operations" }] as const

export default function NftLane({ route, session, open, push }: { route: MarketNftRoute } & Pick<NativeViewProps, "session" | "open" | "push">) {
    const lane: LaneProps = {
        chainId: session.network.chainId,
        go: (to) => push(specForTarget({ kind: "app", app: "market", section: marketNftSection(to) })!),
        openNft: (to) => open(specForTarget({ kind: "app", app: "nft", section: nftSection(to) })!),
    }
    // Moving within the lane takes focus to the new view's first heading; the first view keeps the focus the window gave it.
    const view = useRef<HTMLDivElement>(null)
    const section = marketNftSection(route)
    const closed = useTradingClosed(session.network.key)
    const trading = route.kind !== "operations" && route.kind !== "application"
    const first = useRef(true)
    useEffect(() => {
        if (first.current) { first.current = false; return }
        const heading = view.current?.querySelector<HTMLElement>("h3")
        if (!heading) return
        heading.tabIndex = -1
        heading.focus()
    }, [section])
    return (
        <div className="os-stack" ref={view}>
            <Segmented label="NFT lane" options={VIEWS} value={route.kind === "mine" ? "mine" : trading ? "explore" : "operations"} onChange={(kind) => lane.go({ kind })} />
            {trading && closed && <p className="os-note os-warn" role="note">{closed} New listings, offers and purchases wait until it reopens; cancelling an order still works.</p>}
            {route.kind === "explore" ? <Explore lane={lane} />
                : route.kind === "mine" ? <MyTrading lane={lane} session={session} />
                : route.kind === "operations" ? <Operations lane={lane} />
                : route.kind === "application" ? <Application lane={lane} session={session} collection={route.collection} />
                : route.kind === "collection" ? <CollectionTrade lane={lane} session={session} collection={route.collection} />
                : <ItemTrade lane={lane} session={session} collection={route.collection} number={route.number} />}
        </div>
    )
}
