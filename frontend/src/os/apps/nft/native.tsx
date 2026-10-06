/**
 * NFT native home. Collections live on the NFT ledger realm; buying and
 * selling is Market's (owner decision 09-25). The home is available only when
 * the NFT build flag is on AND the ledger is allowlisted on the session
 * network, which it is on none until the realm is published; otherwise the
 * home says which of the two is missing. When available it lists the newest
 * collections, read strictly: a failed read is shown as an error with a retry,
 * a list the ledger refused and data that breaks its rules as errors without
 * one, and none as an empty ledger. Guests browse freely. Every other section is
 * still the classic page, handed through as `fallback`.
 *
 * @module os/apps/nft/native
 */
import { useQuery } from "@tanstack/react-query"
import type { NativeViewProps } from "../../native/types"
import { isNftEnabled, isRealmValidOn } from "../../../lib/config"
import { revealInvisibleFormatting } from "../../../lib/dao/v2Text"
import { NFT_LEDGER_PATH, listNewestCollections, type NftMode } from "../../../lib/nft/ledger"
import { ReadError, RealmRefusedError } from "../../../lib/nft/read"
import { Card, CardGrid, Empty, ErrorState, Loading, Pill } from "../../kit"
import { Icon } from "../../shell/icons"

const SHOWN = 20
const MODE_LABEL: Record<NftMode, string> = { open: "Transferable", royalty_protected: "Royalty-protected", soulbound: "Soulbound" }

function Collections({ chainId }: { chainId: string }) {
    // The session network is the one the config was loaded with, which is the network the readers query.
    const collections = useQuery({
        queryKey: ["nft", "ledger", NFT_LEDGER_PATH, "newest", chainId],
        queryFn: () => listNewestCollections(SHOWN),
        staleTime: 60_000, retry: false,
    })
    return (
        <section aria-labelledby="nft-collections">
            <h3 className="os-h" id="nft-collections">Collections</h3>
            {collections.isPending ? <Loading label="Reading collections…" />
                : collections.isError ? (collections.error instanceof ReadError
                    ? <ErrorState message="Collections could not be read from this network." onRetry={() => void collections.refetch()} />
                    : collections.error instanceof RealmRefusedError
                        ? <ErrorState message="This network's NFT ledger refused to list its collections." />
                        : <ErrorState message="This network's collection data does not follow the ledger's rules, so it is not shown." />)
                : collections.data.total === 0n ? <Empty title="No collections have been created yet." />
                : <div className="os-stack os-tight">
                    {collections.data.total > BigInt(SHOWN) && <p className="os-sub">The {SHOWN} newest of {collections.data.total.toString()} collections, newest first.</p>}
                    <ul className="os-list os-sgrid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
                        {collections.data.collections.map((item) => (
                            <li key={item.id} className="os-scard">
                                <Icon name="nft" />
                                <span className="os-grow" style={{ overflowWrap: "anywhere" }}>
                                    <b>{revealInvisibleFormatting(item.name)}</b>
                                    <span className="os-sub os-block">{revealInvisibleFormatting(item.symbol)}</span>
                                    <span className="os-sub os-block">
                                        {item.maxSupply === 0n ? `${item.minted} minted` : `${item.minted} / ${item.maxSupply} minted`}
                                        {item.sealed ? " · closed edition" : item.maxSupply === 0n && " · open edition"}
                                    </span>
                                </span>
                                <Pill tone="neutral">{MODE_LABEL[item.mode]}</Pill>
                            </li>
                        ))}
                    </ul>
                </div>}
        </section>
    )
}

export default function NftWindow({ section, session, openApp, fallback }: NativeViewProps) {
    if (section !== null) return <>{fallback}</>

    const enabled = isNftEnabled()
    const chainId = session.network.chainId
    const ledgerAvailable = isRealmValidOn(session.network.key, NFT_LEDGER_PATH)
    const market = (
        <CardGrid>
            <Card onClick={() => openApp("market")}>
                <Icon name="tag" />
                <span className="os-grow"><b>Open Market</b><span className="os-sub os-block">Browse the available Market lanes</span></span>
            </Card>
        </CardGrid>
    )
    if (!enabled || !ledgerAvailable) {
        return (
            <div className="os-stack">
                <div className="os-note os-warn" role="note">
                    <Pill tone="neutral">NFT unavailable here</Pill>
                    {!ledgerAvailable && (session.network.key === "mainnet"
                        ? ` The NFT ledger is not deployed on ${chainId}.`
                        : " The NFT ledger is not available on this network.")}
                    {!enabled && " NFT features are disabled in this build."}
                </div>
                {market}
            </div>
        )
    }

    return (
        <div className="os-stack">
            <Collections chainId={chainId} />
            {market}
        </div>
    )
}
