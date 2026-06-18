/**
 * CollectionDetail — per-collection page for the Phase 2 launchpad.
 *
 *  - Reads the collection via Render (fetchCollectionDetail).
 *  - Mint panel: public mint for anyone while the collection is in the public phase.
 *  - Manage panel (admin only): set mint phase, set mint config, admin-mint,
 *    withdraw proceeds — all wired to the tested launchpad builders.
 *
 * Route: /nft/collection/:id   (:id = encodeURIComponent("creator/slug"))
 *
 * @module pages/CollectionDetail
 */

import { useState, useEffect, useCallback } from "react"
import { useParams, useOutletContext } from "react-router-dom"
import { NFT_COLLECTIONS_PATH } from "../lib/nftConfig"
import { fetchCollectionDetail, isCollectionVerified } from "../lib/launchpadReads"
import { VerifiedBadge } from "../components/nft/VerifiedBadge"
import type { CollectionDetail as CollectionDetailT } from "../lib/launchpad"
import {
    Phase,
    buildMintPublicMsg,
    buildMintAllowlistMsg,
    buildSetMintPhaseMsg,
    buildSetMintConfigMsg,
    buildAdminMintMsg,
    buildWithdrawProceedsMsg,
} from "../lib/launchpad"
import { parseAllowlistText, computeAllowlistRoot, getAllowlistProof } from "../lib/allowlistMerkle"
import type { LayoutContext } from "../types/layout"
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
    const { id: rawId } = useParams<{ id: string }>()
    const id = rawId ? decodeURIComponent(rawId) : ""
    const { adena } = useOutletContext<LayoutContext>()
    const me = adena?.address || ""

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
            {isAdmin && <ManagePanel id={col.id} caller={me} onRun={run} />}

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
        <div className="form-group">
            <input value={uri} onChange={(e) => setUri(e.target.value)} placeholder="Token URI (ipfs://… or blank)" />
            <button className="btn-primary" onClick={() => onRun(buildMintPublicMsg(caller, NFT_COLLECTIONS_PATH, id, uri, priceUgnot), `Mint ${id}`)}>
                Mint{priceUgnot > 0 ? ` (${priceUgnot / 1_000_000} GNOT)` : " (free)"}
            </button>
        </div>
    )
}

function ManagePanel({ id, caller, onRun }: { id: string; caller: string; onRun: RunFn }) {
    const [phase, setPhase] = useState<number>(Phase.Draft)
    const [root, setRoot] = useState("")
    const [price, setPrice] = useState("0")
    const [denom, setDenom] = useState("")
    const [maxSupply, setMaxSupply] = useState("0")
    const [maxPerWallet, setMaxPerWallet] = useState("0")
    const [startBlock, setStartBlock] = useState("0")
    const [cooldown, setCooldown] = useState("0")
    const [mintTo, setMintTo] = useState(caller)
    const [mintUri, setMintUri] = useState("")
    const [denomW, setDenomW] = useState("ugnot")

    const num = (s: string) => Math.max(0, parseInt(s, 10) || 0)

    return (
        <section className="manage-panel">
            <h2>Manage (admin)</h2>

            <fieldset className="form-group">
                <legend>Mint phase</legend>
                <select value={phase} onChange={(e) => setPhase(parseInt(e.target.value, 10))}>
                    <option value={Phase.Draft}>Draft</option>
                    <option value={Phase.Allowlist}>Allowlist</option>
                    <option value={Phase.Public}>Public</option>
                    <option value={Phase.Closed}>Closed</option>
                </select>
                {phase === Phase.Allowlist && (
                    <input value={root} onChange={(e) => setRoot(e.target.value)} placeholder="Allowlist Merkle root (hex)" />
                )}
                <button onClick={() => onRun(buildSetMintPhaseMsg(caller, NFT_COLLECTIONS_PATH, id, phase as 0 | 1 | 2 | 3, root), `Set phase ${id}`)}>
                    Set phase
                </button>
            </fieldset>

            <AllowlistBuilder id={id} caller={caller} onRun={onRun} />

            <fieldset className="form-group">
                <legend>Mint config</legend>
                <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Mint price (ugnot, 0=free)" />
                <input value={denom} onChange={(e) => setDenom(e.target.value)} placeholder="Pay denom (blank=ugnot, else grc20 key)" />
                <input value={maxSupply} onChange={(e) => setMaxSupply(e.target.value)} placeholder="Max supply (0=unlimited)" />
                <input value={maxPerWallet} onChange={(e) => setMaxPerWallet(e.target.value)} placeholder="Max per wallet (0=unlimited)" />
                <input value={startBlock} onChange={(e) => setStartBlock(e.target.value)} placeholder="Mint start block (0=now)" />
                <input value={cooldown} onChange={(e) => setCooldown(e.target.value)} placeholder="Cooldown blocks (0=none)" />
                <button
                    onClick={() =>
                        onRun(
                            buildSetMintConfigMsg(caller, NFT_COLLECTIONS_PATH, id, {
                                mintPrice: num(price),
                                payDenom: denom.trim(),
                                maxSupply: num(maxSupply),
                                maxPerWallet: num(maxPerWallet),
                                mintStartBlock: num(startBlock),
                                mintCooldownBlocks: num(cooldown),
                            }),
                            `Set mint config ${id}`,
                        )
                    }
                >
                    Save config
                </button>
            </fieldset>

            <fieldset className="form-group">
                <legend>Admin mint (no payment)</legend>
                <input value={mintTo} onChange={(e) => setMintTo(e.target.value)} placeholder="Recipient address" />
                <input value={mintUri} onChange={(e) => setMintUri(e.target.value)} placeholder="Token URI" />
                <button onClick={() => onRun(buildAdminMintMsg(caller, NFT_COLLECTIONS_PATH, id, mintTo.trim(), mintUri), `Admin mint ${id}`)}>
                    Mint to recipient
                </button>
            </fieldset>

            <fieldset className="form-group">
                <legend>Withdraw proceeds → custody</legend>
                <input value={denomW} onChange={(e) => setDenomW(e.target.value)} placeholder="Denom (ugnot or grc20 key)" />
                <button onClick={() => onRun(buildWithdrawProceedsMsg(caller, NFT_COLLECTIONS_PATH, id, denomW.trim()), `Withdraw ${id}`)}>
                    Withdraw
                </button>
            </fieldset>
        </section>
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
        <div className="form-group">
            <p className="form-hint">Allowlist phase — paste the creator's published list (one <code>address,qty</code> per line) to derive your proof.</p>
            <textarea value={listText} onChange={(e) => setListText(e.target.value)} placeholder={"g1abc...,2\ng1def...,1"} rows={4} />
            <button onClick={check}>Check allowlist</button>
            {status && <small className="form-hint">{status}</small>}
            {derived && (
                <>
                    <input value={uri} onChange={(e) => setUri(e.target.value)} placeholder="Token URI (ipfs://… or blank)" />
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

// ── Creator: build the allowlist, compute the root, publish + set the phase ──
function AllowlistBuilder({ id, caller, onRun }: { id: string; caller: string; onRun: RunFn }) {
    const [listText, setListText] = useState("")
    const [root, setRoot] = useState("")
    const [count, setCount] = useState(0)

    const compute = useCallback(async () => {
        const entries = parseAllowlistText(listText)
        setCount(entries.length)
        setRoot(await computeAllowlistRoot(entries))
    }, [listText])

    const download = useCallback(() => {
        const entries = parseAllowlistText(listText)
        const blob = new Blob([JSON.stringify(entries, null, 2)], { type: "application/json" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `allowlist-${id.replace(/\//g, "_")}.json`
        a.click()
        URL.revokeObjectURL(url)
    }, [listText, id])

    return (
        <fieldset className="form-group">
            <legend>Allowlist (Merkle)</legend>
            <textarea value={listText} onChange={(e) => setListText(e.target.value)} placeholder={"g1abc...,2  (one address,qty per line)"} rows={4} />
            <button onClick={compute}>Compute root</button>
            {root && (
                <>
                    <small className="form-hint">{count} entries · root <code>{root.slice(0, 16)}…</code></small>
                    <button onClick={download}>Download allowlist.json (publish so minters can prove)</button>
                    <button onClick={() => onRun(buildSetMintPhaseMsg(caller, NFT_COLLECTIONS_PATH, id, Phase.Allowlist, root), `Set allowlist phase ${id}`)}>
                        Set allowlist phase with this root
                    </button>
                </>
            )}
        </fieldset>
    )
}

export default CollectionDetail
