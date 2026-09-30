/**
 * My collectibles: the tokens the connected account holds, across every
 * collection, read from the ledger itself (no indexer). This is the one NFT
 * screen that needs a wallet, so it is the only one a guest is asked to
 * connect on.
 *
 * @module os/apps/nft/mine
 */
import { useInfiniteQuery } from "@tanstack/react-query"
import { listHoldings } from "../../../lib/nft/ledger"
import type { OsSession } from "../../shell/useOsSession"
import { Gate, Loading } from "../../kit"
import { Back, PagedGrid } from "./parts"
import { PAGE_SIZE, type NftScreen } from "./screen"
import { TokenCard } from "./tokens"

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
            <TokenCard key={`${holding.collection}/${holding.number}`} screen={screen} collection={holding.collection} number={holding.number} uri={holding.uri} />
        )} />
    )
}

export function MyCollectibles({ screen, session }: { screen: NftScreen; session: OsSession }) {
    return (
        <div className="os-stack">
            <Back label="Collections" onClick={() => screen.go({ kind: "home" })} />
            <section aria-label="My collectibles">
                <h3 className="os-h">My collectibles</h3>
                {session.status === "member" ? <Holdings screen={screen} owner={session.address} />
                    : session.status === "resuming" ? <Loading label="Restoring your session…" />
                    : <Gate text="Connect a wallet to see the collectibles it holds." action={<button type="button" className="os-btn" onClick={session.openConnect}>Connect</button>} />}
            </section>
        </div>
    )
}
