/**
 * NFT (v1.1) native home: collections, the launchpad and the studio are this
 * app's own, but buying and selling is Market's (owner decision 09-25) — the
 * classic /nft page used to redirect there, leaving this window empty. On
 * gnoland-1 the realms aren't live yet (D27), so the home explains that and
 * points at Market instead; elsewhere it offers the app's own sections plus a
 * shortcut into Market's NFT listings. Every other section is still the
 * classic page, handed through as `fallback`.
 *
 * @module os/apps/nft/native
 */
import type { NativeViewProps } from "../../native/types"
import { Card, CardGrid, NotOnMainnet } from "../../kit"
import { Icon } from "../../shell/icons"
import { specForTarget } from "../../shell/windows"

export default function NftWindow({ section, session, open, openApp, fallback }: NativeViewProps) {
    if (section !== null) return <>{fallback}</>

    if (!session.network.isTestnet) {
        return (
            <div className="os-stack">
                <NotOnMainnet what="The NFT launchpad" />
                <CardGrid>
                    <Card onClick={() => openApp("market")}>
                        <Icon name="tag" />
                        <span className="os-grow"><b>Open Market</b><span className="os-sub os-block">Trade NFTs and hire with escrow</span></span>
                    </Card>
                </CardGrid>
            </div>
        )
    }

    return (
        <div className="os-stack">
            <p className="os-sub">Collections, a studio and the launchpad live here — buying and selling happens in Market.</p>
            <CardGrid>
                <Card onClick={() => open(specForTarget({ kind: "app", app: "market", section: "nfts" })!)}>
                    <Icon name="tag" />
                    <span className="os-grow"><b>Browse NFTs</b><span className="os-sub os-block">Collections and listings, in Market</span></span>
                </Card>
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
