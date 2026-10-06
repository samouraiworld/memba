/**
 * The Market window's NFT lane, read-only: Explore, one collection, one
 * token's trade panel, and My trading, each a section of the Market window.
 * Loaded on its own, the first time an NFT section opens.
 *
 * @module os/apps/market/nft/lane
 */
import { useEffect, useRef } from "react"
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
    // Moving within the lane takes focus to the new view's first heading; the first view keeps the focus the window gave it.
    const view = useRef<HTMLDivElement>(null)
    const section = marketNftSection(route)
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
            <Segmented label="NFT lane" options={VIEWS} value={route.kind === "mine" ? "mine" : "explore"} onChange={(kind) => lane.go({ kind })} />
            {route.kind === "explore" ? <Explore lane={lane} />
                : route.kind === "mine" ? <MyTrading lane={lane} address={session.address} connect={session.openConnect} />
                : route.kind === "collection" ? <CollectionTrade lane={lane} collection={route.collection} />
                : <ItemTrade lane={lane} collection={route.collection} number={route.number} />}
        </div>
    )
}
