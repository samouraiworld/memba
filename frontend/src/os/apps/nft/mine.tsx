/**
 * My collectibles: the tokens the connected account holds, across every
 * collection, read from the ledger itself (no indexer). This is the one NFT
 * screen that needs a wallet, so it is the only one a guest is asked to
 * connect on. A card shows its token's art only once its collection's
 * curation record is read and does not hide it, as the profile does; the
 * record is read once per collection shown, and the item page is where a
 * viewer can show a hidden collection's art anyway.
 *
 * @module os/apps/nft/mine
 */
import { useInfiniteQuery } from "@tanstack/react-query"
import type { Ref } from "react"
import { listHoldings, type NftHolding } from "../../../lib/nft/ledger"
import type { OsSession } from "../../shell/useOsSession"
import { Gate, Loading } from "../../kit"
import { Back, PagedGrid } from "./parts"
import { PAGE_SIZE, useCurationRecord, type NftScreen } from "./screen"
import { TokenCard } from "./tokens"

function HoldingCard({ screen, holding }: { screen: NftScreen; holding: NftHolding }) {
    const { cleared } = useCurationRecord(screen, holding.collection)
    return <TokenCard screen={screen} collection={holding.collection} number={holding.number} uri={holding.uri} showMedia={cleared} />
}

function Holdings({ screen, owner }: { screen: NftScreen; owner: string }) {
    const holdings = useInfiniteQuery({
        queryKey: ["nft", "ledger", "holdings", screen.chainId, owner],
        queryFn: ({ pageParam }) => listHoldings(owner, pageParam, PAGE_SIZE),
        initialPageParam: 0,
        getNextPageParam: (last, pages) => last.length === PAGE_SIZE ? pages.length : undefined,
        staleTime: 30_000, retry: false,
    })
    return (
        <PagedGrid query={holdings} what="collectibles" empty="This account holds no collectible yet." render={(holding) => (
            <HoldingCard key={`${holding.collection}/${holding.number}`} screen={screen} holding={holding} />
        )} />
    )
}

/** `back` goes on the control back to Collections, which takes focus when this screen is opened from another. */
export function MyCollectibles({ screen, session, back }: { screen: NftScreen; session: OsSession; back: Ref<HTMLButtonElement> }) {
    return (
        <div className="os-stack">
            <Back ref={back} label="Collections" onClick={() => screen.go({ kind: "home" })} />
            <section aria-label="My collectibles">
                <h3 className="os-h">My collectibles</h3>
                {session.status === "member" ? <Holdings screen={screen} owner={session.address} />
                    : session.status === "resuming" ? <Loading label="Restoring your session…" />
                    : <Gate text="Connect a wallet to see the collectibles it holds." action={<button type="button" className="os-btn" onClick={session.openConnect}>Connect</button>} />}
            </section>
        </div>
    )
}
