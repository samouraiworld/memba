/**
 * Token cards and a collection's token grid. A card shows the image and name
 * from the token's metadata file when it can be read, and the generated art
 * with the token's number when it cannot: a card is a way to the item page,
 * which says why the metadata is missing.
 *
 * @module os/apps/nft/tokens
 */
import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { revealInvisibleFormatting } from "../../../lib/dao/v2Text"
import { listTokens, type NftTokenStatus } from "../../../lib/nft/ledger"
import { TokenMedia } from "../../nft/TokenMedia"
import { Card, Pill } from "../../kit"
import { PagedGrid } from "./parts"
import { PAGE_SIZE, RETIRED, metadataQuery, type NftScreen } from "./screen"

export function TokenCard({ screen, collection, number, uri, status = "active", showMedia = true }: {
    screen: NftScreen
    collection: string
    number: bigint
    uri: string
    status?: NftTokenStatus
    /** False while the collection's presentation is collapsed: the file is not even read. */
    showMedia?: boolean
}) {
    const metadata = useQuery({ ...metadataQuery(screen.chainId, uri), enabled: showMedia && uri !== "" })
    const name = showMedia ? metadata.data?.name : null
    const label = `${collection} #${number}`
    return (
        <Card onClick={() => screen.go({ kind: "token", collection, number })}>
            <span className="os-nft-card">
                <TokenMedia uri={showMedia ? metadata.data?.image ?? null : null} seed={`${collection}/${number}`} alt="" />
                <b className="os-break">{name ? revealInvisibleFormatting(name) : label}</b>
                {name && <span className="os-sub">{label}</span>}
                {status !== "active" && <Pill tone="neutral">{RETIRED[status]}</Pill>}
            </span>
        </Card>
    )
}

export function TokenGrid({ screen, collection, showMedia }: { screen: NftScreen; collection: string; showMedia: boolean }) {
    const tokens = useInfiniteQuery({
        queryKey: ["nft", "ledger", "tokens", screen.chainId, collection],
        queryFn: ({ pageParam }) => listTokens(collection, pageParam, PAGE_SIZE),
        initialPageParam: 0,
        getNextPageParam: (last, pages) => last.length === PAGE_SIZE ? pages.length : undefined,
        staleTime: 60_000, retry: false,
    })
    return (
        <section aria-label="Tokens">
            <h3 className="os-h">Tokens</h3>
            <PagedGrid query={tokens} what="tokens" empty="No token has been minted yet." render={(token) => (
                <TokenCard key={token.number.toString()} screen={screen} collection={collection} number={token.number} uri={token.uri} status={token.status} showMedia={showMedia} />
            )} />
        </section>
    )
}
