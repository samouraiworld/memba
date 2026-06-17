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
import { fetchCollectionDetail } from "../lib/launchpadReads"
import type { CollectionDetail as CollectionDetailT } from "../lib/launchpad"
import {
    Phase,
    buildMintPublicMsg,
    buildSetMintPhaseMsg,
    buildSetMintConfigMsg,
    buildAdminMintMsg,
    buildWithdrawProceedsMsg,
} from "../lib/launchpad"
import type { LayoutContext } from "../types/layout"

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
    const [loading, setLoading] = useState(true)
    const [notice, setNotice] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    const reload = useCallback(async () => {
        setLoading(true)
        try {
            setCol(await fetchCollectionDetail(id))
        } catch {
            setCol(null)
        } finally {
            setLoading(false)
        }
    }, [id])

    useEffect(() => {
        document.title = `${id} — Memba`
        reload()
    }, [id, reload])

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

    return (
        <div className="collection-detail">
            <h1>{col.name} <small>({col.symbol})</small></h1>
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
                    <p className="form-hint">
                        Allowlist phase: minting requires an off-chain Merkle proof. Proof-input UI is a Phase 2.5
                        follow-on (the builder + on-chain path are ready).
                    </p>
                )}
            </section>

            {/* ── Manage (admin only) ── */}
            {isAdmin && <ManagePanel id={col.id} caller={me} onRun={run} />}
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

export default CollectionDetail
