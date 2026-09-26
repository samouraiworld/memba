/**
 * NFT (v1.1) native home: collections, the launchpad and the studio are this
 * app's own, but buying and selling is Market's (owner decision 09-25) — the
 * classic /nft page used to redirect there, leaving this window empty. On
 * networks without an enabled collection registry, the home explains the
 * separate build flag and realm gates; elsewhere it offers its own sections
 * plus a shortcut into Market's NFT listings. Every other section is still the
 * classic page, handed through as `fallback`.
 *
 * @module os/apps/nft/native
 */
import type { NativeViewProps } from "../../native/types"
import { GNO_CHAIN_ID, NETWORKS, isNftEnabled, isRealmValidOn } from "../../../lib/config"
import { NFT_COLLECTIONS_PATH, NFT_MARKETPLACE_V3_PATH } from "../../../lib/nftConfig"
import { Card, CardGrid, Pill } from "../../kit"
import { Icon } from "../../shell/icons"
import { specForTarget } from "../../shell/windows"

export default function NftWindow({ section, session, open, openApp, fallback }: NativeViewProps) {
    if (section !== null) return <>{fallback}</>

    const enabled = isNftEnabled()
    const chainId = NETWORKS[session.network.key]?.chainId ?? GNO_CHAIN_ID
    const launchpadAvailable = isRealmValidOn(session.network.key, NFT_COLLECTIONS_PATH)
    const marketAvailable = isRealmValidOn(session.network.key, NFT_MARKETPLACE_V3_PATH)
    if (!enabled || !launchpadAvailable) {
        return (
            <div className="os-stack">
                <div className="os-note os-warn" role="note">
                    <Pill tone="neutral">NFT unavailable here</Pill>{" "}
                    The collection and studio screens are implemented in Memba.
                    {!launchpadAvailable && (session.network.key === "mainnet"
                        ? ` The collection registry is not deployed on ${chainId}.`
                        : " The collection registry is not available on this network.")}
                    {!enabled && " NFT features are disabled in this build."}
                    {enabled && !launchpadAvailable && " Collection actions stay unavailable until the registry is available."}
                </div>
                <CardGrid>
                    <Card onClick={() => openApp("market")}>
                        <Icon name="tag" />
                        <span className="os-grow"><b>Open Market</b><span className="os-sub os-block">Browse the available Market lanes</span></span>
                    </Card>
                </CardGrid>
            </div>
        )
    }

    return (
        <div className="os-stack">
            <p className="os-sub">The collection registry is available on this network and NFT features are enabled in this build. Buying and selling happens in Market{marketAvailable ? "." : " when its trading realm is available."}</p>
            <CardGrid>
                {marketAvailable && <Card onClick={() => open(specForTarget({ kind: "app", app: "market", section: "nfts" })!)}>
                    <Icon name="tag" />
                    <span className="os-grow"><b>Browse NFTs</b><span className="os-sub os-block">Collections and listings, in Market</span></span>
                </Card>}
                <Card onClick={() => open(specForTarget({ kind: "app", app: "nft", section: "create" })!)}>
                    <Icon name="nft" />
                    <span className="os-grow"><b>Create a collection</b><span className="os-sub os-block">Launch a new NFT collection</span></span>
                </Card>
                <Card onClick={() => open(specForTarget({ kind: "app", app: "nft", section: "studio" })!)}>
                    <Icon name="nft" />
                    <span className="os-grow"><b>Your studio</b><span className="os-sub os-block">Manage what you've minted</span></span>
                </Card>
            </CardGrid>
        </div>
    )
}
