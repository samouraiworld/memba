/**
 * ConnectBanner — Shown to unauthenticated visitors on the NFT marketplace.
 */

interface Props {
    onConnect?: () => void
}

export function ConnectBanner({ onConnect }: Props) {
    return (
        <div className="nft-connect-banner">
            <div className="nft-connect-banner__icon">🔐</div>
            <div className="nft-connect-banner__body">
                <p className="nft-connect-banner__title">Connect Adena to trade</p>
                <p className="nft-connect-banner__hint">
                    Browse the gallery freely. Connect your wallet to buy, sell, or make offers.
                </p>
            </div>
            {onConnect && (
                <button className="nft-connect-banner__btn" onClick={onConnect}>
                    Connect Wallet
                </button>
            )}
        </div>
    )
}
