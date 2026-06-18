/**
 * CollectionDetail — per-collection page for the Phase 2 launchpad.
 *
 *  - Reads the collection via Render (fetchCollectionDetail).
 *  - Mint panel: public mint for anyone while the collection is in the public phase.
 *  - Manage panel (admin only): set mint phase, set mint config, admin-mint,
 *    withdraw proceeds — all wired to the tested launchpad builders.
 *
 * Route: /nft/collection/:creator/:slug   (id = "creator/slug")
 *
 * @module pages/CollectionDetail
 */

import { useState, useEffect, useCallback } from "react"
import { useParams, useOutletContext, Link } from "react-router-dom"
import { useNetworkPath } from "../hooks/useNetworkNav"
import { NFT_COLLECTIONS_PATH } from "../lib/nftConfig"
import { fetchCollectionDetail, isCollectionVerified } from "../lib/launchpadReads"
import { VerifiedBadge } from "../components/nft/VerifiedBadge"
import type { CollectionDetail as CollectionDetailT } from "../lib/launchpad"
import {
    Phase,
    buildMintPublicMsg,
    buildMintAllowlistMsg,
} from "../lib/launchpad"
import { getAllowlistProof, parseAllowlistText } from "../lib/allowlistMerkle"
import type { LayoutContext } from "../types/layout"
import "./nft-launchpad.css"
import { tradeEngineFor } from "../lib/tradeEngine"
import { fetchV3Tokens, fetchV3Listings, listingKey, type V3Token, type V3ListingMap } from "../lib/v3TokenGrid"
import { NFTImage } from "../components/nft/NFTImage"
import { V3ListForSaleModal } from "../components/nft/V3ListForSaleModal"
import { V3BuyNFTModal } from "../components/nft/V3BuyNFTModal"

const PHASE_LABELS: Record<number, string> = {
    [Phase.Draft]: "Draft",
    [Phase.Allowlist]: "Allowlist",
    [Phase.Public]: "Public",
    [Phase.Closed]: "Closed",
}

async function broadcast(msg: ReturnType<typeof buildMintPublicMsg>, memo: string) {
    const { doContractBroadcast } = await import("../lib/grc20")
    return doContractBroadcast([msg], memo)
}

export function CollectionDetail() {
    const { creator, slug } = useParams<{ creator: string; slug: string }>()
    const id = creator && slug ? `${creator}/${slug}` : ""
    const { adena } = useOutletContext<LayoutContext>()
    const me = adena?.address || ""
    const np = useNetworkPath()

    const [col, setCol] = useState<CollectionDetailT | null>(null)
    const [verified, setVerified] = useState(false)
    const [loading, setLoading] = useState(true)
    const [notice, setNotice] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    // ── v3 token grid state ──────────────────────────────────────────────────
    const [v3Tokens, setV3Tokens] = useState<V3Token[]>([])
    const [v3Listings, setV3Listings] = useState<V3ListingMap>(new Map())
    const [v3Loading, setV3Loading] = useState(false)
    const [listModal, setListModal] = useState<{ tokenId: string } | null>(null)
    const [buyModal, setBuyModal] = useState<{ tokenId: string; priceUgnot: number; seller: string } | null>(null)
    const v3Engine = tradeEngineFor("v3")

    const reload = useCallback(async () => {
        setLoading(true)
        try {
            const [detail, isVerified] = await Promise.all([
                fetchCollectionDetail(id),
                isCollectionVerified(id).catch(() => false),
            ])
            setCol(detail)
            setVerified(isVerified)
        } catch {
            setCol(null)
        } finally {
            setLoading(false)
        }
    }, [id])

    // Reload the v3 token grid + listings (called after list/buy success)
    const reloadV3 = useCallback(async (supply: number) => {
        setV3Loading(true)
        try {
            const [tokens, listings] = await Promise.all([
                fetchV3Tokens(id, supply),
                fetchV3Listings(id),
            ])
            setV3Tokens(tokens)
            setV3Listings(listings)
        } finally {
            setV3Loading(false)
        }
    }, [id])

    useEffect(() => {
        document.title = `${id} — Memba`
        reload()
    }, [id, reload])

    // Load v3 token grid once we know the minted supply
    useEffect(() => {
        if (col && col.minted > 0) {
            reloadV3(col.minted)
        }
    }, [col, reloadV3])

    const run = useCallback(
        async (msg: ReturnType<typeof buildMintPublicMsg>, memo: string) => {
            setError(null)
            setNotice(null)
            try {
                await broadcast(msg, memo)
                setNotice(`${memo} ✓`)
                reload()
            } catch (e) {
                setError(e instanceof Error ? e.message : "Transaction failed")
            }
        },
        [reload],
    )

    if (loading) return <div className="collection-detail">Loading {id}…</div>
    if (!col) return <div className="collection-detail">Collection not found: <code>{id}</code></div>

    const isAdmin = me !== "" && me === col.admin
    const isNative = col.payDenom === "ugnot" || col.payDenom === ""

    const handleListSuccess = () => {
        setListModal(null)
        reload()
        reloadV3(col.minted)
    }

    const handleBuySuccess = () => {
        setBuyModal(null)
        reload()
        reloadV3(col.minted)
    }

    return (
        <div className="collection-detail">
            <h1>{col.name} <small>({col.symbol})</small> <VerifiedBadge verified={verified} /></h1>
            <ul className="collection-meta">
                <li>ID: <code>{col.id}</code></li>
                <li>Creator: <code>{col.creator}</code></li>
                <li>Phase: <strong>{PHASE_LABELS[col.phase] ?? col.phase}</strong></li>
                <li>Royalty: {col.royaltyBps / 100}% → <code>{col.royaltyRecip}</code></li>
                <li>Mint price: {col.mintPrice} {col.payDenom}</li>
                <li>Minted: {col.minted}{col.maxSupply > 0 ? ` / ${col.maxSupply}` : " (unlimited)"}</li>
                {col.paused && <li>⚠️ Paused</li>}
            </ul>

            {notice && <div className="form-hint" role="status">{notice}</div>}
            {error && <div className="form-error" role="alert">{error}</div>}

            {/* ── Public mint (anyone, public phase) ── */}
            <section>
                <h2>Mint</h2>
                {col.phase !== Phase.Public ? (
                    <p className="form-hint">Public minting is not open (phase: {PHASE_LABELS[col.phase]}).</p>
                ) : !me ? (
                    <p className="form-hint">Connect your wallet to mint.</p>
                ) : (
                    <MintPublicForm id={col.id} priceUgnot={isNative ? col.mintPrice : 0} caller={me} onRun={run} />
                )}
                {col.phase === Phase.Allowlist && (
                    !me ? (
                        <p className="form-hint">Connect your wallet to check the allowlist and mint.</p>
                    ) : (
                        <AllowlistMintForm id={col.id} priceUgnot={isNative ? col.mintPrice : 0} caller={me} onRun={run} />
                    )
                )}
            </section>

            {/* ── Manage (admin only) ── */}
            {isAdmin && (
                <Link to={np(`nft/studio/${col.id}`)} className="studio-manage-link">
                    Manage in Studio →
                </Link>
            )}

            {/* ── v3 Token Grid ── */}
            <section className="v3-token-grid-section">
                <h2>Tokens</h2>
                {v3Loading && <p className="form-hint">Loading tokens…</p>}
                {!v3Loading && col.minted === 0 && (
                    <p className="form-hint">No tokens minted yet.</p>
                )}
                {!v3Loading && col.minted > 0 && v3Tokens.length === 0 && (
                    <p className="form-hint">No tokens found.</p>
                )}
                {!v3Loading && v3Tokens.length > 0 && (
                    <div className="v3-token-grid">
                        {v3Tokens.map((token) => {
                            const lk = listingKey(col.id, token.tokenId)
                            const listed = v3Listings.get(lk)
                            const isOwner = me !== "" && me === token.owner
                            const isSeller = me !== "" && listed?.seller === me
                            const canBuy = listed !== undefined && !isSeller

                            return (
                                <div key={token.tokenId} className="v3-token-card">
                                    <NFTImage
                                        uri={token.uri}
                                        alt={`Token ${token.tokenId}`}
                                        className="v3-token-card__img"
                                    />
                                    <div className="v3-token-card__body">
                                        <div className="v3-token-card__id">#{token.tokenId}</div>
                                        <div className="v3-token-card__owner" title={token.owner}>
                                            {token.owner.slice(0, 8)}…{token.owner.slice(-4)}
                                        </div>
                                        {listed && (
                                            <div className="v3-token-card__price">
                                                {(listed.priceUgnot / 1_000_000).toFixed(4)} GNOT
                                            </div>
                                        )}
                                        {!listed && <div className="v3-token-card__status">Unlisted</div>}
                                    </div>
                                    <div className="v3-token-card__actions">
                                        {isOwner && !listed && me && (
                                            <button
                                                className="btn-primary"
                                                onClick={() => setListModal({ tokenId: token.tokenId })}
                                            >
                                                List for sale
                                            </button>
                                        )}
                                        {canBuy && me && (
                                            <button
                                                className="btn-primary"
                                                onClick={() =>
                                                    setBuyModal({
                                                        tokenId: token.tokenId,
                                                        priceUgnot: listed.priceUgnot,
                                                        seller: listed.seller,
                                                    })
                                                }
                                            >
                                                Buy
                                            </button>
                                        )}
                                        {(isOwner && !listed && !me) || (listed && !me) ? (
                                            <span className="form-hint">Connect wallet</span>
                                        ) : null}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}
            </section>

            {/* ── v3 Modals ── */}
            {listModal && me && (
                <V3ListForSaleModal
                    collectionID={col.id}
                    tokenId={listModal.tokenId}
                    royaltyBps={col.royaltyBps}
                    callerAddress={me}
                    engine={v3Engine}
                    onClose={() => setListModal(null)}
                    onSuccess={handleListSuccess}
                />
            )}
            {buyModal && me && (
                <V3BuyNFTModal
                    collectionID={col.id}
                    tokenId={buyModal.tokenId}
                    priceUgnot={buyModal.priceUgnot}
                    seller={buyModal.seller}
                    royaltyBps={col.royaltyBps}
                    callerAddress={me}
                    engine={v3Engine}
                    onClose={() => setBuyModal(null)}
                    onSuccess={handleBuySuccess}
                />
            )}
        </div>
    )
}

type RunFn = (msg: ReturnType<typeof buildMintPublicMsg>, memo: string) => Promise<void>

function MintPublicForm({ id, priceUgnot, caller, onRun }: { id: string; priceUgnot: number; caller: string; onRun: RunFn }) {
    const [uri, setUri] = useState("")
    return (
        <div className="manage-fields">
            <label className="form-group">
                <span>Token URI</span>
                <input value={uri} onChange={(e) => setUri(e.target.value)} placeholder="ipfs://… (leave blank for on-chain default)" />
                <small className="form-hint">IPFS or HTTP URI for the token's metadata. Optional.</small>
            </label>
            <button className="btn-primary" onClick={() => onRun(buildMintPublicMsg(caller, NFT_COLLECTIONS_PATH, id, uri, priceUgnot), `Mint ${id}`)}>
                Mint{priceUgnot > 0 ? ` (${priceUgnot / 1_000_000} GNOT)` : " (free)"}
            </button>
        </div>
    )
}

// ── Minter: load the published allowlist, derive your proof, mint ────────────
function AllowlistMintForm({ id, priceUgnot, caller, onRun }: { id: string; priceUgnot: number; caller: string; onRun: RunFn }) {
    const [listText, setListText] = useState("")
    const [uri, setUri] = useState("")
    const [status, setStatus] = useState<string | null>(null)
    const [derived, setDerived] = useState<{ maxQty: number; proof: string[] } | null>(null)

    const check = useCallback(async () => {
        setStatus(null)
        setDerived(null)
        const entries = parseAllowlistText(listText)
        if (entries.length === 0) {
            setStatus("No valid entries in the pasted list.")
            return
        }
        const p = await getAllowlistProof(entries, caller)
        if (!p) {
            setStatus("Your address is not on this allowlist.")
            return
        }
        setDerived(p)
        setStatus(`✓ Allowlisted for ${p.maxQty}. Ready to mint.`)
    }, [listText, caller])

    return (
        <div className="manage-fields">
            <label className="form-group">
                <span>Allowlist (paste to verify)</span>
                <textarea value={listText} onChange={(e) => setListText(e.target.value)} placeholder={"g1abc...,2\ng1def...,1"} rows={4} />
                <small className="form-hint">Allowlist phase — paste the creator's published list (one <code>address,qty</code> per line) to derive your proof.</small>
            </label>
            <button onClick={check}>Check allowlist</button>
            {status && <small className="form-hint">{status}</small>}
            {derived && (
                <>
                    <label className="form-group">
                        <span>Token URI</span>
                        <input value={uri} onChange={(e) => setUri(e.target.value)} placeholder="ipfs://… (leave blank for on-chain default)" />
                        <small className="form-hint">IPFS or HTTP URI for the token's metadata. Optional.</small>
                    </label>
                    <button
                        className="btn-primary"
                        onClick={() => onRun(buildMintAllowlistMsg(caller, NFT_COLLECTIONS_PATH, id, derived.proof, derived.maxQty, uri, priceUgnot), `Allowlist mint ${id}`)}
                    >
                        Mint (allowlist){priceUgnot > 0 ? ` (${priceUgnot / 1_000_000} GNOT)` : ""}
                    </button>
                </>
            )}
        </div>
    )
}

export default CollectionDetail
