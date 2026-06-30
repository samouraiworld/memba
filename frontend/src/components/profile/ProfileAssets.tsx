import { useState, useEffect } from "react"
import { fetchNFTPortfolio, type NFTPortfolioToken } from "../../lib/nftApi"
import { useBalance } from "../../hooks/useBalance"
import { formatGnotCompact } from "../../lib/formatGnot"
import { useNetworkPath } from "../../hooks/useNetworkNav"
import { SkeletonCard } from "../ui/LoadingSkeleton"
import { NFTMedia } from "../nft/NFTMedia"
import "./profileAssets.css"

export function ProfileAssets({ address }: { address: string }) {
    const { rawUgnot, loading: balanceLoading } = useBalance(address)
    const [nfts, setNfts] = useState<NFTPortfolioToken[]>([])
    const [loadingNfts, setLoadingNfts] = useState(true)
    const np = useNetworkPath()

    useEffect(() => {
        let mounted = true
        fetchNFTPortfolio(address).then((data: NFTPortfolioToken[]) => {
            if (mounted) {
                setNfts(data)
                setLoadingNfts(false)
            }
        }).catch(() => {
            if (mounted) setLoadingNfts(false)
        })
        return () => { mounted = false }
    }, [address])

    return (
        <div className="profile-assets-container animate-fade-in">
            <h3 className="profile-section-title">Native Balance</h3>
            <div className="k-card asset-native-card">
                <div className="asset-native-icon">💰</div>
                <div className="asset-native-info">
                    <h4>Gno.land Testnet</h4>
                    <p>Native GNOT</p>
                </div>
                <div className="asset-native-balance">
                    {balanceLoading ? "..." : (typeof rawUgnot === "bigint" ? formatGnotCompact(rawUgnot) : "0")} GNOT
                </div>
            </div>

            <h3 className="profile-section-title" style={{ marginTop: 32 }}>NFT Portfolio ({nfts.length})</h3>
            {loadingNfts ? (
                <div className="profile-nfts-grid">
                    <SkeletonCard /><SkeletonCard /><SkeletonCard />
                </div>
            ) : nfts.length === 0 ? (
                <div className="k-dashed profile-empty" style={{ padding: "40px 20px" }}>
                    <div className="profile-empty-icon" style={{ fontSize: 28, marginBottom: 16 }}>🖼️</div>
                    <h3 className="profile-empty-title">No Digital Assets</h3>
                    <p className="profile-empty-desc">This user does not hold any verified NFTs.</p>
                </div>
            ) : (
                <div className="profile-nfts-grid">
                    {nfts.map(nft => (
                        <a 
                            key={`${nft.collectionId}-${nft.tokenId}`} 
                            className="k-card profile-nft-card" 
                            href={np(`nft/token/${nft.collectionId}/${nft.tokenId}`)}
                            style={{ textDecoration: "none", color: "inherit", display: "flex", flexDirection: "column", padding: 0, overflow: "hidden" }}
                        >
                            <div className="profile-nft-img-wrapper" style={{ aspectRatio: "1/1", background: "var(--color-bg-tertiary)" }}>
                                <NFTMedia uri={nft.uri} alt={`#${nft.tokenId}`} seed={nft.tokenId} />
                            </div>
                            <div className="profile-nft-meta" style={{ padding: "16px" }}>
                                <h5 style={{ margin: "0 0 4px", fontSize: "16px", fontWeight: 600 }}>{`#${nft.tokenId}`}</h5>
                                <p style={{ margin: 0, fontSize: "14px", color: "var(--color-text-muted)" }}>{nft.collectionId}</p>
                            </div>
                        </a>
                    ))}
                </div>
            )}
        </div>
    )
}
